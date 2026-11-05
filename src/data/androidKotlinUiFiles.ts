import { AndroidSourceFile } from './androidXmlAndGradleFiles';

export const ANDROID_KOTLIN_UI_FILES: AndroidSourceFile[] = [
  {
    path: 'app/src/main/java/com/example/quizoverlay/service/FloatingService.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Foreground Service (type mediaProjection) quản lý biểu tượng nổi 3mm hít cạnh, khung đáp án siêu nhỏ 48x32dp kéo/đổi cỡ, chế độ gửi hàng loạt, QuotaRouter và phát ActiveRouteState realtime',
    content: `package com.example.quizoverlay.service

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
                    showAnswerOverlayText("+\${batchQueue.size}")
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
        showAnswerOverlayText(if (payloads.size > 1) "… (\${payloads.size})" else "…")
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
            updateNotificationText("Đang dùng: $cleanModel · API $safeApiIndex/\${keys.size}")
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
            val formatted = if (hex.trim().startsWith("#")) hex.trim() else "#\${hex.trim()}"
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
`,
  },
  {
    path: 'app/src/main/java/com/example/quizoverlay/MainActivity.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Màn hình cài đặt chính dùng ViewBinding, cập nhật thẻ ĐANG DÙNG realtime qua StateFlow, dò model, vẽ ảnh test, ping 0-quota và điều chỉnh biểu tượng nổi trực tiếp',
    content: `package com.example.quizoverlay

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.example.quizoverlay.capture.CapturedScreenPayload
import com.example.quizoverlay.data.OverlaySettings
import com.example.quizoverlay.data.SecureKeyStore
import com.example.quizoverlay.data.SettingsRepository
import com.example.quizoverlay.databinding.ActivityMainBinding
import com.example.quizoverlay.model.ActiveRoute
import com.example.quizoverlay.model.ActiveRouteStateHolder
import com.example.quizoverlay.model.ApiKeyStatusType
import com.example.quizoverlay.model.ModelStrengthScorer
import com.example.quizoverlay.network.GeminiClient
import com.example.quizoverlay.network.SingleCallOutcome
import com.example.quizoverlay.service.FloatingService
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.ceil
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var settingsRepository: SettingsRepository
    private lateinit var secureKeyStore: SecureKeyStore
    private val geminiClient = GeminiClient()

    private var currentSettings: OverlaySettings = OverlaySettings()
    private var isKeysVisible: Boolean = false
    private var isActiveRouteCardExpanded: Boolean = true
    private var isUpdatingUiFromFlow: Boolean = false
    private var promptSaveJob: Job? = null

    private val thinkingOptions = listOf(
        "Low (Phản hồi nhanh nhất)" to "low",
        "Medium (Cân bằng)" to "medium",
        "High (Suy luận sâu)" to "high"
    )

    private val iconQuickColors = listOf(
        "#10B981", "#38BDF8", "#FACC15", "#FB7185", "#FFFFFF", "#A78BFA"
    )

    private val answerQuickColors = listOf(
        "Trắng" to "#FFFFFF",
        "Xanh lá" to "#34D399",
        "Vàng" to "#FACC15",
        "Xanh lam" to "#38BDF8",
        "Đỏ hồng" to "#FB7185",
        "Xám mờ" to "#94A3B8"
    )

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            proceedToToggleService()
        } else {
            Toast.makeText(
                this,
                "Cần quyền thông báo để hiển thị trạng thái biểu tượng nổi.",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    private val mediaProjectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            val serviceIntent = Intent(this, FloatingService::class.java).apply {
                action = FloatingService.ACTION_START
                putExtra(FloatingService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(FloatingService.EXTRA_RESULT_DATA, data)
            }
            ContextCompat.startForegroundService(this, serviceIntent)
            updateToggleButtonState(true)
        } else {
            Toast.makeText(
                this,
                "Bạn cần cấp quyền chụp màn hình để biểu tượng có thể quét câu hỏi.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        settingsRepository = SettingsRepository(applicationContext)
        secureKeyStore = SecureKeyStore(applicationContext)

        setupTopButtons()
        setupActiveRouteCardInteraction()
        setupOverlayPermissionCard()
        setupGeminiApiAndModelCard()
        setupFloatingIconRealtimeCard()
        setupAnswerOverlayCard()
        observeSettingsAndActiveRoute()
    }

    override fun onResume() {
        super.onResume()
        refreshOverlayPermissionStatus()
        updateToggleButtonState(FloatingService.isRunning)
    }

    private fun setupTopButtons() {
        binding.btnToggleService.setOnClickListener {
            if (FloatingService.isRunning) {
                val stopIntent = Intent(this, FloatingService::class.java).apply {
                    action = FloatingService.ACTION_STOP
                }
                startService(stopIntent)
                updateToggleButtonState(false)
            } else {
                proceedToToggleService()
            }
        }

        binding.btnResetDefault.setOnClickListener {
            lifecycleScope.launch {
                settingsRepository.resetIconDefaults()
                Toast.makeText(
                    this@MainActivity,
                    "Đã đặt lại kích thước, độ trong suốt và màu xanh lá mặc định.",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    /**
     * Luồng bật dịch vụ kiểm tra tuần tự 1 -> 5:
     * 1) Quyền SYSTEM_ALERT_WINDOW (Overlay)
     * 2) Quyền POST_NOTIFICATIONS (Android 13+)
     * 3) Đã có ít nhất 1 Gemini API Key
     * 4) Xin quyền MediaProjectionManager.createScreenCaptureIntent()
     * 5) Khởi chạy FloatingService (ACTION_START + resultCode + data)
     */
    private fun proceedToToggleService() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(
                this,
                "Vui lòng cấp quyền 'Hiển thị trên ứng dụng khác' trước.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }

        val currentTypedKeys = SecureKeyStore.parseKeys(binding.etApiKeys.text?.toString().orEmpty())
        val storedKeys = if (currentTypedKeys.isNotEmpty()) {
            secureKeyStore.saveApiKeysFromText(binding.etApiKeys.text.toString())
        } else {
            secureKeyStore.getApiKeys()
        }

        if (storedKeys.isEmpty()) {
            Toast.makeText(
                this,
                "Vui lòng nhập Gemini API Key ở mục số 2 trước khi bật biểu tượng nổi!",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        val mpManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjectionLauncher.launch(mpManager.createScreenCaptureIntent())
    }

    private fun updateToggleButtonState(running: Boolean) {
        if (running) {
            binding.btnToggleService.text = "Tắt biểu tượng nổi"
            binding.btnToggleService.setBackgroundColor(Color.parseColor("#FB7185"))
            binding.btnToggleService.setTextColor(Color.parseColor("#022C22"))
        } else {
            binding.btnToggleService.text = "Bật biểu tượng nổi"
            binding.btnToggleService.setBackgroundColor(Color.parseColor("#10B981"))
            binding.btnToggleService.setTextColor(Color.parseColor("#022C22"))
        }
    }

    private fun setupActiveRouteCardInteraction() {
        binding.cardActiveRoute.setOnClickListener {
            isActiveRouteCardExpanded = !isActiveRouteCardExpanded
            binding.layoutApiStatusList.visibility =
                if (isActiveRouteCardExpanded) View.VISIBLE else View.GONE
        }
    }

    private fun setupOverlayPermissionCard() {
        refreshOverlayPermissionStatus()
        binding.btnGrantOverlayPermission.setOnClickListener {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }
    }

    private fun refreshOverlayPermissionStatus() {
        val granted = Settings.canDrawOverlays(this)
        val statusText = if (granted) "ĐÃ CẤP" else "CHƯA CẤP"
        binding.tvOverlayPermissionStatus.text =
            "Quyền hiển thị trên ứng dụng khác (Overlay): $statusText"
        binding.tvOverlayPermissionStatus.setTextColor(
            Color.parseColor(if (granted) "#34D399" else "#FACC15")
        )
    }

    private fun setupGeminiApiAndModelCard() {
        val savedKeys = secureKeyStore.getApiKeys()
        if (savedKeys.isNotEmpty()) {
            binding.etApiKeys.setText(savedKeys.joinToString("\\n"))
        }

        binding.btnToggleShowKeys.setOnClickListener {
            isKeysVisible = !isKeysVisible
            if (isKeysVisible) {
                binding.etApiKeys.inputType =
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                binding.btnToggleShowKeys.text = "Ẩn Key"
            } else {
                binding.etApiKeys.inputType =
                    InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_VARIATION_PASSWORD
                binding.btnToggleShowKeys.text = "Hiện Key"
            }
            binding.etApiKeys.setSelection(binding.etApiKeys.text?.length ?: 0)
        }

        binding.tvCreateKeyLink.setOnClickListener {
            val browserIntent = Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://aistudio.google.com/apikey")
            )
            startActivity(browserIntent)
        }

        // Spinner mức suy luận (thinkingConfig)
        val thinkingAdapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_item,
            thinkingOptions.map { it.first }
        ).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        binding.spinnerThinkingLevel.adapter = thinkingAdapter
        binding.spinnerThinkingLevel.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                (parent?.getChildAt(0) as? TextView)?.setTextColor(Color.parseColor("#F8FAFC"))
                if (isUpdatingUiFromFlow) return
                val levelCode = thinkingOptions.getOrNull(position)?.second ?: "low"
                lifecycleScope.launch {
                    settingsRepository.setThinkingLevel(levelCode)
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        // Switch Tự chuyển xuống model yếu hơn khi hết quota
        binding.switchAutoFallbackModel.setOnCheckedChangeListener { _, isChecked ->
            if (isUpdatingUiFromFlow) return@setOnCheckedChangeListener
            lifecycleScope.launch {
                settingsRepository.setAutoFallbackModel(isChecked)
            }
        }

        // Prompt tùy chỉnh: tự lưu khi gõ
        binding.etCustomPrompt.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (isUpdatingUiFromFlow) return
                val text = s?.toString().orEmpty()
                promptSaveJob?.cancel()
                promptSaveJob = lifecycleScope.launch {
                    delay(250L)
                    settingsRepository.setCustomPrompt(text)
                }
            }
        })

        // Nút Lưu Key & Dò Model
        binding.btnSaveAndProbeModels.setOnClickListener {
            handleSaveKeysAndProbeModels(isRefreshOnly = false)
        }

        // Nút Làm mới DS Model
        binding.btnRefreshModels.setOnClickListener {
            handleSaveKeysAndProbeModels(isRefreshOnly = true)
        }

        // Nút Thử đọc ảnh (test model)
        binding.btnTestReadImage.setOnClickListener {
            handleTestReadSampleQuizImage()
        }

        // Nút Kiểm tra kết nối (Ping - 0 Quota)
        binding.btnPingConnection.setOnClickListener {
            handlePingModelsZeroQuota()
        }
    }

    private fun handleSaveKeysAndProbeModels(isRefreshOnly: Boolean) {
        val rawInput = binding.etApiKeys.text?.toString().orEmpty()
        val parsedKeys = SecureKeyStore.parseKeys(rawInput)

        if (parsedKeys.isEmpty()) {
            if (!isRefreshOnly) {
                secureKeyStore.clearKeys()
                binding.tvModelProbeStatus.text = "Trạng thái: Đã xóa danh sách API key."
            } else {
                binding.tvModelProbeStatus.text = "Trạng thái: Vui lòng nhập ít nhất một API key."
            }
            renderActiveRouteCard(ActiveRouteStateHolder.current(), currentSettings)
            return
        }

        val savedKeys = secureKeyStore.saveApiKeysFromText(rawInput)
        if (FloatingService.isRunning) {
            val resetIntent = Intent(this, FloatingService::class.java).apply {
                action = FloatingService.ACTION_RESET_QUOTA_STATE
            }
            startService(resetIntent)
        }

        lifecycleScope.launch {
            binding.tvModelProbeStatus.text = "Trạng thái: Đang dò model bằng \${savedKeys.size} API key..."
            val discovered = withContext(Dispatchers.IO) {
                geminiClient.discoverModels(savedKeys)
            }
            if (discovered.isNotEmpty()) {
                val chosenPreferred = if (discovered.contains(currentSettings.preferredModel)) {
                    currentSettings.preferredModel
                } else {
                    ModelStrengthScorer.selectDefaultPreferredModel(discovered)
                }
                settingsRepository.saveDiscoveredModels(discovered, chosenPreferred)
                binding.tvModelProbeStatus.text = "Trạng thái: Đã tải \${discovered.size} model"
            } else {
                binding.tvModelProbeStatus.text =
                    "Trạng thái: Không tải được danh sách model từ các API key đã nhập."
            }
            renderActiveRouteCard(ActiveRouteStateHolder.current(), currentSettings)
        }
    }

    private fun handleTestReadSampleQuizImage() {
        val keys = secureKeyStore.getApiKeys()
        if (keys.isEmpty()) {
            binding.tvDiagnosticResult.visibility = View.VISIBLE
            binding.tvDiagnosticResult.text = "Vui lòng nhập ít nhất một API key."
            return
        }

        val activeIdx = (ActiveRouteStateHolder.current().apiIndex - 1).coerceIn(0, keys.lastIndex)
        val selectedKey = keys[activeIdx]
        val apiNum = activeIdx + 1
        val model = currentSettings.preferredModel

        lifecycleScope.launch {
            binding.tvDiagnosticResult.visibility = View.VISIBLE
            binding.tvDiagnosticResult.text = "Đang gửi ảnh câu hỏi thử tới $model (API $apiNum)..."

            val base64Jpeg = withContext(Dispatchers.Default) {
                createTestQuizBitmapBase64()
            }

            val outcome = withContext(Dispatchers.IO) {
                geminiClient.callSingleModelWithThinkingCompatibility(
                    apiKey = selectedKey,
                    modelName = model,
                    payloads = listOf(CapturedScreenPayload(base64Jpeg)),
                    customPrompt = currentSettings.customPrompt,
                    thinkingLevel = currentSettings.thinkingLevel
                )
            }

            when (outcome) {
                is SingleCallOutcome.Success -> {
                    binding.tvDiagnosticResult.setTextColor(Color.parseColor("#34D399"))
                    binding.tvDiagnosticResult.text =
                        "Đọc ảnh OK: \${outcome.text} (\${outcome.latencyMs} ms) · $model · API $apiNum"
                }

                is SingleCallOutcome.HttpError -> {
                    binding.tvDiagnosticResult.setTextColor(Color.parseColor("#FACC15"))
                    val rawLower = (outcome.rawBody + " " + outcome.errorMessage).lowercase()
                    if (outcome.httpCode == 429 && (rawLower.contains("limit: 0") || rawLower.contains("quota limit 0"))) {
                        binding.tvDiagnosticResult.text = "Model này không có quota trên API $apiNum"
                    } else {
                        val reason = outcome.errorMessage.ifBlank { "HTTP \${outcome.httpCode}" }
                        binding.tvDiagnosticResult.text =
                            "Thất bại (HTTP \${outcome.httpCode} / $reason)"
                    }
                }

                is SingleCallOutcome.NetworkFailure -> {
                    binding.tvDiagnosticResult.setTextColor(Color.parseColor("#FB7185"))
                    binding.tvDiagnosticResult.text = "Thất bại (Kiểm tra lại kết nối mạng)"
                }
            }
        }
    }

    /**
     * Tự vẽ một bitmap nhỏ có chữ "Câu hỏi thử: 1 + 1 = ? A. 1  B. 2  C. 3  D. 4"
     */
    private fun createTestQuizBitmapBase64(): String {
        val bmp = Bitmap.createBitmap(640, 180, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 28f
            isFakeBoldText = true
        }
        canvas.drawText("Câu hỏi thử: 1 + 1 = ?", 28f, 70f, paint)
        paint.isFakeBoldText = false
        canvas.drawText("A. 1    B. 2    C. 3    D. 4", 28f, 130f, paint)

        val baos = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 92, baos)
        bmp.recycle()
        return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
    }

    private fun handlePingModelsZeroQuota() {
        val keys = secureKeyStore.getApiKeys()
        if (keys.isEmpty()) {
            binding.tvDiagnosticResult.visibility = View.VISIBLE
            binding.tvDiagnosticResult.text = "Vui lòng nhập ít nhất một API key."
            return
        }
        val model = currentSettings.preferredModel
        lifecycleScope.launch {
            binding.tvDiagnosticResult.visibility = View.VISIBLE
            binding.tvDiagnosticResult.setTextColor(Color.parseColor("#CBD5E1"))
            binding.tvDiagnosticResult.text = "Đang Ping (0 Quota) tới $model trên \${keys.size} API key..."

            val results = withContext(Dispatchers.IO) {
                geminiClient.pingModelAcrossKeys(model, keys)
            }
            binding.tvDiagnosticResult.text = results.joinToString("\\n") { it.message }
        }
    }

    private fun setupFloatingIconRealtimeCard() {
        // SeekBar Đường kính (2mm - 15mm), progress 0..130 => mm = 2.0 + progress / 10f
        binding.seekBarIconDiameter.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                val mm = 2.0f + (progress / 10.0f)
                val approxDp = (mm * (160f / 25.4f)).roundToInt()
                binding.tvIconDiameterValue.text = String.format(Locale.US, "%.1f mm (~%d dp)", mm, approxDp)
                if (fromUser && !isUpdatingUiFromFlow) {
                    lifecycleScope.launch { settingsRepository.setIconDiameterMm(mm) }
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        // SeekBar Độ hiển thị / Trong suốt (0% - 100%)
        binding.seekBarIconAlpha.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                binding.tvIconAlphaValue.text = if (progress == 0) {
                    "0% (Vô hình - vẫn chạm được)"
                } else {
                    "$progress%"
                }
                if (fromUser && !isUpdatingUiFromFlow) {
                    lifecycleScope.launch { settingsRepository.setIconAlphaPercent(progress) }
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        binding.etIconColorHex.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (isUpdatingUiFromFlow) return
                val hex = s?.toString()?.trim().orEmpty()
                if (hex.matches(Regex("^#?[0-9A-Fa-f]{6}$"))) {
                    val normalized = if (hex.startsWith("#")) hex.uppercase() else "#\${hex.uppercase()}"
                    lifecycleScope.launch { settingsRepository.setIconColorHex(normalized) }
                }
            }
        })

        // 6 nút màu nhanh cho biểu tượng nổi
        binding.layoutIconQuickColors.removeAllViews()
        iconQuickColors.forEach { hex ->
            val btn = MaterialButton(this).apply {
                text = hex
                textSize = 10f
                isAllCaps = false
                setBackgroundColor(Color.parseColor(hex))
                setTextColor(Color.parseColor("#022C22"))
                val lp = LinearLayout.LayoutParams(0, dpToPx(36)).apply {
                    weight = 1f
                    marginEnd = dpToPx(4)
                }
                layoutParams = lp
                setOnClickListener {
                    binding.etIconColorHex.setText(hex)
                    lifecycleScope.launch { settingsRepository.setIconColorHex(hex) }
                }
            }
            binding.layoutIconQuickColors.addView(btn)
        }
    }

    private fun setupAnswerOverlayCard() {
        // Kích thước chữ đáp án: 10sp..32sp (progress 0..22)
        binding.seekBarAnswerTextSize.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                val sp = 10 + progress
                binding.tvAnswerTextSizeValue.text = "$sp sp"
                if (fromUser && !isUpdatingUiFromFlow) {
                    lifecycleScope.launch { settingsRepository.setAnswerTextSizeSp(sp) }
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        // Thời gian tự ẩn khung đáp án: 0..30 giây
        binding.seekBarAnswerAutoHide.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                binding.tvAnswerAutoHideValue.text = if (progress == 0) {
                    "0 giây (Không tự ẩn)"
                } else {
                    "$progress giây"
                }
                if (fromUser && !isUpdatingUiFromFlow) {
                    lifecycleScope.launch { settingsRepository.setAnswerAutoHideSeconds(progress) }
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        binding.switchAnswerHideBorder.setOnCheckedChangeListener { _, isChecked ->
            if (isUpdatingUiFromFlow) return@setOnCheckedChangeListener
            lifecycleScope.launch { settingsRepository.setAnswerHideBorder(isChecked) }
        }

        binding.etAnswerTextColorHex.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (isUpdatingUiFromFlow) return
                val hex = s?.toString()?.trim().orEmpty()
                if (hex.matches(Regex("^#?[0-9A-Fa-f]{6}$"))) {
                    val normalized = if (hex.startsWith("#")) hex.uppercase() else "#\${hex.uppercase()}"
                    lifecycleScope.launch { settingsRepository.setAnswerTextColorHex(normalized) }
                }
            }
        })

        binding.layoutAnswerQuickColors.removeAllViews()
        answerQuickColors.forEach { (label, hex) ->
            val btn = MaterialButton(this).apply {
                text = label
                textSize = 10f
                isAllCaps = false
                setBackgroundColor(Color.parseColor("#334155"))
                setTextColor(Color.parseColor(hex))
                val lp = LinearLayout.LayoutParams(0, dpToPx(36)).apply {
                    weight = 1f
                    marginEnd = dpToPx(4)
                }
                layoutParams = lp
                setOnClickListener {
                    binding.etAnswerTextColorHex.setText(hex)
                    lifecycleScope.launch { settingsRepository.setAnswerTextColorHex(hex) }
                }
            }
            binding.layoutAnswerQuickColors.addView(btn)
        }

        binding.switchBatchMode.setOnCheckedChangeListener { _, isChecked ->
            if (isUpdatingUiFromFlow) return@setOnCheckedChangeListener
            lifecycleScope.launch { settingsRepository.setBatchModeEnabled(isChecked) }
        }
    }

    private fun observeSettingsAndActiveRoute() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    settingsRepository.settingsFlow.collectLatest { settings ->
                        currentSettings = settings
                        bindSettingsToControls(settings)
                        renderActiveRouteCard(ActiveRouteStateHolder.current(), settings)
                    }
                }

                launch {
                    ActiveRouteStateHolder.state.collectLatest { route ->
                        updateToggleButtonState(route.isServiceRunning)
                        renderActiveRouteCard(route, currentSettings)
                    }
                }

                // Bộ đếm ngược thời gian còn bị bỏ qua của mỗi cặp (key, model)
                launch {
                    while (isActive) {
                        delay(1000L)
                        renderActiveRouteCard(ActiveRouteStateHolder.current(), currentSettings)
                    }
                }
            }
        }
    }

    private fun bindSettingsToControls(settings: OverlaySettings) {
        isUpdatingUiFromFlow = true
        try {
            // Cập nhật Spinner Model ưu tiên (mỗi dòng chỉ hiển thị tên model, không nhãn FREE)
            val currentAdapter = binding.spinnerPreferredModel.adapter as? ArrayAdapter<*>
            val currentItems = (0 until (currentAdapter?.count ?: 0)).map {
                currentAdapter?.getItem(it)?.toString().orEmpty()
            }
            if (currentItems != settings.cachedModels) {
                val modelAdapter = ArrayAdapter(
                    this,
                    android.R.layout.simple_spinner_item,
                    settings.cachedModels
                ).apply {
                    setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                }
                binding.spinnerPreferredModel.adapter = modelAdapter
                binding.spinnerPreferredModel.onItemSelectedListener =
                    object : AdapterView.OnItemSelectedListener {
                        override fun onItemSelected(
                            parent: AdapterView<*>?,
                            view: View?,
                            position: Int,
                            id: Long
                        ) {
                            (parent?.getChildAt(0) as? TextView)?.setTextColor(Color.parseColor("#F8FAFC"))
                            if (isUpdatingUiFromFlow) return
                            val selected = settings.cachedModels.getOrNull(position) ?: return
                            lifecycleScope.launch { settingsRepository.setPreferredModel(selected) }
                        }
                        override fun onNothingSelected(parent: AdapterView<*>?) {}
                    }
            }
            val modelIdx = settings.cachedModels.indexOf(settings.preferredModel).coerceAtLeast(0)
            if (binding.spinnerPreferredModel.selectedItemPosition != modelIdx) {
                binding.spinnerPreferredModel.setSelection(modelIdx)
            }

            binding.switchAutoFallbackModel.isChecked = settings.autoFallbackModel

            val thinkingIdx = thinkingOptions.indexOfFirst { it.second == settings.thinkingLevel }.coerceAtLeast(0)
            if (binding.spinnerThinkingLevel.selectedItemPosition != thinkingIdx) {
                binding.spinnerThinkingLevel.setSelection(thinkingIdx)
            }

            if (binding.etCustomPrompt.text?.toString() != settings.customPrompt && !binding.etCustomPrompt.hasFocus()) {
                binding.etCustomPrompt.setText(settings.customPrompt)
            }

            val diameterProgress = ((settings.iconDiameterMm - 2.0f) * 10f).roundToInt().coerceIn(0, 130)
            if (binding.seekBarIconDiameter.progress != diameterProgress) {
                binding.seekBarIconDiameter.progress = diameterProgress
            }
            val approxDp = (settings.iconDiameterMm * (160f / 25.4f)).roundToInt()
            binding.tvIconDiameterValue.text =
                String.format(Locale.US, "%.1f mm (~%d dp)", settings.iconDiameterMm, approxDp)

            if (binding.seekBarIconAlpha.progress != settings.iconAlphaPercent) {
                binding.seekBarIconAlpha.progress = settings.iconAlphaPercent
            }
            binding.tvIconAlphaValue.text = if (settings.iconAlphaPercent == 0) {
                "0% (Vô hình - vẫn chạm được)"
            } else {
                "\${settings.iconAlphaPercent}%"
            }

            if (binding.etIconColorHex.text?.toString() != settings.iconColorHex && !binding.etIconColorHex.hasFocus()) {
                binding.etIconColorHex.setText(settings.iconColorHex)
            }

            val textSizeProgress = (settings.answerTextSizeSp - 10).coerceIn(0, 22)
            if (binding.seekBarAnswerTextSize.progress != textSizeProgress) {
                binding.seekBarAnswerTextSize.progress = textSizeProgress
            }
            binding.tvAnswerTextSizeValue.text = "\${settings.answerTextSizeSp} sp"

            if (binding.seekBarAnswerAutoHide.progress != settings.answerAutoHideSeconds) {
                binding.seekBarAnswerAutoHide.progress = settings.answerAutoHideSeconds
            }
            binding.tvAnswerAutoHideValue.text = if (settings.answerAutoHideSeconds == 0) {
                "0 giây (Không tự ẩn)"
            } else {
                "\${settings.answerAutoHideSeconds} giây"
            }

            binding.switchAnswerHideBorder.isChecked = settings.answerHideBorder

            if (binding.etAnswerTextColorHex.text?.toString() != settings.answerTextColorHex && !binding.etAnswerTextColorHex.hasFocus()) {
                binding.etAnswerTextColorHex.setText(settings.answerTextColorHex)
            }

            binding.switchBatchMode.isChecked = settings.batchModeEnabled
        } finally {
            isUpdatingUiFromFlow = false
        }
    }

    private fun renderActiveRouteCard(route: ActiveRoute, settings: OverlaySettings) {
        val keys = secureKeyStore.getApiKeys()
        val totalKeys = keys.size.coerceAtLeast(1)
        val preferred = settings.preferredModel

        val activelyUsing = route.isServiceRunning && route.hasScannedInSession
        val displayModel = when {
            activelyUsing -> route.modelUsed
            !settings.lastUsedModel.isNullOrBlank() -> settings.lastUsedModel
            else -> preferred
        }
        val displayApiIdx = when {
            activelyUsing -> route.apiIndex.coerceIn(1, totalKeys)
            settings.lastUsedApiIndex != null -> settings.lastUsedApiIndex.coerceIn(1, totalKeys)
            else -> 1
        }
        val displayTail4 = keys.getOrNull(displayApiIdx - 1)?.let { SecureKeyStore.maskKeyTail4(it) }
            ?: settings.lastUsedKeyTail4
            ?: "...????"

        if (activelyUsing) {
            binding.tvActiveRouteHeadline.text =
                "Đang dùng: $displayModel · API $displayApiIdx/\${keys.size.coerceAtLeast(1)}"
            binding.tvActiveRouteHeadline.setTextColor(Color.parseColor("#34D399"))
        } else {
            binding.tvActiveRouteHeadline.text =
                "Sẽ dùng: $preferred · API 1/\${keys.size.coerceAtLeast(1)}"
            binding.tvActiveRouteHeadline.setTextColor(Color.parseColor("#94A3B8"))
        }

        binding.tvKeyTail4.text = "(key $displayTail4)"

        val isFallback = activelyUsing && !displayModel.equals(preferred, ignoreCase = true)
        binding.tvFallbackBadge.visibility = if (isFallback) View.VISIBLE else View.GONE
        binding.tvFallbackReasonLine.visibility = if (isFallback) View.VISIBLE else View.GONE
        if (isFallback) {
            binding.tvFallbackReasonLine.text = "Ưu tiên: $preferred (hết quota trên mọi API)"
        }

        val scanTime = route.lastScanTime ?: settings.lastScanTimeText
        val latency = route.lastLatencyMs ?: settings.lastScanLatencyMs
        if (!scanTime.isNullOrBlank() && latency != null) {
            binding.tvLastScanLine.text = "Lần quét gần nhất: $scanTime · \${latency} ms"
        } else {
            binding.tvLastScanLine.text = "Chưa quét lần nào"
        }

        // Danh sách trạng thái từng API (tối đa 5 dòng)
        binding.layoutApiStatusList.removeAllViews()
        if (keys.isEmpty()) {
            val emptyTv = TextView(this).apply {
                text = "Chưa nhập API key nào (tối đa 5 key)."
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 12f
            }
            binding.layoutApiStatusList.addView(emptyTv)
            return
        }

        val statuses = if (route.apiStatuses.size == keys.size) {
            route.apiStatuses
        } else {
            keys.mapIndexed { idx, k ->
                com.example.quizoverlay.model.ApiSlotStatus(
                    apiIndex = idx + 1,
                    keyTail4 = SecureKeyStore.maskKeyTail4(k),
                    status = if (activelyUsing && idx + 1 == displayApiIdx) {
                        ApiKeyStatusType.ACTIVE
                    } else {
                        ApiKeyStatusType.READY
                    }
                )
            }
        }

        statuses.take(5).forEach { slot ->
            val row = TextView(this).apply {
                val minsLeft = ceil(slot.cooldownRemainingMs / 60000.0).toInt().coerceAtLeast(1)
                val statusLabel = when (slot.status) {
                    ApiKeyStatusType.ACTIVE -> "▶ ĐANG DÙNG"
                    ApiKeyStatusType.READY -> "✓ sẵn sàng"
                    ApiKeyStatusType.QUOTA_EXHAUSTED -> "✗ hết quota (còn ~\${minsLeft} phút)"
                    ApiKeyStatusType.INVALID_KEY -> "⚠ key không hợp lệ"
                }
                text = "API \${slot.apiIndex} (\${slot.keyTail4}): $statusLabel"
                textSize = 12.5f
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dpToPx(10), dpToPx(6), dpToPx(10), dpToPx(6))

                when (slot.status) {
                    ApiKeyStatusType.ACTIVE -> {
                        setBackgroundColor(Color.parseColor("#2610B981"))
                        setTextColor(Color.parseColor("#34D399"))
                    }
                    ApiKeyStatusType.QUOTA_EXHAUSTED -> {
                        setBackgroundColor(Color.TRANSPARENT)
                        setTextColor(Color.parseColor("#FACC15"))
                    }
                    ApiKeyStatusType.INVALID_KEY -> {
                        setBackgroundColor(Color.TRANSPARENT)
                        setTextColor(Color.parseColor("#FB7185"))
                    }
                    ApiKeyStatusType.READY -> {
                        setBackgroundColor(Color.TRANSPARENT)
                        setTextColor(Color.parseColor("#CBD5E1"))
                    }
                }
            }
            binding.layoutApiStatusList.addView(row)
        }
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).roundToInt()
    }
}
`,
  },
];
