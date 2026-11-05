package com.example.quizoverlay.service

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.example.quizoverlay.MainActivity
import com.example.quizoverlay.R
import com.example.quizoverlay.capture.CapturedScreenPayload
import com.example.quizoverlay.capture.ScreenCaptureManager
import com.example.quizoverlay.data.OverlaySettings
import com.example.quizoverlay.data.SecureKeyStore
import com.example.quizoverlay.data.SettingsRepository
import com.example.quizoverlay.databinding.OverlayAnswerBoxBinding
import com.example.quizoverlay.databinding.OverlayFloatingIconBinding
import com.example.quizoverlay.model.ActiveRoute
import com.example.quizoverlay.model.ActiveRouteStateHolder
import com.example.quizoverlay.model.ModelStrengthScorer
import com.example.quizoverlay.network.GeminiClient
import com.example.quizoverlay.network.QuotaRouter
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

class FloatingService : LifecycleService() {

    companion object {
        const val ACTION_START = "com.example.quizoverlay.action.START"
        const val ACTION_STOP = "com.example.quizoverlay.action.STOP"
        const val ACTION_RESET_QUOTA_STATE = "com.example.quizoverlay.action.RESET_QUOTA_STATE"

        const val EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE"
        const val EXTRA_RESULT_DATA = "EXTRA_RESULT_DATA"

        const val NOTIFICATION_CHANNEL_ID = "quiz_overlay_foreground_channel"
        const val NOTIFICATION_ID = 1001

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private lateinit var windowManager: WindowManager
    private lateinit var settingsRepository: SettingsRepository
    private lateinit var secureKeyStore: SecureKeyStore
    private lateinit var screenCaptureManager: ScreenCaptureManager
    private val geminiClient = GeminiClient()
    private val quotaRouter = QuotaRouter(geminiClient)

    private var iconBinding: OverlayFloatingIconBinding? = null
    private var iconLayoutParams: WindowManager.LayoutParams? = null

    private var answerBinding: OverlayAnswerBoxBinding? = null
    private var answerLayoutParams: WindowManager.LayoutParams? = null
    private var isAnswerVisible: Boolean = false

    private var currentSettings: OverlaySettings = OverlaySettings()
    private var autoHideAnswerJob: Job? = null

    private val scanMutex = Mutex()
    private val batchQueue = mutableListOf<CapturedScreenPayload>()
    private var hasScannedAtLeastOnce: Boolean = false

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        settingsRepository = SettingsRepository(applicationContext)
        secureKeyStore = SecureKeyStore(applicationContext)
        screenCaptureManager = ScreenCaptureManager(applicationContext)

        createNotificationChannel()
        createFloatingIconOverlay()
        createAnswerBoxOverlay()

        lifecycleScope.launch {
            settingsRepository.settingsFlow.collectLatest { settings ->
                currentSettings = settings
                applySettingsToIconRealtime(settings)
                applySettingsToAnswerBoxRealtime(settings)
                publishCurrentActiveRouteState(
                    modelName = ActiveRouteStateHolder.current().modelUsed.ifBlank { settings.preferredModel }
                )
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                stopForegroundServiceCleanly()
                return START_NOT_STICKY
            }

            ACTION_RESET_QUOTA_STATE -> {
                quotaRouter.resetAllStates()
                publishCurrentActiveRouteState(currentSettings.preferredModel)
                return START_STICKY
            }

            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }

                if (resultCode != Activity.RESULT_OK || resultData == null) {
                    stopForegroundServiceCleanly()
                    return START_NOT_STICKY
                }

                val initialNotification = buildForegroundNotification(
                    contentText = "Chạm biểu tượng tròn để quét màn hình và nhận đáp án"
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        initialNotification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                    )
                } else {
                    startForeground(NOTIFICATION_ID, initialNotification)
                }

                screenCaptureManager.initMediaProjection(resultCode, resultData)
                quotaRouter.resetAllStates()
                hasScannedAtLeastOnce = false

                lifecycleScope.launch {
                    val s = settingsRepository.settingsFlow.first()
                    currentSettings = s
                    publishCurrentActiveRouteState(s.preferredModel)
                }
            }
        }
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Biểu tượng nổi quét trắc nghiệm",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Duy trì biểu tượng nổi và quyền chụp màn hình nhanh"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(contentText: String): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, FloatingService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            2,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_scan)
            .setContentTitle("Biểu tượng quét trắc nghiệm đang chạy")
            .setContentText(contentText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentPendingIntent)
            .addAction(0, "Dừng", stopPendingIntent)
            .build()
    }

    private fun updateNotificationText(contentText: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildForegroundNotification(contentText))
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createFloatingIconOverlay() {
        val inflater = LayoutInflater.from(this)
        val binding = OverlayFloatingIconBinding.inflate(inflater)
        iconBinding = binding

        val touchBoxSizePx = dpToPx(48f)
        val params = WindowManager.LayoutParams(
            touchBoxSizePx,
            touchBoxSizePx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = currentSettings.iconPosX
            y = currentSettings.iconPosY
        }
        iconLayoutParams = params

        val touchSlop = ViewConfiguration.get(this).scaledTouchSlop
        val longPressTimeoutMs = ViewConfiguration.getLongPressTimeout().toLong()
        var downRawX = 0f
        var downRawY = 0f
        var startParamX = 0
        var startParamY = 0
        var isDragging = false
        var longPressTriggered = false
        var longPressJob: Job? = null

        binding.floatingTouchRoot.setOnTouchListener { _, event ->
            val lp = iconLayoutParams ?: return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startParamX = lp.x
                    startParamY = lp.y
                    isDragging = false
                    longPressTriggered = false

                    if (currentSettings.batchModeEnabled) {
                        longPressJob?.cancel()
                        longPressJob = lifecycleScope.launch {
                            delay(longPressTimeoutMs)
                            if (!isDragging) {
                                longPressTriggered = true
                                handleLongPressSendBatch()
                            }
                        }
                    }
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    if (!isDragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                        isDragging = true
                        longPressJob?.cancel()
                    }
                    if (isDragging) {
                        lp.x = (startParamX + dx).roundToInt()
                        lp.y = (startParamY + dy).roundToInt()
                        safeUpdateViewLayout(binding.root, lp)
                    }
                    true
                }

                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    longPressJob?.cancel()
                    if (isDragging) {
                        snapIconToNearestEdge(lp)
                    } else if (!longPressTriggered && event.actionMasked == MotionEvent.ACTION_UP) {
                        handleSingleTapIcon()
                    }
                    true
                }

                else -> false
            }
        }

        windowManager.addView(binding.root, params)
        applySettingsToIconRealtime(currentSettings)
    }

    private fun snapIconToNearestEdge(lp: WindowManager.LayoutParams) {
        val binding = iconBinding ?: return
        val screenWidth = resources.displayMetrics.widthPixels
        val iconWidth = binding.root.width.coerceAtLeast(dpToPx(48f))
        val targetX = if (lp.x + iconWidth / 2 < screenWidth / 2) {
            0
        } else {
            (screenWidth - iconWidth).coerceAtLeast(0)
        }

        ValueAnimator.ofInt(lp.x, targetX).apply {
            duration = 180L
            interpolator = DecelerateInterpolator()
            addUpdateListener { anim ->
                lp.x = anim.animatedValue as Int
                safeUpdateViewLayout(binding.root, lp)
            }
            start()
        }

        lifecycleScope.launch {
            settingsRepository.saveIconPosition(targetX, lp.y)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createAnswerBoxOverlay() {
        val inflater = LayoutInflater.from(this)
        val binding = OverlayAnswerBoxBinding.inflate(inflater)
        answerBinding = binding

        val params = WindowManager.LayoutParams(
            dpToPx(currentSettings.answerWidthDp.toFloat()),
            dpToPx(currentSettings.answerHeightDp.toFloat()),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = currentSettings.answerPosX
            y = currentSettings.answerPosY
        }
        answerLayoutParams = params
        binding.root.visibility = View.GONE

        val touchSlop = ViewConfiguration.get(this).scaledTouchSlop
        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var isDraggingBox = false

        // Kéo di chuyển khung đáp án hoặc chạm nhẹ để ẩn ngay
        binding.answerScrollView.setOnTouchListener { _, event ->
            val lp = answerLayoutParams ?: return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    autoHideAnswerJob?.cancel()
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = lp.x
                    startY = lp.y
                    isDraggingBox = false
                    false
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    if (!isDraggingBox && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                        isDraggingBox = true
                    }
                    if (isDraggingBox) {
                        lp.x = (startX + dx).roundToInt()
                        lp.y = (startY + dy).roundToInt()
                        safeUpdateViewLayout(binding.root, lp)
                        return@setOnTouchListener true
                    }
                    false
                }

                MotionEvent.ACTION_UP -> {
                    if (isDraggingBox) {
                        lifecycleScope.launch {
                            settingsRepository.saveAnswerBounds(
                                x = lp.x,
                                y = lp.y,
                                widthDp = pxToDp(lp.width),
                                heightDp = pxToDp(lp.height)
                            )
                        }
                        scheduleAutoHideAnswer()
                        return@setOnTouchListener true
                    } else {
                        hideAnswerOverlayImmediately()
                        return@setOnTouchListener true
                    }
                }

                else -> false
            }
        }

        // Tay nắm góc dưới phải để đổi kích thước khung đáp án (kích thước tối thiểu 48x32dp)
        var resizeStartW = 0
        var resizeStartH = 0
        var resizeDownX = 0f
        var resizeDownY = 0f
        binding.resizeHandle.setOnTouchListener { _, event ->
            val lp = answerLayoutParams ?: return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    autoHideAnswerJob?.cancel()
                    resizeDownX = event.rawX
                    resizeDownY = event.rawY
                    resizeStartW = lp.width
                    resizeStartH = lp.height
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val minSizePx = dpToPx(24f)
                    lp.width = (resizeStartW + (event.rawX - resizeDownX).roundToInt()).coerceAtLeast(minSizePx)
                    lp.height = (resizeStartH + (event.rawY - resizeDownY).roundToInt()).coerceAtLeast(minSizePx)
                    safeUpdateViewLayout(binding.root, lp)
                    true
                }

                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    lifecycleScope.launch {
                        settingsRepository.saveAnswerBounds(
                            x = lp.x,
                            y = lp.y,
                            widthDp = pxToDp(lp.width),
                            heightDp = pxToDp(lp.height)
                        )
                    }
                    scheduleAutoHideAnswer()
                    true
                }

                else -> false
            }
        }

        windowManager.addView(binding.root, params)
        applySettingsToAnswerBoxRealtime(currentSettings)
    }

    private fun applySettingsToIconRealtime(settings: OverlaySettings) {
        val binding = iconBinding ?: return
        val diameterPx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_MM,
            settings.iconDiameterMm.coerceIn(2.0f, 15.0f),
            resources.displayMetrics
        ).roundToInt().coerceAtLeast(dpToPx(8f))

        val touchSizePx = maxOf(dpToPx(48f), diameterPx + dpToPx(12f))
        iconLayoutParams?.let { lp ->
            if (lp.width != touchSizePx || lp.height != touchSizePx) {
                lp.width = touchSizePx
                lp.height = touchSizePx
                safeUpdateViewLayout(binding.root, lp)
            }
        }

        val dotLp = binding.floatingDotView.layoutParams
        dotLp.width = diameterPx
        dotLp.height = diameterPx
        binding.floatingDotView.layoutParams = dotLp

        val parsedColor = parseHexColorOrDefault(settings.iconColorHex, Color.parseColor("#10B981"))
        val circleDrawable = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(parsedColor)
        }
        binding.floatingDotView.background = circleDrawable

        // Alpha chỉ áp dụng cho chấm tròn bên trong; vùng chạm floatingTouchRoot vẫn nhận touch kể cả ở 0%
        binding.floatingDotView.alpha = (settings.iconAlphaPercent.coerceIn(0, 100)) / 100f
    }

    private fun applySettingsToAnswerBoxRealtime(settings: OverlaySettings) {
        val binding = answerBinding ?: return
        binding.tvAnswerContent.setTextSize(TypedValue.COMPLEX_UNIT_SP, settings.answerTextSizeSp.toFloat())
        val textColor = parseHexColorOrDefault(settings.answerTextColorHex, Color.WHITE)
        binding.tvAnswerContent.setTextColor(textColor)
        binding.tvAnswerContent.gravity = Gravity.CENTER
        binding.tvAnswerContent.includeFontPadding = false
        binding.tvAnswerContent.setShadowLayer(8f, 0f, 1.5f, Color.parseColor("#D9000000"))
        binding.answerScrollView.setBackgroundColor(Color.TRANSPARENT)
        binding.tvAnswerContent.setBackgroundColor(Color.TRANSPARENT)

        val boxDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dpToPx(6f).toFloat()
            setColor(Color.TRANSPARENT) // Khung nền trong suốt 100%
            if (settings.answerHideBorder) {
                setStroke(0, Color.TRANSPARENT)
            } else {
                setStroke(dpToPx(1f), Color.parseColor("#6694A3B8"))
            }
        }
        binding.answerBoxRoot.background = boxDrawable
        binding.answerBoxRoot.setPadding(0, 0, 0, 0)
        // Không hiển thị dấu chấm màu xanh (dùng màu trong suốt, vẫn hỗ trợ chạm kéo thay đổi cỡ)
        binding.resizeHandle.setBackgroundColor(Color.TRANSPARENT)
    }

    private fun handleSingleTapIcon() {
        if (scanMutex.isLocked) {
            // Đang xử lý thì bỏ qua chạm mới
            return
        }
        lifecycleScope.launch {
            if (!scanMutex.tryLock()) return@launch
            try {
                animateIconScanningPulse(true)
                val payload = screenCaptureManager.captureFullScreen(
                    hideOverlaysBeforeCapture = {
                        iconBinding?.root?.visibility = View.INVISIBLE
                        if (isAnswerVisible) {
                            answerBinding?.root?.visibility = View.INVISIBLE
                        }
                    },
                    restoreOverlaysAfterCapture = {
                        iconBinding?.root?.visibility = View.VISIBLE
                        if (isAnswerVisible) {
                            answerBinding?.root?.visibility = View.VISIBLE
                        }
                    }
                )

                if (payload == null) {
                    showAnswerOverlayText("Không chụp được màn hình.")
                    return@launch
                }

                if (currentSettings.batchModeEnabled) {
                    batchQueue.add(payload)
                    showAnswerOverlayText("+${batchQueue.size}")
                } else {
                    sendPayloadsThroughQuotaRouter(listOf(payload))
                }
            } finally {
                animateIconScanningPulse(false)
                scanMutex.unlock()
            }
        }
    }

    private fun handleLongPressSendBatch() {
        if (scanMutex.isLocked) return
        lifecycleScope.launch {
            if (!scanMutex.tryLock()) return@launch
            try {
                if (batchQueue.isEmpty()) {
                    // Nếu hàng đợi đang trống mà nhấn giữ thì chụp 1 ảnh và gửi ngay
                    val single = screenCaptureManager.captureFullScreen(
                        hideOverlaysBeforeCapture = {
                            iconBinding?.root?.visibility = View.INVISIBLE
                            if (isAnswerVisible) answerBinding?.root?.visibility = View.INVISIBLE
                        },
                        restoreOverlaysAfterCapture = {
                            iconBinding?.root?.visibility = View.VISIBLE
                            if (isAnswerVisible) answerBinding?.root?.visibility = View.VISIBLE
                        }
                    )
                    if (single != null) {
                        sendPayloadsThroughQuotaRouter(listOf(single))
                    }
                    return@launch
                }

                val toSend = batchQueue.toList()
                batchQueue.clear()
                sendPayloadsThroughQuotaRouter(toSend)
            } finally {
                scanMutex.unlock()
            }
        }
    }

    private suspend fun sendPayloadsThroughQuotaRouter(payloads: List<CapturedScreenPayload>) {
        showAnswerOverlayText(if (payloads.size > 1) "… (${payloads.size})" else "…")
        val keys = secureKeyStore.getApiKeys()
        val settings = currentSettings
        val modelChain = ModelStrengthScorer.buildModelChain(
            sortedModels = settings.cachedModels,
            preferredModel = settings.preferredModel,
            autoFallback = settings.autoFallbackModel
        )

        val result = quotaRouter.executeScanWithFailover(
            apiKeys = keys,
            modelChain = modelChain,
            preferredModel = settings.preferredModel,
            payloads = payloads,
            customPrompt = settings.customPrompt,
            thinkingLevel = settings.thinkingLevel,
            onTransitionNotice = { newModel, newApiIndex1Based, notice ->
                showAnswerOverlayText(notice)
                publishActiveRouteUpdate(
                    modelUsed = newModel,
                    apiIndex = newApiIndex1Based,
                    keys = keys,
                    scanTime = ActiveRouteStateHolder.current().lastScanTime,
                    latencyMs = ActiveRouteStateHolder.current().lastLatencyMs
                )
            }
        )

        val nowText = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        hasScannedAtLeastOnce = true

        publishActiveRouteUpdate(
            modelUsed = result.modelUsed,
            apiIndex = result.apiIndex,
            keys = keys,
            scanTime = nowText,
            latencyMs = if (result.ok) result.latencyMs else null
        )

        if (result.ok) {
            settingsRepository.saveLastUsedRoute(
                modelUsed = result.modelUsed,
                apiIndex = result.apiIndex,
                keyTail4 = result.keyTail4,
                scanTimeText = nowText,
                latencyMs = result.latencyMs
            )
        }

        showAnswerOverlayText(result.displayText)
    }

    private fun publishCurrentActiveRouteState(modelName: String) {
        val keys = secureKeyStore.getApiKeys()
        val activeIdx1Based = if (keys.isEmpty()) 1 else (quotaRouter.activeKeyIndex % keys.size) + 1
        publishActiveRouteUpdate(
            modelUsed = modelName,
            apiIndex = activeIdx1Based,
            keys = keys,
            scanTime = ActiveRouteStateHolder.current().lastScanTime ?: currentSettings.lastScanTimeText,
            latencyMs = ActiveRouteStateHolder.current().lastLatencyMs ?: currentSettings.lastScanLatencyMs
        )
    }

    private fun publishActiveRouteUpdate(
        modelUsed: String,
        apiIndex: Int,
        keys: List<String>,
        scanTime: String?,
        latencyMs: Long?
    ) {
        val cleanModel = ModelStrengthScorer.normalizeModelName(modelUsed)
        val cleanPreferred = ModelStrengthScorer.normalizeModelName(currentSettings.preferredModel)
        val safeApiIndex = if (keys.isEmpty()) 1 else apiIndex.coerceIn(1, keys.size)
        val tail4 = keys.getOrNull(safeApiIndex - 1)?.let { SecureKeyStore.maskKeyTail4(it) } ?: "...????"
        val isFallback = !cleanModel.equals(cleanPreferred, ignoreCase = true)

        val statuses = quotaRouter.buildApiStatusesForModel(
            apiKeys = keys,
            modelName = cleanModel,
            isServiceActive = isRunning && hasScannedAtLeastOnce
        )

        val newRoute = ActiveRoute(
            isServiceRunning = isRunning,
            hasScannedInSession = hasScannedAtLeastOnce,
            modelUsed = cleanModel,
            preferredModel = cleanPreferred,
            apiIndex = safeApiIndex,
            apiCount = keys.size,
            keyTail4 = tail4,
            isFallback = isFallback,
            lastScanTime = scanTime,
            lastLatencyMs = latencyMs,
            apiStatuses = statuses
        )
        ActiveRouteStateHolder.update(newRoute)

        if (hasScannedAtLeastOnce && keys.isNotEmpty()) {
            updateNotificationText("Đang dùng: $cleanModel · API $safeApiIndex/${keys.size}")
        }
    }

    private fun showAnswerOverlayText(text: String) {
        val binding = answerBinding ?: return
        binding.tvAnswerContent.text = text
        binding.root.visibility = View.VISIBLE
        isAnswerVisible = true
        scheduleAutoHideAnswer()
    }

    private fun scheduleAutoHideAnswer() {
        autoHideAnswerJob?.cancel()
        val seconds = currentSettings.answerAutoHideSeconds
        if (seconds <= 0) return
        autoHideAnswerJob = lifecycleScope.launch {
            delay(seconds * 1000L)
            hideAnswerOverlayImmediately()
        }
    }

    private fun hideAnswerOverlayImmediately() {
        autoHideAnswerJob?.cancel()
        answerBinding?.root?.visibility = View.GONE
        isAnswerVisible = false
    }

    private fun animateIconScanningPulse(scanning: Boolean) {
        val dot = iconBinding?.floatingDotView ?: return
        dot.animate()
            .scaleX(if (scanning) 1.22f else 1.0f)
            .scaleY(if (scanning) 1.22f else 1.0f)
            .setDuration(150L)
            .start()
    }

    private fun safeUpdateViewLayout(view: View, params: WindowManager.LayoutParams) {
        try {
            if (view.isAttachedToWindow) {
                windowManager.updateViewLayout(view, params)
            }
        } catch (_: Exception) {}
    }

    private fun parseHexColorOrDefault(hex: String, defaultColor: Int): Int {
        return try {
            val formatted = if (hex.trim().startsWith("#")) hex.trim() else "#${hex.trim()}"
            Color.parseColor(formatted)
        } catch (_: Exception) {
            defaultColor
        }
    }

    private fun dpToPx(dp: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp,
            resources.displayMetrics
        ).roundToInt()
    }

    private fun pxToDp(px: Int): Int {
        val density = resources.displayMetrics.density.coerceAtLeast(1f)
        return (px / density).roundToInt()
    }

    private fun stopForegroundServiceCleanly() {
        isRunning = false
        val curr = ActiveRouteStateHolder.current()
        ActiveRouteStateHolder.update(curr.copy(isServiceRunning = false, hasScannedInSession = false))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        isRunning = false
        autoHideAnswerJob?.cancel()
        screenCaptureManager.releaseAll()

        iconBinding?.root?.let {
            try {
                windowManager.removeView(it)
            } catch (_: Exception) {}
        }
        iconBinding = null

        answerBinding?.root?.let {
            try {
                windowManager.removeView(it)
            } catch (_: Exception) {}
        }
        answerBinding = null

        val curr = ActiveRouteStateHolder.current()
        ActiveRouteStateHolder.update(curr.copy(isServiceRunning = false, hasScannedInSession = false))
        super.onDestroy()
    }
}
