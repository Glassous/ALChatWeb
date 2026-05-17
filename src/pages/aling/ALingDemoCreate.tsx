import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/progress/circular-progress.js';
import alingApi, { type ALingTask, type OutlineItem } from '../../services/alingApi';
import './ALingDemoCreate.css';

const LAYOUT_TYPES = ['title-slide', 'two-column', 'grid', 'bullet-list'];
const SLIDE_TYPES = ['cover', 'toc', 'section', 'content', 'ending'];

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchData {
  query: string;
  status: string;
  results?: SearchResult[] | { results?: SearchResult[] };
}

function emptyOutlineItem(index: number): OutlineItem {
  return { index, title: '', type: 'content', key_points: [''], image_hint: '', layout: 'bullet-list' };
}

function normalizeSearchResults(data: SearchData): SearchResult[] {
  if (!data.results) return [];
  if (Array.isArray(data.results)) return data.results;
  if (typeof data.results === 'object' && Array.isArray((data.results as any).results)) {
    return (data.results as any).results;
  }
  if (typeof data.results === 'object' && typeof (data.results as any).Value === 'object') {
    const values = (data.results as any).Value;
    if (Array.isArray(values)) return values;
  }
  return [];
}

export function ALingDemoCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const existingTaskId = searchParams.get('taskId');

  const [topic, setTopic] = useState('');
  const [enableSearch, setEnableSearch] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(existingTaskId);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>(existingTaskId ? 'loading' : 'idle');

  const [streamingText, setStreamingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [searchList, setSearchList] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // HTML Generation states
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [streamingSlideHTML, setStreamingSlideHTML] = useState('');
  const [completedSlides, setSlideDone] = useState<number[]>([]);

  const streamRef = useRef<AbortController | null>(null);

  // Helper to clean streaming HTML (remove markdown blocks if present)
  const getCleanedStreamingHTML = (raw: string) => {
    let cleaned = raw.trim();
    // Remove starting ```html or ```
    cleaned = cleaned.replace(/^```html\s*/i, '').replace(/^```\s*/, '');
    // Remove ending ``` (if it's at the very end and complete)
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    return cleaned;
  };

  useEffect(() => {
    if (existingTaskId) {
      alingApi.getDemoTask(existingTaskId).then(t => {
        setTopic(t.topic);
        setEnableSearch(t.enable_search);
        if (t.outline && t.outline.length > 0) {
          setOutline(t.outline);
          setStatus('outline_ready');
        } else {
          setStatus('idle');
        }
      }).catch(() => setStatus('idle'));
    }
  }, [existingTaskId]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.abort();
    };
  }, []);

  const handleCreateAndGenerateOutline = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setStreamingText('');
    setSearchList([]);
    setSearchQuery('');
    setIsThinking(false);
    setStatus('outline_generating');
    try {
      let tid = taskId;
      if (!tid) {
        const task = await alingApi.createDemo(topic.trim(), enableSearch);
        tid = task.id;
        setTaskId(tid);
      }
      await alingApi.generateOutline(tid!);
      setupSSE(tid!);
    } catch (e: any) {
      setStatus('idle');
      setLoading(false);
    }
  };

  const setupSSE = (tid: string) => {
    streamRef.current?.abort();
    streamRef.current = alingApi.streamTask(tid, (event) => {
      if (event.type === 'outline_token') {
        setStreamingText(prev => prev + (event.data?.token || ''));
      } else if (event.type === 'reasoning') {
        setIsThinking(true);
      } else if (event.type === 'search') {
        const data = event.data as SearchData;
        setSearchQuery(data?.query || '');
        setSearchList(normalizeSearchResults(data));
      } else if (event.type === 'outline_done') {
        setIsThinking(false);
        setStreamingText('');
        setSearchList([]);
        setOutline(event.data?.outline || []);
        setStatus('outline_ready');
        setLoading(false);
      } else if (event.type === 'slide_start') {
        const data = event.data;
        setCurrentSlideIndex(data.index);
        setTotalSlides(data.total);
        setStreamingSlideHTML('');
        setStatus('generating');
      } else if (event.type === 'slide_token') {
        setStreamingSlideHTML(prev => prev + (event.data?.token || ''));
      } else if (event.type === 'slide_done') {
        const data = event.data;
        setSlideDone(prev => [...prev, data.index]);
        setStreamingSlideHTML('');
      } else if (event.type === 'done') {
        setLoading(false);
        if (tid) navigate(`/aling/demo/${tid}`);
      } else if (event.type === 'error') {
        setIsThinking(false);
        setStatus('error');
        setLoading(false);
      }
    }, () => {
      setLoading(false);
    });
  };

  const handleUpdateOutlineItem = (idx: number, field: string, value: any) => {
    setOutline(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleUpdateKeyPoint = (itemIdx: number, kpIdx: number, value: string) => {
    setOutline(prev => {
      const next = [...prev];
      const kps = [...next[itemIdx].key_points];
      kps[kpIdx] = value;
      next[itemIdx] = { ...next[itemIdx], key_points: kps };
      return next;
    });
  };

  const handleAddKeyPoint = (itemIdx: number) => {
    setOutline(prev => {
      const next = [...prev];
      next[itemIdx] = { ...next[itemIdx], key_points: [...next[itemIdx].key_points, ''] };
      return next;
    });
  };

  const handleRemoveKeyPoint = (itemIdx: number, kpIdx: number) => {
    setOutline(prev => {
      const next = [...prev];
      const kps = next[itemIdx].key_points.filter((_, i) => i !== kpIdx);
      next[itemIdx] = { ...next[itemIdx], key_points: kps };
      return next;
    });
  };

  const handleAddPage = () => {
    const newIdx = outline.length > 0 ? Math.max(...outline.map(o => o.index)) + 1 : 1;
    setOutline(prev => [...prev, emptyOutlineItem(newIdx)]);
  };

  const handleDeletePage = (idx: number) => {
    setOutline(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setOutline(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((o, i) => ({ ...o, index: i + 1 }));
    });
  };

  const handleMoveDown = (idx: number) => {
    if (idx === outline.length - 1) return;
    setOutline(prev => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((o, i) => ({ ...o, index: i + 1 }));
    });
  };

  const handleSaveOutline = async () => {
    if (!taskId) return;
    await alingApi.updateOutline(taskId, outline);
  };

  const handleStartGenerate = async () => {
    if (!taskId) return;
    setLoading(true);
    setStatus('generating');
    setSlideDone([]);
    setCurrentSlideIndex(0);
    setStreamingSlideHTML('');
    try {
      await handleSaveOutline();
      await alingApi.generateHTML(taskId);
      setupSSE(taskId);
    } catch (e) {
      setLoading(false);
    }
  };

  return (
    <div className="aling-create-page">
      <header className="aling-topbar">
        <div className="aling-topbar-left">
          <md-icon-button onClick={() => navigate('/aling/demo')}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m313-440 224 224-57 57-320-320 320-320 57 57-224 224h487v80H313Z"/>
            </svg>
          </md-icon-button>
          <h1 className="aling-topbar-title">创作演示</h1>
        </div>
      </header>

      <main className="aling-create-main">
        {status === 'idle' || status === 'error' ? (
          <div className="aling-topic-section">
            <h2 className="aling-section-title">请输入演示主题</h2>
            <textarea
              className="aling-topic-input"
              placeholder="描述你想制作的演示内容，例如：人工智能发展历史与未来趋势..."
              value={topic}
              onChange={e => setTopic(e.target.value)}
              rows={5}
            />
            <div className="aling-search-toggle">
              <label className="aling-search-label">
                <input
                  type="checkbox"
                  checked={enableSearch}
                  onChange={e => setEnableSearch(e.target.checked)}
                />
                <span>启用联网搜索（获取最新资料）</span>
              </label>
            </div>
            <div className="aling-actions">
              <md-filled-button
                onClick={handleCreateAndGenerateOutline}
                disabled={!topic.trim() || loading}
              >
                {loading ? '生成中...' : '生成大纲'}
              </md-filled-button>
            </div>
            {status === 'error' && (
              <div className="aling-error">生成失败，请重试</div>
            )}
          </div>
        ) : status === 'loading' || status === 'outline_generating' ? (
          <div className="aling-generating-section">
            <div className="aling-generating-header">
              <md-circular-progress indeterminate />
              <span>正在生成大纲...</span>
            </div>
            {isThinking && (
              <div className="aling-thinking-badge">
                <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor">
                  <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/>
                </svg>
                模型正在思考...
              </div>
            )}
            {searchQuery && searchList.length > 0 && (
              <div className="aling-search-card">
                <div className="aling-search-card-header">
                  <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor">
                    <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/>
                  </svg>
                  搜索结果 · "{searchQuery}"
                </div>
                <div className="aling-search-results">
                  {searchList.slice(0, 4).map((r, i) => (
                    <a key={i} href={r.url} target="_blank" rel="noopener" className="aling-search-item">
                      <div className="aling-search-title">{r.title}</div>
                      <div className="aling-search-snippet">{r.snippet}</div>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {streamingText && (
              <pre className="aling-streaming-code"><code>{streamingText}</code></pre>
            )}
            {!streamingText && !isThinking && !searchQuery && (
              <div className="aling-streaming-placeholder">等待模型输出...</div>
            )}
          </div>
        ) : status === 'generating' ? (
          <div className="aling-generating-html-section">
            <div className="aling-generating-header">
              <md-circular-progress value={totalSlides > 0 ? completedSlides.length / totalSlides : 0} />
              <span>正在生成幻灯片内容... ({completedSlides.length} / {totalSlides})</span>
            </div>
            
            <div className="aling-slide-progress-grid">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <div 
                  key={i} 
                  className={`aling-progress-dot ${i + 1 === currentSlideIndex ? 'active' : ''} ${completedSlides.includes(i + 1) ? 'done' : ''}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {streamingSlideHTML && (
              <div className="aling-slide-preview-mini">
                <div className="aling-preview-label">正在实时生成第 {currentSlideIndex} 页:</div>
                <div 
                  className="aling-preview-content"
                  dangerouslySetInnerHTML={{ __html: getCleanedStreamingHTML(streamingSlideHTML) }}
                />
              </div>
            )}
          </div>
        ) : status === 'outline_ready' && outline.length > 0 ? (
          <div className="aling-outline-section">
            <div className="aling-outline-header">
              <h2 className="aling-section-title">
                大纲预览
                <span className="aling-page-count">共 {outline.length} 页</span>
              </h2>
              <div className="aling-outline-actions-top">
                <md-outlined-button onClick={handleCreateAndGenerateOutline}>重新生成大纲</md-outlined-button>
                <md-filled-button onClick={handleStartGenerate}>开始创作</md-filled-button>
              </div>
            </div>

            <div className="aling-outline-list">
              {outline.map((item, idx) => (
                <div key={idx} className="aling-outline-card">
                  <div className="aling-outline-card-header">
                    <span className="aling-outline-card-index">第 {idx + 1} 页</span>
                    <div className="aling-outline-card-actions">
                      <button onClick={() => handleMoveUp(idx)} disabled={idx === 0} title="上移">↑</button>
                      <button onClick={() => handleMoveDown(idx)} disabled={idx === outline.length - 1} title="下移">↓</button>
                      <button onClick={() => handleDeletePage(idx)} className="danger" title="删除">✕</button>
                    </div>
                  </div>
                  <div className="aling-outline-card-row">
                    <label>类型</label>
                    <select value={item.type} onChange={e => handleUpdateOutlineItem(idx, 'type', e.target.value)}>
                      {SLIDE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <label>布局</label>
                    <select value={item.layout || 'bullet-list'} onChange={e => handleUpdateOutlineItem(idx, 'layout', e.target.value)}>
                      {LAYOUT_TYPES.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="aling-outline-card-row">
                    <label>标题</label>
                    <input
                      type="text"
                      value={item.title}
                      onChange={e => handleUpdateOutlineItem(idx, 'title', e.target.value)}
                      placeholder="页标题"
                    />
                  </div>
                  <div className="aling-outline-card-row">
                    <label>配图建议</label>
                    <input
                      type="text"
                      value={item.image_hint || ''}
                      onChange={e => handleUpdateOutlineItem(idx, 'image_hint', e.target.value)}
                      placeholder="可选"
                    />
                  </div>
                  <div className="aling-outline-keypoints">
                    <label>要点</label>
                    {item.key_points.map((kp, kpIdx) => (
                      <div key={kpIdx} className="aling-kp-row">
                        <input
                          type="text"
                          value={kp}
                          onChange={e => handleUpdateKeyPoint(idx, kpIdx, e.target.value)}
                          placeholder="输入要点"
                        />
                        <button onClick={() => handleRemoveKeyPoint(idx, kpIdx)} className="kp-remove">×</button>
                      </div>
                    ))}
                    <button onClick={() => handleAddKeyPoint(idx)} className="kp-add">+ 添加要点</button>
                  </div>
                </div>
              ))}
              <button onClick={handleAddPage} className="aling-add-page-btn">+ 添加新页面</button>
            </div>

            <div className="aling-bottom-actions">
              <md-filled-button onClick={handleStartGenerate}>开始创作</md-filled-button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
