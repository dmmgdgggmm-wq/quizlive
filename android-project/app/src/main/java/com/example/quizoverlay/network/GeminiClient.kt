package com.example.quizoverlay.network

import com.example.quizoverlay.capture.CapturedScreenPayload
import com.example.quizoverlay.model.ModelStrengthScorer
import com.google.gson.Gson
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.util.concurrent.TimeUnit

sealed class SingleCallOutcome {
    data class Success(val text: String, val latencyMs: Long) : SingleCallOutcome()
    data class HttpError(
        val httpCode: Int,
        val status: String?,
        val errorMessage: String,
        val rawBody: String
    ) : SingleCallOutcome()
    data class NetworkFailure(val exception: Throwable) : SingleCallOutcome()
}

data class PingKeyResult(
    val apiIndex: Int,
    val ok: Boolean,
    val message: String,
    val latencyMs: Long
)

class GeminiClient {

    companion object {
        private const val BASE_URL = "https://generativelanguage.googleapis.com/"
        private val VERSION_REGEX = Regex("^gemini-(\\d+)(?:\\.(\\d+))?", RegexOption.IGNORE_CASE)
        private val BATCH_ITEM_REGEX = Regex("\\[#(\\d+)\\]\\s*:\\s*([^\\n]+(?:\\n(?!\\[#\\d+\\]\\s*:)[^\\n]+)*)")
    }

    private val gson = Gson()

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(90, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .build()

    private val apiService: GeminiApiService = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()
        .create(GeminiApiService::class.java)

    /**
     * Dò danh sách model từ danh sách API key, chỉ giữ model có generateContent
     * và là model văn bản/đa phương thức, sắp xếp theo sức mạnh giảm dần.
     */
    suspend fun discoverModels(apiKeys: List<String>): List<String> {
        val discovered = mutableSetOf<String>()
        for (key in apiKeys) {
            try {
                val res = apiService.listModels(key)
                if (res.isSuccessful) {
                    val models = res.body()?.models.orEmpty()
                    for (m in models) {
                        val name = m.name ?: continue
                        if (ModelStrengthScorer.isEligibleVisionTextModel(name, m.supportedGenerationMethods)) {
                            discovered.add(ModelStrengthScorer.normalizeModelName(name))
                        }
                    }
                    if (discovered.isNotEmpty()) break
                }
            } catch (_: Exception) {
                // Thử tiếp key kế tiếp
            }
        }
        return ModelStrengthScorer.sortModelsByStrength(discovered)
    }

    /**
     * Kiểm tra kết nối (Ping - 0 Quota) bằng GET v1beta/models/{model} cho từng key.
     */
    suspend fun pingModelAcrossKeys(modelName: String, apiKeys: List<String>): List<PingKeyResult> {
        val cleanModel = ModelStrengthScorer.normalizeModelName(modelName)
        return apiKeys.mapIndexed { idx, key ->
            val apiNum = idx + 1
            val start = System.currentTimeMillis()
            try {
                val response = apiService.getModelInfo(cleanModel, key)
                val latency = System.currentTimeMillis() - start
                if (response.isSuccessful) {
                    PingKeyResult(
                        apiIndex = apiNum,
                        ok = true,
                        message = "API $apiNum: Ping thành công (${latency} ms)",
                        latencyMs = latency
                    )
                } else {
                    val code = response.code()
                    val reason = when (code) {
                        404 -> "Model không khả dụng trên API $apiNum"
                        429 -> "Giới hạn tần suất"
                        400, 403 -> "API Key không hợp lệ hoặc bị từ chối"
                        else -> "thất bại (HTTP $code)"
                    }
                    PingKeyResult(
                        apiIndex = apiNum,
                        ok = false,
                        message = "API $apiNum: $reason",
                        latencyMs = latency
                    )
                }
            } catch (_: Exception) {
                val latency = System.currentTimeMillis() - start
                PingKeyResult(
                    apiIndex = apiNum,
                    ok = false,
                    message = "API $apiNum: Kiểm tra lại kết nối mạng.",
                    latencyMs = latency
                )
            }
        }
    }

    /**
     * Gọi 1 model cụ thể với tương thích thinkingConfig theo phiên bản model:
     * - 2.x -> thinkingBudget (Low=512, Medium=2048, High=8192; pro tối thiểu 128)
     * - 3.x trở lên -> thinkingLevel ("low"/"medium"/"high")
     * - Không khớp regex -> không gửi thinkingConfig
     * - Nếu HTTP 400 báo lỗi liên quan thinking -> tự gửi lại không kèm thinkingConfig.
     */
    suspend fun callSingleModelWithThinkingCompatibility(
        apiKey: String,
        modelName: String,
        payloads: List<CapturedScreenPayload>,
        customPrompt: String,
        thinkingLevel: String
    ): SingleCallOutcome {
        val cleanModel = ModelStrengthScorer.normalizeModelName(modelName)
        val genConfigWithThinking = buildGenerationConfig(cleanModel, thinkingLevel, includeThinking = true)
        val requestWithThinking = buildGenerateRequest(payloads, customPrompt, genConfigWithThinking)

        val startMs = System.currentTimeMillis()
        try {
            val firstResponse = apiService.generateContent(cleanModel, apiKey, requestWithThinking)
            if (firstResponse.isSuccessful) {
                val latency = System.currentTimeMillis() - startMs
                val answer = extractAnswerFromResponse(firstResponse.body(), isBatch = payloads.size > 1)
                return SingleCallOutcome.Success(answer, latency)
            }

            val code = firstResponse.code()
            val rawError = firstResponse.errorBody()?.string().orEmpty()
            val parsedError = parseErrorMessage(rawError)

            val isThinkingError = code == 400 && (
                rawError.contains("thinking", ignoreCase = true) ||
                    parsedError.contains("thinking", ignoreCase = true)
                )

            if (isThinkingError && genConfigWithThinking.thinkingConfig != null) {
                val fallbackConfig = buildGenerationConfig(cleanModel, thinkingLevel, includeThinking = false)
                val retryRequest = buildGenerateRequest(payloads, customPrompt, fallbackConfig)
                val retryResponse = apiService.generateContent(cleanModel, apiKey, retryRequest)
                val latency = System.currentTimeMillis() - startMs
                if (retryResponse.isSuccessful) {
                    val answer = extractAnswerFromResponse(retryResponse.body(), isBatch = payloads.size > 1)
                    return SingleCallOutcome.Success(answer, latency)
                }
                val retryRaw = retryResponse.errorBody()?.string().orEmpty()
                return SingleCallOutcome.HttpError(
                    httpCode = retryResponse.code(),
                    status = parseErrorStatus(retryRaw),
                    errorMessage = parseErrorMessage(retryRaw),
                    rawBody = retryRaw
                )
            }

            return SingleCallOutcome.HttpError(
                httpCode = code,
                status = parseErrorStatus(rawError),
                errorMessage = parsedError,
                rawBody = rawError
            )
        } catch (ioe: IOException) {
            return SingleCallOutcome.NetworkFailure(ioe)
        } catch (t: Throwable) {
            return SingleCallOutcome.NetworkFailure(t)
        }
    }

    private fun buildGenerationConfig(
        cleanModel: String,
        thinkingLevel: String,
        includeThinking: Boolean
    ): GenerationConfigDto {
        if (!includeThinking) {
            return GenerationConfigDto(temperature = 0.2f, maxOutputTokens = 2048, thinkingConfig = null)
        }
        val normalizedLevel = thinkingLevel.lowercase()
        val budget = when (normalizedLevel) {
            "high" -> 8192
            "medium" -> 2048
            else -> 512
        }
        val match = VERSION_REGEX.find(cleanModel.lowercase())
            ?: return GenerationConfigDto(temperature = 0.2f, maxOutputTokens = 2048, thinkingConfig = null)

        val major = match.groupValues.getOrNull(1)?.toIntOrNull() ?: 0
        return when {
            major == 2 -> {
                val minBudget = if (cleanModel.contains("pro", ignoreCase = true)) 128 else 0
                val finalBudget = maxOf(minBudget, budget)
                GenerationConfigDto(
                    temperature = 0.2f,
                    maxOutputTokens = 2048 + finalBudget,
                    thinkingConfig = ThinkingConfigDto(thinkingBudget = finalBudget)
                )
            }
            major >= 3 -> {
                val levelStr = when (normalizedLevel) {
                    "high" -> "high"
                    "medium" -> "medium"
                    else -> "low"
                }
                GenerationConfigDto(
                    temperature = 0.2f,
                    maxOutputTokens = 2048 + budget,
                    thinkingConfig = ThinkingConfigDto(thinkingLevel = levelStr)
                )
            }
            else -> GenerationConfigDto(temperature = 0.2f, maxOutputTokens = 2048, thinkingConfig = null)
        }
    }

    private fun buildGenerateRequest(
        payloads: List<CapturedScreenPayload>,
        customPrompt: String,
        generationConfig: GenerationConfigDto
    ): GenerateContentRequestDto {
        val effectivePrompt = customPrompt.trim().ifEmpty {
            "Giải câu hỏi trong ảnh và chỉ ghi đáp án ngắn gọn."
        }

        if (payloads.size <= 1) {
            val singleBase64 = payloads.firstOrNull()?.base64Jpeg.orEmpty()
            return GenerateContentRequestDto(
                systemInstruction = ContentDto(
                    parts = listOf(PartDto(text = effectivePrompt))
                ),
                contents = listOf(
                    ContentDto(
                        role = "user",
                        parts = listOf(
                            PartDto(
                                text = "Hãy đọc kỹ toàn bộ nội dung bài tập/câu hỏi trong ảnh (kể cả đồ thị, bảng, hình vẽ, code) và trả lời chính xác, ngắn gọn."
                            ),
                            PartDto(
                                inlineData = InlineDataDto(
                                    mimeType = "image/jpeg",
                                    data = singleBase64
                                )
                            )
                        )
                    )
                ),
                generationConfig = generationConfig
            )
        }

        // Chế độ Gửi Hàng Loạt (Batch Mode): 1 request chứa nhiều ảnh
        val userParts = mutableListOf<PartDto>()
        userParts.add(
            PartDto(text = "Dưới đây là danh sách ${payloads.size} ảnh, mỗi ảnh là 1 mục cần xử lý trong 1 lượt.")
        )
        payloads.forEachIndexed { idx, item ->
            val itemNum = idx + 1
            userParts.add(PartDto(text = "=== MỤC [#$itemNum] (ẢNH GỐC) ==="))
            userParts.add(
                PartDto(
                    inlineData = InlineDataDto(
                        mimeType = "image/jpeg",
                        data = item.base64Jpeg
                    )
                )
            )
        }
        userParts.add(
            PartDto(text = "Hãy giải chính xác từng mục câu hỏi một cách ngắn gọn, liền mạch và rõ ràng.")
        )
        userParts.add(
            PartDto(text = "QUY TẮC ĐỊNH DẠNG BẮT BUỘC: Với mỗi mục #N, hãy bắt đầu câu trả lời bằng [#N]: <nội dung trả lời liền mạch>.")
        )
        userParts.add(
            PartDto(text = "Yêu cầu trả lời của người dùng: $effectivePrompt")
        )

        return GenerateContentRequestDto(
            systemInstruction = ContentDto(parts = listOf(PartDto(text = effectivePrompt))),
            contents = listOf(ContentDto(role = "user", parts = userParts)),
            generationConfig = generationConfig
        )
    }

    private fun extractAnswerFromResponse(
        body: GenerateContentResponseDto?,
        isBatch: Boolean
    ): String {
        if (body == null) return "Không nhận được dữ liệu phản hồi."
        val blockReason = body.promptFeedback?.blockReason
        if (!blockReason.isNullOrBlank()) {
            return "Nội dung bị chặn: $blockReason"
        }
        val candidates = body.candidates
        if (candidates.isNullOrEmpty()) {
            return "Nội dung bị chặn: EMPTY_CANDIDATES"
        }
        val parts = candidates[0].content?.parts.orEmpty()
        val combined = parts
            .filter { it.thought != true }
            .mapNotNull { it.text }
            .joinToString("")
            .trim()

        if (combined.isEmpty()) {
            return "Không đọc được đáp án từ ảnh."
        }
        return formatAiOutput(combined, isBatch)
    }

    fun formatAiOutput(rawText: String, isBatch: Boolean): String {
        val stripped = rawText
            .replace(Regex("^```[a-zA-Z]*\\s*"), "")
            .replace("`", "")
            .replace("**", "")
            .trim()

        if (!isBatch) {
            return stripped.replace(Regex("\\n{3,}"), "\n\n")
        }

        val matches = BATCH_ITEM_REGEX.findAll(stripped).toList()
        if (matches.isNotEmpty()) {
            val pairs = matches.map { m ->
                val num = m.groupValues[1]
                val ans = m.groupValues[2].replace(Regex("\\s+"), " ").trim()
                num to ans
            }
            val allCompact = pairs.all { it.second.length <= 18 }
            return if (allCompact) {
                pairs.joinToString("  ") { "${it.first}: ${it.second}" }
            } else {
                pairs.joinToString("\n") { "${it.first}: ${it.second}" }
            }
        }
        return stripped
    }

    fun parseErrorMessage(rawJson: String): String {
        if (rawJson.isBlank()) return ""
        return try {
            gson.fromJson(rawJson, GeminiErrorEnvelopeDto::class.java)?.error?.message.orEmpty()
        } catch (_: Exception) {
            rawJson.take(160)
        }
    }

    private fun parseErrorStatus(rawJson: String): String? {
        if (rawJson.isBlank()) return null
        return try {
            gson.fromJson(rawJson, GeminiErrorEnvelopeDto::class.java)?.error?.status
        } catch (_: Exception) {
            null
        }
    }
}
