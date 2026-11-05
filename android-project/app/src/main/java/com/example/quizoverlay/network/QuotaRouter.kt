package com.example.quizoverlay.network

import com.example.quizoverlay.capture.CapturedScreenPayload
import com.example.quizoverlay.data.SecureKeyStore
import com.example.quizoverlay.model.ApiKeyStatusType
import com.example.quizoverlay.model.ApiSlotStatus
import com.example.quizoverlay.model.ModelStrengthScorer
import kotlinx.coroutines.delay
import java.util.concurrent.ConcurrentHashMap

data class RoutedScanResult(
    val ok: Boolean,
    val displayText: String,
    val modelUsed: String,
    val apiIndex: Int, // 1-based
    val keyTail4: String,
    val isFallback: Boolean,
    val latencyMs: Long
)

class QuotaRouter(private val geminiClient: GeminiClient) {

    companion object {
        const val QUOTA_COOLDOWN_MS = 30 * 60 * 1000L // 30 phút
    }

    // Lưu thời điểm hết hạn bỏ qua (epoch ms) theo cặp (keyIndex, normalizedModelName)
    private val exhaustedMap = ConcurrentHashMap<Pair<Int, String>, Long>()
    private val invalidKeySet = ConcurrentHashMap.newKeySet<Int>()
    private val unavailableModels = ConcurrentHashMap.newKeySet<String>()

    @Volatile
    var activeKeyIndex: Int = 0
        private set

    fun resetAllStates() {
        activeKeyIndex = 0
        exhaustedMap.clear()
        invalidKeySet.clear()
        unavailableModels.clear()
    }

    fun getRemainingCooldownMs(keyIndex: Int, modelName: String, nowMs: Long = System.currentTimeMillis()): Long {
        val key = keyIndex to ModelStrengthScorer.normalizeModelName(modelName)
        val until = exhaustedMap[key] ?: return 0L
        val remaining = until - nowMs
        if (remaining <= 0L) {
            exhaustedMap.remove(key)
            return 0L
        }
        return remaining
    }

    private fun isPairExhausted(keyIndex: Int, modelName: String, nowMs: Long = System.currentTimeMillis()): Boolean {
        return getRemainingCooldownMs(keyIndex, modelName, nowMs) > 0L
    }

    private fun markPairExhausted(keyIndex: Int, modelName: String, nowMs: Long = System.currentTimeMillis()) {
        val key = keyIndex to ModelStrengthScorer.normalizeModelName(modelName)
        exhaustedMap[key] = nowMs + QUOTA_COOLDOWN_MS
    }

    fun buildApiStatusesForModel(
        apiKeys: List<String>,
        modelName: String,
        isServiceActive: Boolean,
        nowMs: Long = System.currentTimeMillis()
    ): List<ApiSlotStatus> {
        val cleanModel = ModelStrengthScorer.normalizeModelName(modelName)
        return apiKeys.mapIndexed { idx, rawKey ->
            val tail4 = SecureKeyStore.maskKeyTail4(rawKey)
            when {
                invalidKeySet.contains(idx) -> ApiSlotStatus(
                    apiIndex = idx + 1,
                    keyTail4 = tail4,
                    status = ApiKeyStatusType.INVALID_KEY,
                    cooldownRemainingMs = 0L
                )
                isPairExhausted(idx, cleanModel, nowMs) -> ApiSlotStatus(
                    apiIndex = idx + 1,
                    keyTail4 = tail4,
                    status = ApiKeyStatusType.QUOTA_EXHAUSTED,
                    cooldownRemainingMs = getRemainingCooldownMs(idx, cleanModel, nowMs)
                )
                isServiceActive && idx == (activeKeyIndex % apiKeys.size.coerceAtLeast(1)) -> ApiSlotStatus(
                    apiIndex = idx + 1,
                    keyTail4 = tail4,
                    status = ApiKeyStatusType.ACTIVE,
                    cooldownRemainingMs = 0L
                )
                else -> ApiSlotStatus(
                    apiIndex = idx + 1,
                    keyTail4 = tail4,
                    status = ApiKeyStatusType.READY,
                    cooldownRemainingMs = 0L
                )
            }
        }
    }

    /**
     * Thực thi quét ảnh qua chuỗi model và danh sách API key.
     * Mỗi lần quét luôn bắt đầu lại từ model ưu tiên.
     */
    suspend fun executeScanWithFailover(
        apiKeys: List<String>,
        modelChain: List<String>,
        preferredModel: String,
        payloads: List<CapturedScreenPayload>,
        customPrompt: String,
        thinkingLevel: String,
        onTransitionNotice: suspend (newModel: String, newApiIndex1Based: Int, overlayNotice: String) -> Unit
    ): RoutedScanResult {
        val cleanPreferred = ModelStrengthScorer.normalizeModelName(preferredModel)
        if (apiKeys.isEmpty()) {
            return RoutedScanResult(
                ok = false,
                displayText = "Vui lòng nhập ít nhất một API key.",
                modelUsed = cleanPreferred,
                apiIndex = 1,
                keyTail4 = "...????",
                isFallback = false,
                latencyMs = 0L
            )
        }

        val candidates = modelChain
            .map { ModelStrengthScorer.normalizeModelName(it) }
            .filter { !unavailableModels.contains(it) }

        for ((mIndex, model) in candidates.withIndex()) {
            // Ở model ưu tiên thì bắt đầu từ activeKeyIndex; khi đã xuống model kế tiếp thì bắt đầu lại từ API đầu chưa bị đánh dấu
            val startKeyIdx = if (mIndex == 0) (activeKeyIndex % apiKeys.size) else 0
            var count404OnModel = 0
            var modelOverloadedAbort = false

            for (offset in apiKeys.indices) {
                val keyIdx = (startKeyIdx + offset) % apiKeys.size
                val apiNum = keyIdx + 1
                val rawKey = apiKeys[keyIdx]
                val tail4 = SecureKeyStore.maskKeyTail4(rawKey)

                if (invalidKeySet.contains(keyIdx)) continue
                if (isPairExhausted(keyIdx, model)) continue

                var outcome = geminiClient.callSingleModelWithThinkingCompatibility(
                    apiKey = rawKey,
                    modelName = model,
                    payloads = payloads,
                    customPrompt = customPrompt,
                    thinkingLevel = thinkingLevel
                )

                // Xử lý theo kết quả
                when (outcome) {
                    is SingleCallOutcome.Success -> {
                        activeKeyIndex = keyIdx
                        return RoutedScanResult(
                            ok = true,
                            displayText = outcome.text,
                            modelUsed = model,
                            apiIndex = apiNum,
                            keyTail4 = tail4,
                            isFallback = !model.equals(cleanPreferred, ignoreCase = true),
                            latencyMs = outcome.latencyMs
                        )
                    }

                    is SingleCallOutcome.NetworkFailure -> {
                        // Lỗi mạng -> KHÔNG đổi key, KHÔNG đổi model
                        return RoutedScanResult(
                            ok = false,
                            displayText = "Kiểm tra lại kết nối mạng.",
                            modelUsed = model,
                            apiIndex = apiNum,
                            keyTail4 = tail4,
                            isFallback = !model.equals(cleanPreferred, ignoreCase = true),
                            latencyMs = 0L
                        )
                    }

                    is SingleCallOutcome.HttpError -> {
                        val code = outcome.httpCode
                        val bodyLower = (outcome.rawBody + " " + outcome.errorMessage).lowercase()

                        if (code == 429) {
                            val isPerMinuteRetryable = (bodyLower.contains("retrydelay") || bodyLower.contains("per minute")) &&
                                !bodyLower.contains("limit: 0") &&
                                !bodyLower.contains("per day")

                            if (isPerMinuteRetryable) {
                                delay(1800L)
                                val retry429 = geminiClient.callSingleModelWithThinkingCompatibility(
                                    apiKey = rawKey,
                                    modelName = model,
                                    payloads = payloads,
                                    customPrompt = customPrompt,
                                    thinkingLevel = thinkingLevel
                                )
                                if (retry429 is SingleCallOutcome.Success) {
                                    activeKeyIndex = keyIdx
                                    return RoutedScanResult(
                                        ok = true,
                                        displayText = retry429.text,
                                        modelUsed = model,
                                        apiIndex = apiNum,
                                        keyTail4 = tail4,
                                        isFallback = !model.equals(cleanPreferred, ignoreCase = true),
                                        latencyMs = retry429.latencyMs
                                    )
                                }
                            }

                            // Đánh dấu (keyIdx, model) hết quota 30 phút
                            markPairExhausted(keyIdx, model)
                            val nextKeyIdx = findNextAvailableKey(apiKeys.size, keyIdx, model)
                            if (nextKeyIdx != -1) {
                                activeKeyIndex = nextKeyIdx
                                val notice = "API $apiNum hết quota -> Đã chuyển sang API ${nextKeyIdx + 1}"
                                onTransitionNotice(model, nextKeyIdx + 1, notice)
                            }
                            continue
                        }

                        if (code == 503 || code == 500) {
                            // Model quá tải: thử lại cùng key tối đa 2 lần (cách ~1.5s), KHÔNG đánh dấu hết quota
                            var recovered: SingleCallOutcome.Success? = null
                            for (attempt in 1..2) {
                                delay(1500L)
                                val retry503 = geminiClient.callSingleModelWithThinkingCompatibility(
                                    apiKey = rawKey,
                                    modelName = model,
                                    payloads = payloads,
                                    customPrompt = customPrompt,
                                    thinkingLevel = thinkingLevel
                                )
                                if (retry503 is SingleCallOutcome.Success) {
                                    recovered = retry503
                                    break
                                }
                            }
                            if (recovered != null) {
                                activeKeyIndex = keyIdx
                                return RoutedScanResult(
                                    ok = true,
                                    displayText = recovered.text,
                                    modelUsed = model,
                                    apiIndex = apiNum,
                                    keyTail4 = tail4,
                                    isFallback = !model.equals(cleanPreferred, ignoreCase = true),
                                    latencyMs = recovered.latencyMs
                                )
                            }
                            // Vẫn lỗi 503/500 -> coi model tạm hỏng, sang model kế tiếp
                            modelOverloadedAbort = true
                            break
                        }

                        if (code == 404) {
                            count404OnModel++
                            continue
                        }

                        if (code == 400 || code == 403) {
                            if (code == 403 || bodyLower.contains("api key not valid") || bodyLower.contains("key_invalid")) {
                                invalidKeySet.add(keyIdx)
                                val notice = "API $apiNum không hợp lệ (HTTP $code)"
                                val nextKeyIdx = findNextAvailableKey(apiKeys.size, keyIdx, model)
                                if (nextKeyIdx != -1) {
                                    activeKeyIndex = nextKeyIdx
                                    onTransitionNotice(model, nextKeyIdx + 1, notice)
                                }
                                continue
                            }
                        }
                    }
                }
            }

            val validKeysCount = (apiKeys.size - invalidKeySet.size).coerceAtLeast(1)
            if (count404OnModel >= validKeysCount) {
                unavailableModels.add(model)
            }

            if (mIndex + 1 < candidates.size) {
                val nextModel = candidates[mIndex + 1]
                val firstReadyKey = findFirstAvailableKeyFromZero(apiKeys.size, nextModel)
                if (firstReadyKey != -1) {
                    activeKeyIndex = firstReadyKey
                    val notice = if (modelOverloadedAbort) {
                        "Model $model quá tải -> Đã chuyển sang $nextModel"
                    } else {
                        "Model $model hết quota trên mọi API -> Đã chuyển sang $nextModel"
                    }
                    onTransitionNotice(nextModel, firstReadyKey + 1, notice)
                }
            }
        }

        val finalApiNum = (activeKeyIndex % apiKeys.size) + 1
        val finalTail4 = SecureKeyStore.maskKeyTail4(apiKeys[activeKeyIndex % apiKeys.size])
        return RoutedScanResult(
            ok = false,
            displayText = "Tất cả API và model đã hết quota. Hãy đợi reset hoặc thêm key mới.",
            modelUsed = candidates.lastOrNull() ?: cleanPreferred,
            apiIndex = finalApiNum,
            keyTail4 = finalTail4,
            isFallback = candidates.size > 1,
            latencyMs = 0L
        )
    }

    private fun findNextAvailableKey(totalKeys: Int, currentKeyIdx: Int, model: String): Int {
        for (step in 1 until totalKeys) {
            val idx = (currentKeyIdx + step) % totalKeys
            if (invalidKeySet.contains(idx)) continue
            if (isPairExhausted(idx, model)) continue
            return idx
        }
        return -1
    }

    private fun findFirstAvailableKeyFromZero(totalKeys: Int, model: String): Int {
        for (idx in 0 until totalKeys) {
            if (invalidKeySet.contains(idx)) continue
            if (isPairExhausted(idx, model)) continue
            return idx
        }
        return -1
    }
}
