package com.example.quizoverlay.model

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
