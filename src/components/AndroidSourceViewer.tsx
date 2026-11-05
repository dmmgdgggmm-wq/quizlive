import React, { useState, useMemo } from 'react';
import {
  ALL_ANDROID_PROJECT_FILES,
  AndroidSourceFile,
} from '../data/androidProjectFiles';
import { buildAndroidProjectZipBlob } from '../utils/zipExporter';
import { Copy, Check, Download, FileCode, FolderTree, Search } from 'lucide-react';

interface AndroidSourceViewerProps {
  onShowToast: (msg: string) => void;
}

export const AndroidSourceViewer: React.FC<AndroidSourceViewerProps> = ({
  onShowToast,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<
    'all' | 'kotlin' | 'xml' | 'gradle'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>(
    'app/src/main/java/com/example/quizoverlay/MainActivity.kt'
  );
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    return ALL_ANDROID_PROJECT_FILES.filter((file) => {
      if (selectedCategory === 'kotlin' && file.category !== 'kotlin') {
        return false;
      }
      if (selectedCategory === 'xml' && file.category !== 'xml') {
        return false;
      }
      if (
        selectedCategory === 'gradle' &&
        file.category !== 'gradle' &&
        file.category !== 'manifest'
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          file.path.toLowerCase().includes(q) ||
          file.description.toLowerCase().includes(q) ||
          file.content.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [selectedCategory, searchQuery]);

  const activeFile: AndroidSourceFile = useMemo(() => {
    return (
      ALL_ANDROID_PROJECT_FILES.find((f) => f.path === selectedPath) ||
      filteredFiles[0] ||
      ALL_ANDROID_PROJECT_FILES[0]
    );
  }, [selectedPath, filteredFiles]);

  const handleCopyCode = async (file: AndroidSourceFile) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedPath(file.path);
      onShowToast(`Đã sao chép nội dung ${file.path}`);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch {
      onShowToast('Không thể sao chép tự động, hãy chọn văn bản để copy.');
    }
  };

  const handleDownloadSingleFile = (file: AndroidSourceFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = file.path.split('/').pop() || 'source.txt';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onShowToast(`Đã tải xuống file ${filename}`);
  };

  const handleDownloadFullZip = () => {
    const zipBlob = buildAndroidProjectZipBlob(
      ALL_ANDROID_PROJECT_FILES,
      'QuizSnapOverlay'
    );
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'QuizSnapOverlay-AndroidProject.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onShowToast(
      `Đã đóng gói và tải xuống QuizSnapOverlay-AndroidProject.zip (${ALL_ANDROID_PROJECT_FILES.length} file)`
    );
  };

  const codeLines = useMemo(
    () => activeFile.content.split('\n'),
    [activeFile.content]
  );

  return (
    <section
      aria-label="Mã nguồn dự án Android Gradle"
      className="bg-[#1E293B] border border-[#334155] rounded-2xl p-5 text-[#F8FAFC]"
    >
      {/* Top Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[#334155]">
        <div>
          <h2 className="text-lg font-bold text-[#F8FAFC]">
            Toàn Bộ Source Project Gradle — QuizSnap Overlay (com.example.quizoverlay)
          </h2>
          <p className="text-xs text-[#CBD5E1] mt-1">
            Kotlin + XML ViewBinding (Không dùng Compose) · minSdk 26 · targetSdk 34 · compileSdk 34 · {ALL_ANDROID_PROJECT_FILES.length} file đầy đủ mở bằng Android Studio build ngay
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDownloadFullZip}
            className="px-4 py-2.5 rounded-xl bg-[#10B981] hover:bg-[#34D399] text-[#022C22] font-bold text-xs flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Tải Trọn Bộ Project (.ZIP)</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 py-4">
        <div className="flex flex-wrap items-center gap-1.5 bg-[#0F172A] p-1 rounded-xl border border-[#334155]">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-[#10B981] text-[#022C22] font-semibold'
                : 'text-[#CBD5E1] hover:text-[#F8FAFC]'
            }`}
          >
            Tất cả ({ALL_ANDROID_PROJECT_FILES.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('kotlin')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'kotlin'
                ? 'bg-[#10B981] text-[#022C22] font-semibold'
                : 'text-[#CBD5E1] hover:text-[#F8FAFC]'
            }`}
          >
            Kotlin Source (
            {ALL_ANDROID_PROJECT_FILES.filter((f) => f.category === 'kotlin').length}
            )
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('xml')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'xml'
                ? 'bg-[#10B981] text-[#022C22] font-semibold'
                : 'text-[#CBD5E1] hover:text-[#F8FAFC]'
            }`}
          >
            XML Layout &amp; Res (
            {ALL_ANDROID_PROJECT_FILES.filter((f) => f.category === 'xml').length}
            )
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('gradle')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'gradle'
                ? 'bg-[#10B981] text-[#022C22] font-semibold'
                : 'text-[#CBD5E1] hover:text-[#F8FAFC]'
            }`}
          >
            Gradle &amp; Manifest (
            {
              ALL_ANDROID_PROJECT_FILES.filter(
                (f) => f.category === 'gradle' || f.category === 'manifest'
              ).length
            }
            )
          </button>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tên file, hàm hoặc từ khóa..."
            aria-label="Tìm kiếm trong mã nguồn Android"
            className="w-full pl-9 pr-3 py-2 bg-[#0F172A] border border-[#334155] rounded-xl text-xs text-[#F8FAFC] placeholder-[#94A3B8] focus:outline-none focus:border-[#10B981]"
          />
        </div>
      </div>

      {/* Main Split: File Tree + Code Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-1">
        {/* Left File Tree */}
        <div className="lg:col-span-4 bg-[#0F172A] border border-[#334155] rounded-xl p-3 max-h-[680px] overflow-y-auto">
          <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-[#1E293B] text-xs text-[#94A3B8]">
            <span className="flex items-center gap-1.5 font-medium text-[#CBD5E1]">
              <FolderTree className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Cây thư mục dự án</span>
            </span>
            <span className="font-mono tabular-nums">{filteredFiles.length} file</span>
          </div>

          <div className="space-y-1">
            {filteredFiles.map((file) => {
              const isSelected = file.path === activeFile.path;
              const shortName = file.path.split('/').pop() || file.path;
              const parentDir = file.path.includes('/')
                ? file.path.slice(0, file.path.lastIndexOf('/'))
                : '/';
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-[#10B981]/15 border border-[#10B981] text-[#34D399]'
                      : 'hover:bg-[#1E293B] text-[#CBD5E1] border border-transparent'
                  }`}
                >
                  <FileCode
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      isSelected ? 'text-[#34D399]' : 'text-[#94A3B8]'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono font-semibold truncate">
                      {shortName}
                    </div>
                    <div className="text-[11px] font-mono text-[#94A3B8] truncate mt-0.5">
                      {parentDir}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Code Viewer */}
        <div className="lg:col-span-8 bg-[#0F172A] border border-[#334155] rounded-xl flex flex-col overflow-hidden max-h-[680px]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[#1E293B]/60 border-b border-[#334155]">
            <div className="min-w-0">
              <div className="text-xs font-mono font-semibold text-[#34D399] break-all">
                {activeFile.path}
              </div>
              <div className="text-xs text-[#CBD5E1] mt-0.5">
                {activeFile.description}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopyCode(activeFile)}
                className="px-3 py-1.5 rounded-lg bg-[#334155] hover:bg-[#475569] text-[#F8FAFC] text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedPath === activeFile.path ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#34D399]" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép file</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadSingleFile(activeFile)}
                className="px-3 py-1.5 rounded-lg bg-[#334155] hover:bg-[#475569] text-[#F8FAFC] text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải file lẻ</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed select-text">
            <table className="w-full border-collapse">
              <tbody>
                {codeLines.map((line, i) => (
                  <tr key={i} className="hover:bg-[#1E293B]/50">
                    <td className="pr-4 text-right text-[#94A3B8]/60 select-none w-10 align-top tabular-nums">
                      {i + 1}
                    </td>
                    <td className="text-[#F8FAFC] whitespace-pre font-mono">
                      {line || ' '}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
