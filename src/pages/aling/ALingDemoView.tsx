import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/progress/circular-progress.js';
import alingApi, { type ALingTask, type SlideHTML } from '../../services/alingApi';
import './ALingDemoView.css';

export function ALingDemoView() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<ALingTask | null>(null);
  const [slideHTMLs, setSlideHTMLs] = useState<SlideHTML[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('code');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamingCode, setStreamingCode] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const generatedRef = useRef(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!taskId) return;
    alingApi.getDemoTask(taskId).then(t => {
      setTask(t);
      if (t.slide_htmls) {
        setSlideHTMLs(t.slide_htmls);
        generatedRef.current = t.slide_htmls.length;
      }
      if (t.status !== 'completed') {
        startStream();
      }
    }).catch(() => navigate('/aling/demo'));
    return () => { streamRef.current?.abort(); };
  }, [taskId]);

  const startStream = () => {
    if (!taskId) return;
    streamRef.current?.abort();
    streamRef.current = alingApi.streamTask(taskId, (event) => {
      if (event.type === 'slide_token') {
        setViewMode('code');
        setStreamingCode(prev => prev + (event.data?.token || ''));
      } else if (event.type === 'reasoning') {
        setIsThinking(true);
      } else if (event.type === 'slide_done') {
        setIsThinking(false);
        const data = event.data;
        if (data) {
          setStreamingCode('');
          setSlideHTMLs(prev => {
            const exists = prev.find(s => s.index === data.index);
            if (exists) {
              return prev.map(s => s.index === data.index ? { index: data.index, title: data.title, html: data.html } : s);
            }
            return [...prev, { index: data.index, title: data.title, html: data.html }].sort((a, b) => a.index - b.index);
          });
          if (data.index === generatedRef.current) {
            setCurrentSlide(data.index);
            generatedRef.current = data.index + 1;
          }
        }
      } else if (event.type === 'done') {
        setTask(prev => prev ? { ...prev, status: 'completed' } : prev);
      } else if (event.type === 'error') {
        setIsThinking(false);
        setTask(prev => prev ? { ...prev, status: 'failed', error: event.data?.error } : prev);
      }
    });
  };

  const totalSlides = task?.slide_count || slideHTMLs.length || 0;
  const generatedCount = slideHTMLs.length;

  const currentSlideData = slideHTMLs.find(s => s.index === currentSlide);
  const isGenerating = task?.status === 'generating' || task?.status === 'outline_generating' || task?.status === 'pending';
  const isCompleted = task?.status === 'completed';

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      if (currentSlide < totalSlides - 1) setCurrentSlide(prev => prev + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (currentSlide > 0) setCurrentSlide(prev => prev - 1);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentSlide, totalSlides, isFullscreen]);

  return (
    <div className="aling-view-page">
      <header className="aling-topbar">
        <div className="aling-topbar-left">
          <md-icon-button onClick={() => navigate('/aling/demo')}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m313-440 224 224-57 57-320-320 320-320 57 57-224 224h487v80H313Z"/>
            </svg>
          </md-icon-button>
          <h1 className="aling-topbar-title">{task?.title || 'ALing 演示'}</h1>
        </div>
        <div className="aling-topbar-right">
          {isCompleted && (
            <md-outlined-button onClick={toggleFullscreen}>
              {isFullscreen ? '退出全屏' : '全屏'}
            </md-outlined-button>
          )}
        </div>
      </header>

      {isGenerating && generatedCount === 0 && (
        <div className="aling-view-loading">
          <md-circular-progress indeterminate />
          <p>正在生成演示...</p>
          <p className="aling-view-hint">你可以关闭此页面，生成完成后可在历史记录中查看</p>
        </div>
      )}

      <div className={`aling-view-body ${generatedCount > 0 || isCompleted ? '' : 'hidden'}`}>
        {/* Left: Slide Thumbnails */}
        <div className="aling-thumb-panel">
          <div className="aling-thumb-header">
            <span>幻灯片</span>
            <span className="aling-thumb-count">{generatedCount}/{totalSlides}</span>
          </div>
          <div className="aling-thumb-list">
            {Array.from({ length: totalSlides }, (_, i) => {
              const slide = slideHTMLs.find(s => s.index === i);
              const isActive = currentSlide === i;
              const isGeneratingThis = isGenerating && !slide && i >= generatedCount;
              return (
                <button
                  key={i}
                  className={`aling-thumb-item ${isActive ? 'active' : ''} ${slide ? 'done' : ''} ${isGeneratingThis ? 'generating' : ''}`}
                  onClick={() => slide && setCurrentSlide(i)}
                >
                  <div className="aling-thumb-number">{i + 1}</div>
                  <div className="aling-thumb-title">{slide?.title || (isGeneratingThis ? '生成中...' : '等待中')}</div>
                  <div className="aling-thumb-status">
                    {slide && <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#66bb6a"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Preview / Code */}
        <div className="aling-preview-panel" ref={previewRef}>
          <div className="aling-preview-tabs">
            <button
              className={`aling-preview-tab ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              预览
            </button>
            <button
              className={`aling-preview-tab ${viewMode === 'code' ? 'active' : ''}`}
              onClick={() => setViewMode('code')}
            >
              代码
            </button>
          </div>

          <div className="aling-preview-content">
            {viewMode === 'preview' && currentSlideData ? (
              <iframe
                className="aling-preview-iframe"
                srcDoc={wrapSlideHTML(currentSlideData.html)}
                title={`Slide ${currentSlide + 1}`}
              />
            ) : viewMode === 'preview' && !currentSlideData ? (
              <div className="aling-preview-placeholder">等待生成...</div>
            ) : viewMode === 'code' && streamingCode ? (
              <pre className="aling-preview-code"><code>{streamingCode}</code></pre>
            ) : viewMode === 'code' && currentSlideData ? (
              <pre className="aling-preview-code"><code>{currentSlideData.html}</code></pre>
            ) : viewMode === 'code' && isThinking ? (
              <div className="aling-preview-placeholder">模型正在思考...</div>
            ) : viewMode === 'code' && !currentSlideData ? (
              <div className="aling-preview-placeholder">等待生成...</div>
            ) : null}
          </div>

          <div className="aling-preview-nav">
            <button
              className="aling-nav-btn"
              disabled={currentSlide <= 0}
              onClick={() => setCurrentSlide(prev => prev - 1)}
            >
              ← 上一页
            </button>
            <span className="aling-nav-indicator">
              {currentSlide + 1} / {totalSlides || '?'}
            </span>
            <button
              className="aling-nav-btn"
              disabled={currentSlide >= totalSlides - 1}
              onClick={() => setCurrentSlide(prev => prev + 1)}
            >
              下一页 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function wrapSlideHTML(html: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
:root {
  --md-sys-color-surface: ${getCSSVar('bg-color') || '#1a1a2e'};
  --md-sys-color-on-surface: ${getCSSVar('text-color') || '#e0e0e0'};
  --md-sys-color-primary: #7b68ee;
  --md-sys-color-surface-container: ${getCSSVar('surface-color') || '#16213e'};
  --md-sys-color-on-surface-variant: ${getCSSVar('text-muted') || '#b0b0b0'};
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 1920px; height: 1080px; overflow: hidden; font-family: system-ui, sans-serif;
  display: flex; align-items: center; justify-content: center;
  background: var(--md-sys-color-surface); }
</style></head>
<body>${html}</body></html>`;
}

function getCSSVar(name: string): string {
  try {
    return getComputedStyle(document.body).getPropertyValue(`--${name}`).trim() || '';
  } catch { return ''; }
}
