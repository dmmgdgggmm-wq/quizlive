import React, { useRef, useState, useEffect, useCallback } from 'react';
import { mmToDp } from '../utils/quizOverlayLogic';

export interface SampleQuizItem {
  id: string;
  subject: string;
  questionNumber: number;
  questionText: string;
  formulaOrCode?: string;
  options: [string, string, string, string];
  correctAnswerShort: string;
  explanationShort: string;
}

export const SAMPLE_QUIZ_ITEMS: SampleQuizItem[] = [
  {
    id: 'math-1',
    subject: 'Toán Giải Tích 12',
    questionNumber: 14,
    questionText:
      'Cho hàm số y = f(x) = x³ - 3x² + 2. Giá trị cực đại của hàm số đã cho bằng bao nhiêu?',
    formulaOrCode: "f'(x) = 3x² - 6x = 0  ⇔  x = 0 (y = 2) hoặc x = 2 (y = -2)",
    options: ['A. y = -2', 'B. y = 2', 'C. y = 0', 'D. y = 4'],
    correctAnswerShort: 'B (y = 2)',
    explanationShort: 'Câu 14: B (Cực đại tại x = 0, y_CĐ = 2)',
  },
  {
    id: 'phys-2',
    subject: 'Vật Lý 12 — Điện Xoay Chiều',
    questionNumber: 21,
    questionText:
      'Đặt điện áp u = 200√2 cos(100πt) (V) vào hai đầu đoạn mạch R = 100 Ω nối tiếp tụ C có Z_C = 100 Ω. Cường độ dòng điện hiệu dụng I là:',
    formulaOrCode: 'Z = √(R² + Z_C²) = 100√2 Ω   ⇒   I = U / Z = 200 / (100√2)',
    options: ['A. 2 A', 'B. 2√2 A', 'C. √2 A', 'D. 1 A'],
    correctAnswerShort: 'C (√2 A)',
    explanationShort: 'Câu 21: C (I = √2 A)',
  },
  {
    id: 'cs-3',
    subject: 'Cấu Trúc Dữ Liệu & Giải Thuật',
    questionNumber: 8,
    questionText:
      'Độ phức tạp thời gian trung bình của thuật toán tìm kiếm nhị phân (Binary Search) trên mảng đã sắp xếp gồm n phần tử là:',
    formulaOrCode: 'T(n) = T(n/2) + O(1)',
    options: ['A. O(n)', 'B. O(n log n)', 'C. O(1)', 'D. O(log n)'],
    correctAnswerShort: 'D (O(log n))',
    explanationShort: 'Câu 8: D (O(log n))',
  },
  {
    id: 'chem-4',
    subject: 'Hóa Học Hữu Cơ',
    questionNumber: 32,
    questionText:
      'Thủy phân hoàn toàn 8,8 gam etyl axetat (CH₃COOC₂H₅, M = 88) trong dung dịch NaOH dư đun nóng, thu được bao nhiêu gam muối natri axetat (CH₃COONa, M = 82)?',
    formulaOrCode: 'n_este = 8,8 / 88 = 0,1 mol  →  m_CH3COONa = 0,1 × 82',
    options: ['A. 8,2 gam', 'B. 4,6 gam', 'C. 9,6 gam', 'D. 6,8 gam'],
    correctAnswerShort: 'A (8,2g)',
    explanationShort: 'Câu 32: A (8,2 gam)',
  },
];

export type QuotaSimulationScenario =
  | 'NORMAL_OK'
  | 'FAIL_CURRENT_API_429'
  | 'FAIL_ALL_APIS_ON_PREFERRED_MODEL'
  | 'FAIL_CURRENT_API_INVALID_403'
  | 'FAIL_NETWORK_ERROR'
  | 'FAIL_ALL_MODELS_EXHAUSTED';

interface LiveScreenOverlayCanvasProps {
  isServiceRunning: boolean;
  hasScannedInSession: boolean;
  activeModelUsed: string;
  activeApiIndex: number;
  apiCount: number;
  iconDiameterMm: number;
  iconAlphaPercent: number;
  iconColorHex: string;
  answerTextSizeSp: number;
  answerAutoHideSeconds: number;
  answerHideBorder: boolean;
  answerTextColorHex: string;
  batchModeEnabled: boolean;
  batchQueueCount: number;
  isScanning: boolean;
  overlayAnswerText: string | null;
  overlayAnswerVisible: boolean;
  simulationScenario: QuotaSimulationScenario;
  onChangeSimulationScenario: (scenario: QuotaSimulationScenario) => void;
  onSingleTapIcon: (capturedBase64Jpeg: string, quizItem: SampleQuizItem) => void;
  onLongPressIcon: (capturedBase64Jpeg: string, quizItem: SampleQuizItem) => void;
  onStopService: () => void;
  onDismissAnswerOverlay: () => void;
}

export const LiveScreenOverlayCanvas: React.FC<LiveScreenOverlayCanvasProps> = ({
  isServiceRunning,
  hasScannedInSession,
  activeModelUsed,
  activeApiIndex,
  apiCount,
  iconDiameterMm,
  iconAlphaPercent,
  iconColorHex,
  answerTextSizeSp,
  answerAutoHideSeconds,
  answerHideBorder,
  answerTextColorHex,
  batchModeEnabled,
  batchQueueCount,
  isScanning,
  overlayAnswerText,
  overlayAnswerVisible,
  simulationScenario,
  onChangeSimulationScenario,
  onSingleTapIcon,
  onLongPressIcon,
  onStopService,
  onDismissAnswerOverlay,
}) => {
  const [activeQuizIndex, setActiveQuizIndex] = useState(0);
  const currentQuiz = SAMPLE_QUIZ_ITEMS[activeQuizIndex] || SAMPLE_QUIZ_ITEMS[0];

  const screenRef = useRef<HTMLDivElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Floating Icon position (snaps to left=6 or right=screenW-54)
  const [iconPos, setIconPos] = useState<{ x: number; y: number }>({
    x: 288,
    y: 190,
  });
  const [isDraggingIcon, setIsDraggingIcon] = useState(false);

  // Answer overlay box position & dimensions (default 48x32dp, minimum 24x24dp as in reference FloatingService.kt)
  const [answerBox, setAnswerBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>({
    x: 120,
    y: 220,
    width: 48,
    height: 32,
  });

  // Render the simulated phone screen onto an offscreen canvas so tapping the icon captures a real JPEG Base64 image (without overlays!)
  const captureCleanScreenBase64 = useCallback((): string => {
    const canvas = captureCanvasRef.current;
    if (!canvas) return '';
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const w = 720;
    const h = 1280;
    canvas.width = w;
    canvas.height = h;

    // Background
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, w, h);

    // Header bar
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, w, 96);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(currentQuiz.subject, 36, 60);

    // Question card
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(32, 130, w - 64, 520);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.strokeRect(32, 130, w - 64, 520);

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(`Câu ${currentQuiz.questionNumber}:`, 60, 190);

    ctx.font = '24px sans-serif';
    const words = currentQuiz.questionText.split(' ');
    let line = '';
    let y = 240;
    for (const word of words) {
      const testLine = line + word + ' ';
      if (ctx.measureText(testLine).width > w - 140) {
        ctx.fillText(line, 60, y);
        line = word + ' ';
        y += 38;
      } else {
        line = testLine;
      }
    }
    if (line) {
      ctx.fillText(line, 60, y);
      y += 48;
    }

    if (currentQuiz.formulaOrCode) {
      ctx.fillStyle = '#334155';
      ctx.font = 'italic 21px monospace';
      ctx.fillText(currentQuiz.formulaOrCode, 60, y);
      y += 50;
    }

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 25px sans-serif';
    for (const opt of currentQuiz.options) {
      ctx.fillText(opt, 60, y);
      y += 52;
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  }, [currentQuiz]);

  // Icon drag & tap/long-press state
  const dragStateRef = useRef<{
    downX: number;
    downY: number;
    startX: number;
    startY: number;
    moved: boolean;
    longPressFired: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  }>({
    downX: 0,
    downY: 0,
    startX: 0,
    startY: 0,
    moved: false,
    longPressFired: false,
    timer: null,
  });

  const handleIconPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (dragStateRef.current.timer) {
      clearTimeout(dragStateRef.current.timer);
    }

    dragStateRef.current = {
      downX: e.clientX,
      downY: e.clientY,
      startX: iconPos.x,
      startY: iconPos.y,
      moved: false,
      longPressFired: false,
      timer: batchModeEnabled
        ? setTimeout(() => {
            if (!dragStateRef.current.moved) {
              dragStateRef.current.longPressFired = true;
              const b64 = captureCleanScreenBase64();
              onLongPressIcon(b64, currentQuiz);
            }
          }, 520)
        : null,
    };
  };

  const handleIconPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - dragStateRef.current.downX;
    const dy = e.clientY - dragStateRef.current.downY;
    if (!dragStateRef.current.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragStateRef.current.moved = true;
      setIsDraggingIcon(true);
      if (dragStateRef.current.timer) {
        clearTimeout(dragStateRef.current.timer);
        dragStateRef.current.timer = null;
      }
    }
    if (dragStateRef.current.moved) {
      const containerW = screenRef.current?.clientWidth || 344;
      const containerH = screenRef.current?.clientHeight || 520;
      const nextX = Math.max(0, Math.min(containerW - 48, dragStateRef.current.startX + dx));
      const nextY = Math.max(44, Math.min(containerH - 56, dragStateRef.current.startY + dy));
      setIconPos({ x: nextX, y: nextY });
    }
  };

  const handleIconPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current.timer) {
      clearTimeout(dragStateRef.current.timer);
      dragStateRef.current.timer = null;
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDraggingIcon(false);

    if (dragStateRef.current.moved) {
      // Snap to nearest left or right edge
      const containerW = screenRef.current?.clientWidth || 344;
      const snapX = iconPos.x + 24 < containerW / 2 ? 6 : containerW - 54;
      setIconPos((prev) => ({ ...prev, x: snapX }));
    } else if (!dragStateRef.current.longPressFired) {
      const b64 = captureCleanScreenBase64();
      onSingleTapIcon(b64, currentQuiz);
    }
  };

  // Answer overlay drag & resize handlers
  const boxDragRef = useRef<{
    mode: 'drag' | 'resize' | null;
    downX: number;
    downY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    moved: boolean;
  }>({
    mode: null,
    downX: 0,
    downY: 0,
    startX: 0,
    startY: 0,
    startW: 148,
    startH: 54,
    moved: false,
  });

  const handleAnswerPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'drag' | 'resize'
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    boxDragRef.current = {
      mode,
      downX: e.clientX,
      downY: e.clientY,
      startX: answerBox.x,
      startY: answerBox.y,
      startW: answerBox.width,
      startH: answerBox.height,
      moved: false,
    };
  };

  const handleAnswerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!boxDragRef.current.mode || !e.currentTarget.hasPointerCapture(e.pointerId)) {
      return;
    }
    const dx = e.clientX - boxDragRef.current.downX;
    const dy = e.clientY - boxDragRef.current.downY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      boxDragRef.current.moved = true;
    }

    if (boxDragRef.current.mode === 'drag') {
      const containerW = screenRef.current?.clientWidth || 344;
      const containerH = screenRef.current?.clientHeight || 520;
      setAnswerBox((prev) => ({
        ...prev,
        x: Math.max(4, Math.min(containerW - prev.width - 4, boxDragRef.current.startX + dx)),
        y: Math.max(48, Math.min(containerH - prev.height - 4, boxDragRef.current.startY + dy)),
      }));
    } else if (boxDragRef.current.mode === 'resize') {
      // Minimum size 24x24dp as in reference SettingsRepository.MIN_ANSWER_SIZE_DP
      setAnswerBox((prev) => ({
        ...prev,
        width: Math.max(24, Math.min(310, boxDragRef.current.startW + dx)),
        height: Math.max(24, Math.min(240, boxDragRef.current.startH + dy)),
      }));
    }
  };

  const handleAnswerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasMoved = boxDragRef.current.moved;
    const wasDragMode = boxDragRef.current.mode === 'drag';
    boxDragRef.current.mode = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (wasDragMode && !wasMoved) {
      // Tap on answer overlay hides immediately
      onDismissAnswerOverlay();
    }
  };

  // Keep icon inside container on resize
  useEffect(() => {
    const containerW = screenRef.current?.clientWidth || 344;
    setIconPos((prev) => ({
      x: prev.x > containerW / 2 ? containerW - 54 : 6,
      y: prev.y,
    }));
  }, []);

  const dotDiameterPx = Math.max(12, Math.min(96, mmToDp(iconDiameterMm)));
  const effectiveDotOpacity = Math.max(0, Math.min(1, iconAlphaPercent / 100));

  const notificationSubtext = hasScannedInSession
    ? `Đang dùng: ${activeModelUsed} · API ${activeApiIndex}/${Math.max(1, apiCount)}`
    : 'Chạm biểu tượng tròn để quét màn hình và nhận đáp án';

  return (
    <div className="bg-[#1E293B] border border-[#334155] rounded-2xl p-4 text-[#F8FAFC] flex flex-col gap-4">
      <canvas ref={captureCanvasRef} className="hidden" aria-hidden="true" />

      {/* Header of Simulator Panel */}
      <div className="flex items-center justify-between gap-2 border-b border-[#334155] pb-3">
        <div>
          <h2 className="text-sm font-bold text-[#F8FAFC]">
            Mô Phỏng Màn Hình Android &amp; Biểu Tượng Nổi Trực Tiếp
          </h2>
          <p className="text-xs text-[#CBD5E1] mt-0.5">
            Kéo biểu tượng (hít cạnh), chạm 1 lần để chụp nguyên ảnh, hoặc nhấn giữ để gửi hàng loạt
          </p>
        </div>
      </div>

      {/* QuotaRouter Fault Injection Bar */}
      <div className="bg-[#0F172A] border border-[#334155] rounded-xl p-3">
        <label
          htmlFor="quota-scenario-select"
          className="block text-xs font-semibold text-[#CBD5E1] mb-1.5"
        >
          Chế độ kiểm thử QuotaRouter khi quét trên màn hình giả lập:
        </label>
        <select
          id="quota-scenario-select"
          value={simulationScenario}
          onChange={(e) =>
            onChangeSimulationScenario(e.target.value as QuotaSimulationScenario)
          }
          className="w-full bg-[#1E293B] border border-[#334155] rounded-lg px-3 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#10B981]"
        >
          <option value="NORMAL_OK">
            1. Hoạt động bình thường (Trả đáp án ngay trên API đang chọn)
          </option>
          <option value="FAIL_CURRENT_API_429">
            2. Giả lập API đang dùng bị HTTP 429 (Tự chuyển sang API kế tiếp &amp; gửi lại)
          </option>
          <option value="FAIL_ALL_APIS_ON_PREFERRED_MODEL">
            3. Giả lập mọi API hết quota ở Model ưu tiên (Tự xuống Model dự phòng)
          </option>
          <option value="FAIL_CURRENT_API_INVALID_403">
            4. Giả lập API đang dùng lỗi HTTP 403 (Đánh dấu ⚠ key không hợp lệ)
          </option>
          <option value="FAIL_NETWORK_ERROR">
            5. Giả lập đứt mạng (Hiện &quot;Kiểm tra lại kết nối mạng.&quot; - Giữ nguyên API &amp; Model)
          </option>
          <option value="FAIL_ALL_MODELS_EXHAUSTED">
            6. Giả lập hết sạch mọi API và chuỗi Model
          </option>
        </select>

        {/* Sample Question Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-[#1E293B]">
          <span className="text-xs text-[#94A3B8]">Đề bài trên màn hình:</span>
          <div className="flex flex-wrap items-center gap-1">
            {SAMPLE_QUIZ_ITEMS.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveQuizIndex(idx)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeQuizIndex === idx
                    ? 'bg-[#10B981] text-[#022C22] font-semibold'
                    : 'bg-[#1E293B] text-[#CBD5E1] hover:text-[#F8FAFC]'
                }`}
              >
                Câu {item.questionNumber}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Simulated Android Phone Viewport */}
      <div
        ref={screenRef}
        data-testid="android-overlay-screen"
        className="relative w-full h-[540px] bg-[#0B1120] border-2 border-[#334155] rounded-3xl overflow-hidden select-none shadow-inner flex flex-col"
      >
        {/* Android Status Bar */}
        <div className="h-7 px-4 bg-[#0F172A] text-[#CBD5E1] text-[11px] font-mono flex items-center justify-between border-b border-[#1E293B] shrink-0">
          <span>09:42 · QuizExam App</span>
          <span className="tabular-nums">
            {isServiceRunning ? '● FGS MediaProjection' : '○ Dịch vụ tắt'}
          </span>
        </div>

        {/* Foreground Service Ongoing Notification Banner (when service is running) */}
        {isServiceRunning && (
          <div className="mx-2.5 mt-2 bg-[#1E293B] border border-[#10B981]/60 rounded-xl p-2.5 shadow-md z-10 shrink-0">
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[#F8FAFC]">
                Biểu tượng quét trắc nghiệm đang chạy
              </div>
              <div
                data-testid="fgs-notification-content"
                className="text-[11px] text-[#34D399] font-mono mt-0.5"
              >
                {notificationSubtext}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-2 pt-1.5 border-t border-[#334155]/80">
              <button
                type="button"
                onClick={onStopService}
                className="px-2.5 py-1 rounded bg-[#FB7185]/20 hover:bg-[#FB7185]/30 text-[10px] text-[#FB7185] font-semibold whitespace-nowrap cursor-pointer"
              >
                Dừng
              </button>
            </div>
          </div>
        )}

        {/* Simulated Exam App Content Underneath Overlay */}
        <div className="flex-1 p-3.5 overflow-y-auto">
          <div className="bg-[#111827] text-[#CBD5E1] rounded-2xl p-4 border border-[#1E293B]">
            <div className="flex items-center justify-between text-xs text-[#94A3B8] font-semibold pb-2 border-b border-[#1E293B]">
              <span>{currentQuiz.subject}</span>
              <span className="font-mono tabular-nums">
                Câu {currentQuiz.questionNumber}/50
              </span>
            </div>

            <p className="text-sm font-semibold text-[#E2E8F0] mt-3 leading-relaxed">
              Câu {currentQuiz.questionNumber}: {currentQuiz.questionText}
            </p>

            {currentQuiz.formulaOrCode && (
              <div className="mt-2.5 px-3 py-2 bg-[#0F172A] rounded-lg font-mono text-xs text-[#94A3B8] border border-[#1E293B]">
                {currentQuiz.formulaOrCode}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 mt-3.5">
              {currentQuiz.options.map((opt) => (
                <div
                  key={opt}
                  className="px-3 py-2 rounded-lg border border-[#1E293B] bg-[#0F172A]/80 text-xs font-medium text-[#CBD5E1]"
                >
                  {opt}
                </div>
              ))}
            </div>
          </div>

          {/* Batch Mode Quick Action Bar inside Simulator */}
          {isServiceRunning && batchModeEnabled && (
            <div className="mt-3 px-3 py-2 rounded-xl bg-[#1E293B]/90 border border-[#334155] flex items-center justify-between gap-2 text-xs">
              <span className="text-[#CBD5E1]">
                Hàng đợi Gửi Hàng Loạt:{' '}
                <strong className="text-[#34D399] font-mono tabular-nums">
                  {batchQueueCount} ảnh
                </strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  const b64 = captureCleanScreenBase64();
                  onLongPressIcon(b64, currentQuiz);
                }}
                className="px-2.5 py-1 rounded-lg bg-[#10B981] text-[#022C22] font-semibold text-xs hover:bg-[#34D399] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Đè gửi 1 lượt ({batchQueueCount > 0 ? `${batchQueueCount} ảnh` : 'Chụp & gửi'})
              </button>
            </div>
          )}
        </div>

        {/* 5.2 MICRO ANSWER OVERLAY (Khung nền trong suốt 100%, viền 1dp #6694A3B8 khi tắt tùy chọn ẩn viền, và ẩn sạch viền khi bật tùy chọn) */}
        {isServiceRunning && overlayAnswerVisible && overlayAnswerText !== null && (
          <div
            data-testid="floating-answer-overlay"
            onPointerDown={(e) => handleAnswerPointerDown(e, 'drag')}
            onPointerMove={handleAnswerPointerMove}
            onPointerUp={handleAnswerPointerUp}
            style={{
              transform: `translate3d(${answerBox.x}px, ${answerBox.y}px, 0)`,
              width: `${answerBox.width}px`,
              height: `${answerBox.height}px`,
              minWidth: '24px',
              minHeight: '24px',
              backgroundColor: 'transparent',
              border: answerHideBorder
                ? 'none'
                : '1px solid rgba(148, 163, 184, 0.4)',
              borderRadius: '6px',
              boxShadow: 'none',
              padding: '0px',
            }}
            className="absolute top-0 left-0 z-30 flex items-center justify-center cursor-move"
          >
            <div className="w-full h-full overflow-y-auto flex items-center justify-center bg-transparent">
              <span
                style={{
                  fontSize: `${answerTextSizeSp}px`,
                  color: answerTextColorHex || '#FFFFFF',
                  backgroundColor: 'transparent',
                  textShadow: '0px 1.5px 8px rgba(0, 0, 0, 0.85)',
                }}
                className="font-bold leading-none text-center break-words select-none"
              >
                {overlayAnswerText}
              </span>
            </div>

            {/* Không hiển thị dấu chấm màu xanh (dùng màu trong suốt, vẫn hỗ trợ chạm kéo thay đổi cỡ) */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Đổi kích thước khung đáp án"
              onPointerDown={(e) => handleAnswerPointerDown(e, 'resize')}
              onPointerMove={handleAnswerPointerMove}
              onPointerUp={handleAnswerPointerUp}
              className="absolute bottom-[2px] right-[2px] w-3.5 h-3.5 bg-transparent cursor-nwse-resize"
            />
          </div>
        )}

        {/* 5.1 FLOATING ICON (WindowManager TYPE_APPLICATION_OVERLAY, min 40dp touch area, 1.5dp white stroke) */}
        {isServiceRunning && (
          <button
            type="button"
            data-testid="floating-quiz-icon"
            aria-label="Biểu tượng nổi chụp màn hình quét câu hỏi"
            onPointerDown={handleIconPointerDown}
            onPointerMove={handleIconPointerMove}
            onPointerUp={handleIconPointerUp}
            style={{
              transform: `translate3d(${iconPos.x}px, ${iconPos.y}px, 0)`,
              transition: isDraggingIcon
                ? 'none'
                : 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className="absolute top-0 left-0 z-40 min-w-[40px] min-h-[40px] flex items-center justify-center bg-transparent rounded-full cursor-pointer focus:outline-none group"
            title="Chạm 1 lần: chụp nguyên ảnh · Kéo: di chuyển (tự hít cạnh) · Đè: gửi hàng loạt"
          >
            {/* Inner visible circle with solid monochrome color, diameter (mm) and alpha (0-100%) */}
            <span
              style={{
                width: `${dotDiameterPx}px`,
                height: `${dotDiameterPx}px`,
                backgroundColor: iconColorHex || '#10B981',
                opacity: effectiveDotOpacity,
                transform: isScanning ? 'scale(1.22)' : 'scale(1)',
                transition: 'opacity 150ms ease, transform 150ms ease',
              }}
              className="rounded-full block pointer-events-none"
            />
          </button>
        )}
      </div>

      {/* Helper caption */}
      <div className="text-xs text-[#94A3B8] flex flex-wrap items-center justify-between gap-2">
        <span>
          Tự ẩn khung đáp án:{' '}
          <strong className="text-[#CBD5E1]">
            {answerAutoHideSeconds === 0
              ? '0 giây (Không tự ẩn)'
              : `${answerAutoHideSeconds} giây`}
          </strong>
        </span>
        <span>
          Chạm vào khung đáp án để ẩn ngay · Kéo góc phải dưới để đổi kích thước
        </span>
      </div>
    </div>
  );
};
