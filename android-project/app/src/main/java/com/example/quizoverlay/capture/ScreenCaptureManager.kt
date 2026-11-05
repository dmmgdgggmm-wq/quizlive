package com.example.quizoverlay.capture

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
