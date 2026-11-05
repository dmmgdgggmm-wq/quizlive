import { AndroidSourceFile } from './androidXmlAndGradleFiles';

export const ANDROID_KOTLIN_CORE_FILES: AndroidSourceFile[] = [
  {
    path: 'app/src/main/java/com/example/quizoverlay/model/ActiveRouteState.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'StateFlow ActiveRouteState phát realtime từ FloatingService sang MainActivity, lưu trạng thái từng API key và thời gian đếm ngược quota',
    content: `package com.example.quizoverlay.model

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ApiKeyStatusType {
    READY,
    ACTIVE,
    QUOTA_EXHAUSTED,
    INVALID_KEY
}

data class ApiSlotStatus(
    val apiIndex: Int, // 1-based (API 1..5)
    val keyTail4: String, // chỉ 4 ký tự cuối, ví dụ "...a1B2"
    val status: ApiKeyStatusType,
    val cooldownRemainingMs: Long = 0L
)

data class ActiveRoute(
    val isServiceRunning: Boolean = false,
    val hasScannedInSession: Boolean = false,
    val modelUsed: String = ModelStrengthScorer.DEFAULT_PREFERRED_MODEL,
    val preferredModel: String = ModelStrengthScorer.DEFAULT_PREFERRED_MODEL,
    val apiIndex: Int = 1, // 1-based
    val apiCount: Int = 0,
    val keyTail4: String = "...????",
    val isFallback: Boolean = false,
    val lastScanTime: String? = null,
    val lastLatencyMs: Long? = null,
    val apiStatuses: List<ApiSlotStatus> = emptyList()
)

/**
 * Bus chia sẻ StateFlow<ActiveRoute> trực tiếp từ FloatingService sang MainActivity
 * để thẻ "ĐANG DÙNG" cập nhật tức thời mà không cần mở lại màn hình.
 */
object ActiveRouteStateHolder {
    private val _state = MutableStateFlow(ActiveRoute())
    val state: StateFlow<ActiveRoute> = _state.asStateFlow()

    fun update(newRoute: ActiveRoute) {
        _state.value = newRoute
    }

    fun current(): ActiveRoute = _state.value
}
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/model/ModelStrengthScorer.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Bộ lọc model văn bản/đa phương thức và thuật toán xếp hạng sức mạnh scoreModelStrength (3.8 > 3.7 > ... > 3.5 > 2.5, pro > flash > flash-lite, stable > preview/exp)',
    content: `package com.example.quizoverlay.model

object ModelStrengthScorer {

    const val DEFAULT_PREFERRED_MODEL = "gemini-3.8-flash"

    val DEFAULT_MODELS = listOf(
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest"
    )

    private val VERSION_REGEX = Regex("^gemini-(\\\\d+)(?:\\\\.(\\\\d+))?", RegexOption.IGNORE_CASE)
    private val DATED_OR_PREVIEW_REGEX = Regex("(-\\\\d{2}-\\\\d{2})|(-\\\\d{4})|(-\\\\d{3}$)", RegexOption.IGNORE_CASE)

    private val EXCLUDED_KEYWORDS = listOf(
        "embedding",
        "imagen",
        "veo",
        "tts",
        "aqa",
        "bisheng",
        "learnlm",
        "audio"
    )

    fun normalizeModelName(rawName: String): String {
        return rawName.trim().removePrefix("models/")
    }

    fun isEligibleVisionTextModel(
        rawName: String,
        supportedGenerationMethods: List<String>?
    ): Boolean {
        val clean = normalizeModelName(rawName).lowercase()
        if (!clean.startsWith("gemini-")) return false
        if (supportedGenerationMethods == null || !supportedGenerationMethods.contains("generateContent")) {
            return false
        }
        return EXCLUDED_KEYWORDS.none { clean.contains(it) }
    }

    data class StrengthScore(
        val major: Int,
        val minor: Int,
        val tierRank: Int, // 3 = pro, 2 = flash (kể cả -latest), 1 = flash-lite, 0 = khác
        val stabilityRank: Int, // 1 = bản ổn định, 0 = preview/exp/có ngày phát hành
        val cleanName: String
    ) : Comparable<StrengthScore> {
        override fun compareTo(other: StrengthScore): Int {
            // Sắp xếp giảm dần theo sức mạnh (mạnh nhất đứng đầu)
            if (this.major != other.major) return other.major.compareTo(this.major)
            if (this.minor != other.minor) return other.minor.compareTo(this.minor)
            if (this.tierRank != other.tierRank) return other.tierRank.compareTo(this.tierRank)
            if (this.stabilityRank != other.stabilityRank) return other.stabilityRank.compareTo(this.stabilityRank)
            return this.cleanName.compareTo(other.cleanName)
        }
    }

    fun scoreModelStrength(rawModelName: String): StrengthScore {
        val clean = normalizeModelName(rawModelName).lowercase()
        val match = VERSION_REGEX.find(clean)
        val major = match?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
        val minor = match?.groupValues?.getOrNull(2)?.takeIf { it.isNotEmpty() }?.toIntOrNull() ?: 0

        val tierRank = when {
            clean.contains("flash-lite") || clean.contains("lite") -> 1
            clean.contains("pro") -> 3
            clean.contains("flash") -> 2
            else -> 0
        }

        val isPreviewOrDated = clean.contains("preview") ||
            clean.contains("exp") ||
            DATED_OR_PREVIEW_REGEX.containsMatchIn(clean)
        val stabilityRank = if (isPreviewOrDated) 0 else 1

        return StrengthScore(
            major = major,
            minor = minor,
            tierRank = tierRank,
            stabilityRank = stabilityRank,
            cleanName = clean
        )
    }

    fun sortModelsByStrength(models: Collection<String>): List<String> {
        return models
            .map { normalizeModelName(it) }
            .filter { it.isNotBlank() }
            .distinct()
            .sortedWith { a, b -> scoreModelStrength(a).compareTo(scoreModelStrength(b)) }
    }

    fun selectDefaultPreferredModel(sortedModels: List<String>): String {
        if (sortedModels.contains(DEFAULT_PREFERRED_MODEL)) {
            return DEFAULT_PREFERRED_MODEL
        }
        val latestFlash = sortedModels.firstOrNull { name ->
            val lower = name.lowercase()
            lower.contains("flash") && !lower.contains("flash-lite") && !lower.contains("lite")
        }
        if (latestFlash != null) return latestFlash
        return sortedModels.firstOrNull() ?: DEFAULT_PREFERRED_MODEL
    }

    /**
     * Chuỗi model = [model ưu tiên] + tối đa 5 model nằm DƯỚI nó trong danh sách đã xếp theo sức mạnh.
     * Tuyệt đối không dùng model mạnh hơn model ưu tiên.
     */
    fun buildModelChain(
        sortedModels: List<String>,
        preferredModel: String,
        autoFallback: Boolean
    ): List<String> {
        val cleanPreferred = normalizeModelName(preferredModel).ifBlank { DEFAULT_PREFERRED_MODEL }
        if (!autoFallback) {
            return listOf(cleanPreferred)
        }
        val fullSorted = sortModelsByStrength(
            if (sortedModels.contains(cleanPreferred)) sortedModels else (listOf(cleanPreferred) + sortedModels)
        )
        val startIdx = fullSorted.indexOf(cleanPreferred)
        if (startIdx < 0) return listOf(cleanPreferred)
        return fullSorted.drop(startIdx).take(6)
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/data/SecureKeyStore.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Mã hóa API key bằng EncryptedSharedPreferences (AES256_GCM), không bao giờ ghi log ra Logcat và chỉ trích xuất 4 ký tự cuối',
    content: `package com.example.quizoverlay.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecureKeyStore(context: Context) {

    companion object {
        const val PREFS_FILE_NAME = "quiz_secure_api_keys_prefs"
        private const val KEY_RAW_API_KEYS = "encrypted_api_keys_multiline"
        const val MAX_KEYS = 5

        fun parseKeys(rawText: String): List<String> {
            return rawText
                .lineSequence()
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
                .take(MAX_KEYS)
                .toList()
        }

        fun maskKeyTail4(key: String): String {
            val trimmed = key.trim()
            if (trimmed.isEmpty()) return "...????"
            val tail = if (trimmed.length <= 4) trimmed else trimmed.takeLast(4)
            return "...$tail"
        }
    }

    private val encryptedPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun saveApiKeysFromText(rawText: String): List<String> {
        val normalizedList = parseKeys(rawText)
        encryptedPrefs.edit()
            .putString(KEY_RAW_API_KEYS, normalizedList.joinToString("\\n"))
            .apply()
        return normalizedList
    }

    fun getApiKeys(): List<String> {
        val stored = encryptedPrefs.getString(KEY_RAW_API_KEYS, "") ?: ""
        return parseKeys(stored)
    }

    fun clearKeys() {
        encryptedPrefs.edit().remove(KEY_RAW_API_KEYS).apply()
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/data/SettingsRepository.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'DataStore Preferences lưu cấu hình realtime của biểu tượng nổi, khung trả lời, danh sách model và tuyến dùng cuối (không lưu cache đáp án)',
    content: `package com.example.quizoverlay.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.example.quizoverlay.model.ModelStrengthScorer
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "quiz_overlay_settings")

data class OverlaySettings(
    val preferredModel: String = ModelStrengthScorer.DEFAULT_PREFERRED_MODEL,
    val cachedModels: List<String> = ModelStrengthScorer.DEFAULT_MODELS,
    val autoFallbackModel: Boolean = true,
    val thinkingLevel: String = "low", // "low" | "medium" | "high"
    val customPrompt: String = "Giải câu hỏi trong ảnh và chỉ ghi đáp án ngắn gọn (ví dụ: 1. A, 2. C).",
    val iconDiameterMm: Float = 3.0f,
    val iconAlphaPercent: Int = 85,
    val iconColorHex: String = "#10B981",
    val iconPosX: Int = 0,
    val iconPosY: Int = 260,
    val answerTextSizeSp: Int = 16,
    val answerAutoHideSeconds: Int = 5,
    val answerHideBorder: Boolean = false,
    val answerTextColorHex: String = "#FFFFFF",
    val answerPosX: Int = 120,
    val answerPosY: Int = 240,
    val answerWidthDp: Int = 48,
    val answerHeightDp: Int = 32,
    val batchModeEnabled: Boolean = true,
    // Chỉ lưu tuyến dùng cuối để thẻ ĐANG DÙNG hiện lại khi mở app (không lưu đáp án)
    val lastUsedModel: String? = null,
    val lastUsedApiIndex: Int? = null,
    val lastUsedKeyTail4: String? = null,
    val lastScanTimeText: String? = null,
    val lastScanLatencyMs: Long? = null
)

class SettingsRepository(private val context: Context) {

    private object Keys {
        val PREFERRED_MODEL = stringPreferencesKey("preferred_model")
        val CACHED_MODELS = stringPreferencesKey("cached_models_csv")
        val AUTO_FALLBACK = booleanPreferencesKey("auto_fallback_model")
        val THINKING_LEVEL = stringPreferencesKey("thinking_level")
        val CUSTOM_PROMPT = stringPreferencesKey("custom_prompt")

        val ICON_DIAMETER_MM = floatPreferencesKey("icon_diameter_mm")
        val ICON_ALPHA_PERCENT = intPreferencesKey("icon_alpha_percent")
        val ICON_COLOR_HEX = stringPreferencesKey("icon_color_hex")
        val ICON_POS_X = intPreferencesKey("icon_pos_x")
        val ICON_POS_Y = intPreferencesKey("icon_pos_y")

        val ANSWER_TEXT_SIZE_SP = intPreferencesKey("answer_text_size_sp")
        val ANSWER_AUTO_HIDE_SECONDS = intPreferencesKey("answer_auto_hide_seconds")
        val ANSWER_HIDE_BORDER = booleanPreferencesKey("answer_hide_border")
        val ANSWER_TEXT_COLOR_HEX = stringPreferencesKey("answer_text_color_hex")
        val ANSWER_POS_X = intPreferencesKey("answer_pos_x")
        val ANSWER_POS_Y = intPreferencesKey("answer_pos_y")
        val ANSWER_WIDTH_DP = intPreferencesKey("answer_width_dp")
        val ANSWER_HEIGHT_DP = intPreferencesKey("answer_height_dp")

        val BATCH_MODE_ENABLED = booleanPreferencesKey("batch_mode_enabled")

        val LAST_USED_MODEL = stringPreferencesKey("last_used_model")
        val LAST_USED_API_INDEX = intPreferencesKey("last_used_api_index")
        val LAST_USED_KEY_TAIL4 = stringPreferencesKey("last_used_key_tail4")
        val LAST_SCAN_TIME_TEXT = stringPreferencesKey("last_scan_time_text")
        val LAST_SCAN_LATENCY_MS = longPreferencesKey("last_scan_latency_ms")
    }

    val settingsFlow: Flow<OverlaySettings> = context.dataStore.data.map { prefs ->
        val rawCsv = prefs[Keys.CACHED_MODELS]
        val models = if (rawCsv.isNullOrBlank()) {
            ModelStrengthScorer.DEFAULT_MODELS
        } else {
            ModelStrengthScorer.sortModelsByStrength(rawCsv.split(","))
                .ifEmpty { ModelStrengthScorer.DEFAULT_MODELS }
        }

        OverlaySettings(
            preferredModel = prefs[Keys.PREFERRED_MODEL] ?: ModelStrengthScorer.selectDefaultPreferredModel(models),
            cachedModels = models,
            autoFallbackModel = prefs[Keys.AUTO_FALLBACK] ?: true,
            thinkingLevel = prefs[Keys.THINKING_LEVEL] ?: "low",
            customPrompt = prefs[Keys.CUSTOM_PROMPT]
                ?: "Giải câu hỏi trong ảnh và chỉ ghi đáp án ngắn gọn (ví dụ: 1. A, 2. C).",
            iconDiameterMm = (prefs[Keys.ICON_DIAMETER_MM] ?: 3.0f).coerceIn(2.0f, 15.0f),
            iconAlphaPercent = (prefs[Keys.ICON_ALPHA_PERCENT] ?: 85).coerceIn(0, 100),
            iconColorHex = prefs[Keys.ICON_COLOR_HEX] ?: "#10B981",
            iconPosX = prefs[Keys.ICON_POS_X] ?: 0,
            iconPosY = prefs[Keys.ICON_POS_Y] ?: 260,
            answerTextSizeSp = (prefs[Keys.ANSWER_TEXT_SIZE_SP] ?: 16).coerceIn(10, 32),
            answerAutoHideSeconds = (prefs[Keys.ANSWER_AUTO_HIDE_SECONDS] ?: 5).coerceIn(0, 30),
            answerHideBorder = prefs[Keys.ANSWER_HIDE_BORDER] ?: false,
            answerTextColorHex = prefs[Keys.ANSWER_TEXT_COLOR_HEX] ?: "#FFFFFF",
            answerPosX = prefs[Keys.ANSWER_POS_X] ?: 120,
            answerPosY = prefs[Keys.ANSWER_POS_Y] ?: 240,
            answerWidthDp = (prefs[Keys.ANSWER_WIDTH_DP] ?: 48).coerceAtLeast(24),
            answerHeightDp = (prefs[Keys.ANSWER_HEIGHT_DP] ?: 32).coerceAtLeast(24),
            batchModeEnabled = prefs[Keys.BATCH_MODE_ENABLED] ?: true,
            lastUsedModel = prefs[Keys.LAST_USED_MODEL],
            lastUsedApiIndex = prefs[Keys.LAST_USED_API_INDEX],
            lastUsedKeyTail4 = prefs[Keys.LAST_USED_KEY_TAIL4],
            lastScanTimeText = prefs[Keys.LAST_SCAN_TIME_TEXT],
            lastScanLatencyMs = prefs[Keys.LAST_SCAN_LATENCY_MS]
        )
    }

    suspend fun saveDiscoveredModels(models: List<String>, preferredModel: String) {
        val sorted = ModelStrengthScorer.sortModelsByStrength(models)
        context.dataStore.edit { prefs ->
            prefs[Keys.CACHED_MODELS] = sorted.joinToString(",")
            prefs[Keys.PREFERRED_MODEL] = preferredModel
        }
    }

    suspend fun setPreferredModel(model: String) {
        context.dataStore.edit { it[Keys.PREFERRED_MODEL] = model }
    }

    suspend fun setAutoFallbackModel(enabled: Boolean) {
        context.dataStore.edit { it[Keys.AUTO_FALLBACK] = enabled }
    }

    suspend fun setThinkingLevel(level: String) {
        context.dataStore.edit { it[Keys.THINKING_LEVEL] = level }
    }

    suspend fun setCustomPrompt(prompt: String) {
        context.dataStore.edit { it[Keys.CUSTOM_PROMPT] = prompt }
    }

    suspend fun setIconDiameterMm(mm: Float) {
        context.dataStore.edit { it[Keys.ICON_DIAMETER_MM] = mm.coerceIn(2.0f, 15.0f) }
    }

    suspend fun setIconAlphaPercent(alpha: Int) {
        context.dataStore.edit { it[Keys.ICON_ALPHA_PERCENT] = alpha.coerceIn(0, 100) }
    }

    suspend fun setIconColorHex(hex: String) {
        context.dataStore.edit { it[Keys.ICON_COLOR_HEX] = hex }
    }

    suspend fun resetIconDefaults() {
        context.dataStore.edit { prefs ->
            prefs[Keys.ICON_DIAMETER_MM] = 3.0f
            prefs[Keys.ICON_ALPHA_PERCENT] = 85
            prefs[Keys.ICON_COLOR_HEX] = "#10B981"
        }
    }

    suspend fun saveIconPosition(x: Int, y: Int) {
        context.dataStore.edit { prefs ->
            prefs[Keys.ICON_POS_X] = x
            prefs[Keys.ICON_POS_Y] = y
        }
    }

    suspend fun setAnswerTextSizeSp(sp: Int) {
        context.dataStore.edit { it[Keys.ANSWER_TEXT_SIZE_SP] = sp.coerceIn(10, 32) }
    }

    suspend fun setAnswerAutoHideSeconds(seconds: Int) {
        context.dataStore.edit { it[Keys.ANSWER_AUTO_HIDE_SECONDS] = seconds.coerceIn(0, 30) }
    }

    suspend fun setAnswerHideBorder(hide: Boolean) {
        context.dataStore.edit { it[Keys.ANSWER_HIDE_BORDER] = hide }
    }

    suspend fun setAnswerTextColorHex(hex: String) {
        context.dataStore.edit { it[Keys.ANSWER_TEXT_COLOR_HEX] = hex }
    }

    suspend fun saveAnswerBounds(x: Int, y: Int, widthDp: Int, heightDp: Int) {
        context.dataStore.edit { prefs ->
            prefs[Keys.ANSWER_POS_X] = x
            prefs[Keys.ANSWER_POS_Y] = y
            prefs[Keys.ANSWER_WIDTH_DP] = widthDp.coerceAtLeast(24)
            prefs[Keys.ANSWER_HEIGHT_DP] = heightDp.coerceAtLeast(24)
        }
    }

    suspend fun setBatchModeEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.BATCH_MODE_ENABLED] = enabled }
    }

    suspend fun saveLastUsedRoute(
        modelUsed: String,
        apiIndex: Int,
        keyTail4: String,
        scanTimeText: String,
        latencyMs: Long
    ) {
        context.dataStore.edit { prefs ->
            prefs[Keys.LAST_USED_MODEL] = modelUsed
            prefs[Keys.LAST_USED_API_INDEX] = apiIndex
            prefs[Keys.LAST_USED_KEY_TAIL4] = keyTail4
            prefs[Keys.LAST_SCAN_TIME_TEXT] = scanTimeText
            prefs[Keys.LAST_SCAN_LATENCY_MS] = latencyMs
        }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/network/GeminiApiService.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Retrofit interface và các lớp dữ liệu Gson cho v1beta/models, ping model và generateContent',
    content: `package com.example.quizoverlay.network

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

interface GeminiApiService {

    @GET("v1beta/models")
    suspend fun listModels(
        @Header("X-Goog-Api-Key") apiKey: String
    ): Response<ModelsListResponseDto>

    @GET("v1beta/models/{model}")
    suspend fun getModelInfo(
        @Path("model", encoded = true) modelName: String,
        @Header("X-Goog-Api-Key") apiKey: String
    ): Response<ModelInfoDto>

    @POST("v1beta/models/{model}:generateContent")
    suspend fun generateContent(
        @Path("model", encoded = true) modelName: String,
        @Header("X-Goog-Api-Key") apiKey: String,
        @Body request: GenerateContentRequestDto
    ): Response<GenerateContentResponseDto>
}

data class ModelsListResponseDto(
    @SerializedName("models") val models: List<ModelInfoDto>?
)

data class ModelInfoDto(
    @SerializedName("name") val name: String?,
    @SerializedName("supportedGenerationMethods") val supportedGenerationMethods: List<String>?
)

data class GenerateContentRequestDto(
    @SerializedName("systemInstruction") val systemInstruction: ContentDto? = null,
    @SerializedName("contents") val contents: List<ContentDto>,
    @SerializedName("generationConfig") val generationConfig: GenerationConfigDto
)

data class ContentDto(
    @SerializedName("role") val role: String? = null,
    @SerializedName("parts") val parts: List<PartDto>
)

data class PartDto(
    @SerializedName("text") val text: String? = null,
    @SerializedName("inlineData") val inlineData: InlineDataDto? = null,
    @SerializedName("thought") val thought: Boolean? = null
)

data class InlineDataDto(
    @SerializedName("mimeType") val mimeType: String = "image/jpeg",
    @SerializedName("data") val data: String
)

data class GenerationConfigDto(
    @SerializedName("temperature") val temperature: Float = 0.2f,
    @SerializedName("maxOutputTokens") val maxOutputTokens: Int = 2048,
    @SerializedName("thinkingConfig") val thinkingConfig: ThinkingConfigDto? = null
)

data class ThinkingConfigDto(
    @SerializedName("thinkingBudget") val thinkingBudget: Int? = null,
    @SerializedName("thinkingLevel") val thinkingLevel: String? = null
)

data class GenerateContentResponseDto(
    @SerializedName("candidates") val candidates: List<CandidateDto>?,
    @SerializedName("promptFeedback") val promptFeedback: PromptFeedbackDto?
)

data class CandidateDto(
    @SerializedName("content") val content: ContentDto?,
    @SerializedName("finishReason") val finishReason: String?
)

data class PromptFeedbackDto(
    @SerializedName("blockReason") val blockReason: String?
)

data class GeminiErrorEnvelopeDto(
    @SerializedName("error") val error: GeminiErrorDetailDto?
)

data class GeminiErrorDetailDto(
    @SerializedName("code") val code: Int?,
    @SerializedName("message") val message: String?,
    @SerializedName("status") val status: String?
)
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/network/GeminiClient.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Client gọi Gemini API với timeout 90s, callSingleModelWithThinkingCompatibility, chế độ gửi hàng loạt [#N]: và formatAiOutput',
    content: `package com.example.quizoverlay.network

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
        private val VERSION_REGEX = Regex("^gemini-(\\\\d+)(?:\\\\.(\\\\d+))?", RegexOption.IGNORE_CASE)
        private val BATCH_ITEM_REGEX = Regex("\\\\[#(\\\\d+)\\\\]\\\\s*:\\\\s*([^\\\\n]+(?:\\\\n(?!\\\\[#\\\\d+\\\\]\\\\s*:)[^\\\\n]+)*)")
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
                        message = "API $apiNum: Ping thành công (\${latency} ms)",
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
            PartDto(text = "Dưới đây là danh sách \${payloads.size} ảnh, mỗi ảnh là 1 mục cần xử lý trong 1 lượt.")
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
            .replace(Regex("^\`\`\`[a-zA-Z]*\\\\s*"), "")
            .replace("\`", "")
            .replace("**", "")
            .trim()

        if (!isBatch) {
            return stripped.replace(Regex("\\\\n{3,}"), "\\n\\n")
        }

        val matches = BATCH_ITEM_REGEX.findAll(stripped).toList()
        if (matches.isNotEmpty()) {
            val pairs = matches.map { m ->
                val num = m.groupValues[1]
                val ans = m.groupValues[2].replace(Regex("\\\\s+"), " ").trim()
                num to ans
            }
            val allCompact = pairs.all { it.second.length <= 18 }
            return if (allCompact) {
                pairs.joinToString("  ") { "\${it.first}: \${it.second}" }
            } else {
                pairs.joinToString("\\n") { "\${it.first}: \${it.second}" }
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
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/network/QuotaRouter.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Bộ định tuyến QuotaRouter tự động xoay vòng API key rồi mới xuống model yếu hơn, lưu trạng thái hết quota 30 phút theo cặp (keyIndex, modelName)',
    content: `package com.example.quizoverlay.network

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
                                val notice = "API $apiNum hết quota -> Đã chuyển sang API \${nextKeyIdx + 1}"
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
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/capture/ScreenCaptureManager.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Chụp nguyên ảnh màn hình qua MediaProjection + VirtualDisplay + ImageReader trên QuizScreenCaptureThread, giữ nguyên độ phân giải (tối đa 2560px) và nén JPEG 92%',
    content: `package com.example.quizoverlay.capture

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

data class CapturedScreenPayload(
    val base64Jpeg: String
)

class ScreenCaptureManager(private val context: Context) {

    companion object {
        private const val THREAD_NAME = "QuizScreenCaptureThread"
        private const val MAX_LONG_EDGE_PX = 2560
        private const val JPEG_QUALITY = 92
    }

    private var handlerThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureWidth: Int = 1080
    private var captureHeight: Int = 2400
    private var screenDensityDpi: Int = DisplayMetrics.DENSITY_HIGH

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            releaseDisplayResources()
        }
    }

    fun initMediaProjection(resultCode: Int, resultData: Intent) {
        releaseAll()
        val thread = HandlerThread(THREAD_NAME).apply { start() }
        handlerThread = thread
        val handler = Handler(thread.looper)
        backgroundHandler = handler

        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            captureWidth = bounds.width()
            captureHeight = bounds.height()
            screenDensityDpi = context.resources.displayMetrics.densityDpi
        } else {
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            captureWidth = metrics.widthPixels
            captureHeight = metrics.heightPixels
            screenDensityDpi = metrics.densityDpi
        }

        val mpManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = mpManager.getMediaProjection(resultCode, resultData)
        projection.registerCallback(projectionCallback, handler)
        mediaProjection = projection

        val reader = ImageReader.newInstance(
            captureWidth,
            captureHeight,
            PixelFormat.RGBA_8888,
            2
        )
        imageReader = reader

        virtualDisplay = projection.createVirtualDisplay(
            "QuizSnapVirtualDisplay",
            captureWidth,
            captureHeight,
            screenDensityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler
        )
    }

    /**
     * Ẩn tạm thời biểu tượng nổi + khung đáp án, chụp nguyên màn hình,
     * khôi phục hiển thị và trả về CapturedScreenPayload(base64Jpeg).
     */
    suspend fun captureFullScreen(
        hideOverlaysBeforeCapture: suspend () -> Unit,
        restoreOverlaysAfterCapture: suspend () -> Unit
    ): CapturedScreenPayload? {
        val reader = imageReader ?: return null
        hideOverlaysBeforeCapture()
        // Đợi 1 nhịp khung hình để WindowManager ẩn hoàn toàn icon/khung đáp án khỏi buffer
        delay(55L)

        val bitmap: Bitmap? = withContext(Dispatchers.Default) {
            var image: Image? = null
            try {
                for (attempt in 1..6) {
                    image = reader.acquireLatestImage()
                    if (image != null) break
                    delay(35L)
                }
                val acquired = image ?: return@withContext null
                imageToBitmap(acquired)
            } finally {
                image?.close()
            }
        }

        restoreOverlaysAfterCapture()
        val rawBitmap = bitmap ?: return null

        return withContext(Dispatchers.Default) {
            val processed = scaleDownIfExceedingMaxEdge(rawBitmap)
            val baos = ByteArrayOutputStream()
            processed.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos)
            if (processed !== rawBitmap) {
                processed.recycle()
            }
            rawBitmap.recycle()
            val base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            CapturedScreenPayload(base64Jpeg = base64)
        }
    }

    private fun imageToBitmap(image: Image): Bitmap {
        val width = image.width
        val height = image.height
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width

        val paddedWidth = width + rowPadding / pixelStride
        val fullBitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        fullBitmap.copyPixelsFromBuffer(buffer)

        return if (rowPadding == 0) {
            fullBitmap
        } else {
            val cropped = Bitmap.createBitmap(fullBitmap, 0, 0, width, height)
            fullBitmap.recycle()
            cropped
        }
    }

    private fun scaleDownIfExceedingMaxEdge(source: Bitmap): Bitmap {
        val w = source.width
        val h = source.height
        val longest = max(w, h)
        if (longest <= MAX_LONG_EDGE_PX) return source

        val ratio = MAX_LONG_EDGE_PX.toFloat() / longest.toFloat()
        val targetW = (w * ratio).roundToInt().coerceAtLeast(1)
        val targetH = (h * ratio).roundToInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, targetW, targetH, true)
    }

    private fun releaseDisplayResources() {
        try {
            virtualDisplay?.release()
        } catch (_: Exception) {}
        virtualDisplay = null

        try {
            imageReader?.close()
        } catch (_: Exception) {}
        imageReader = null
    }

    fun releaseAll() {
        releaseDisplayResources()
        try {
            mediaProjection?.unregisterCallback(projectionCallback)
            mediaProjection?.stop()
        } catch (_: Exception) {}
        mediaProjection = null

        try {
            handlerThread?.quitSafely()
        } catch (_: Exception) {}
        handlerThread = null
        backgroundHandler = null
    }
}
`,
  },
];
