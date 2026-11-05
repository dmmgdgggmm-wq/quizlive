package com.example.quizoverlay.data

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
