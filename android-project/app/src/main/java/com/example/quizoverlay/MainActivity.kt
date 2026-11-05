package com.example.quizoverlay

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
            binding.etApiKeys.setText(savedKeys.joinToString("\n"))
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
            binding.tvModelProbeStatus.text = "Trạng thái: Đang dò model bằng ${savedKeys.size} API key..."
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
                binding.tvModelProbeStatus.text = "Trạng thái: Đã tải ${discovered.size} model"
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
                        "Đọc ảnh OK: ${outcome.text} (${outcome.latencyMs} ms) · $model · API $apiNum"
                }

                is SingleCallOutcome.HttpError -> {
                    binding.tvDiagnosticResult.setTextColor(Color.parseColor("#FACC15"))
                    val rawLower = (outcome.rawBody + " " + outcome.errorMessage).lowercase()
                    if (outcome.httpCode == 429 && (rawLower.contains("limit: 0") || rawLower.contains("quota limit 0"))) {
                        binding.tvDiagnosticResult.text = "Model này không có quota trên API $apiNum"
                    } else {
                        val reason = outcome.errorMessage.ifBlank { "HTTP ${outcome.httpCode}" }
                        binding.tvDiagnosticResult.text =
                            "Thất bại (HTTP ${outcome.httpCode} / $reason)"
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
            binding.tvDiagnosticResult.text = "Đang Ping (0 Quota) tới $model trên ${keys.size} API key..."

            val results = withContext(Dispatchers.IO) {
                geminiClient.pingModelAcrossKeys(model, keys)
            }
            binding.tvDiagnosticResult.text = results.joinToString("\n") { it.message }
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
                    val normalized = if (hex.startsWith("#")) hex.uppercase() else "#${hex.uppercase()}"
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
                    val normalized = if (hex.startsWith("#")) hex.uppercase() else "#${hex.uppercase()}"
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
                "${settings.iconAlphaPercent}%"
            }

            if (binding.etIconColorHex.text?.toString() != settings.iconColorHex && !binding.etIconColorHex.hasFocus()) {
                binding.etIconColorHex.setText(settings.iconColorHex)
            }

            val textSizeProgress = (settings.answerTextSizeSp - 10).coerceIn(0, 22)
            if (binding.seekBarAnswerTextSize.progress != textSizeProgress) {
                binding.seekBarAnswerTextSize.progress = textSizeProgress
            }
            binding.tvAnswerTextSizeValue.text = "${settings.answerTextSizeSp} sp"

            if (binding.seekBarAnswerAutoHide.progress != settings.answerAutoHideSeconds) {
                binding.seekBarAnswerAutoHide.progress = settings.answerAutoHideSeconds
            }
            binding.tvAnswerAutoHideValue.text = if (settings.answerAutoHideSeconds == 0) {
                "0 giây (Không tự ẩn)"
            } else {
                "${settings.answerAutoHideSeconds} giây"
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
                "Đang dùng: $displayModel · API $displayApiIdx/${keys.size.coerceAtLeast(1)}"
            binding.tvActiveRouteHeadline.setTextColor(Color.parseColor("#34D399"))
        } else {
            binding.tvActiveRouteHeadline.text =
                "Sẽ dùng: $preferred · API 1/${keys.size.coerceAtLeast(1)}"
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
            binding.tvLastScanLine.text = "Lần quét gần nhất: $scanTime · ${latency} ms"
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
                    ApiKeyStatusType.QUOTA_EXHAUSTED -> "✗ hết quota (còn ~${minsLeft} phút)"
                    ApiKeyStatusType.INVALID_KEY -> "⚠ key không hợp lệ"
                }
                text = "API ${slot.apiIndex} (${slot.keyTail4}): $statusLabel"
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
