import React, { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type SearchData } from '../SearchSidebar/SearchSidebar';
import { WeatherCard, type WeatherData } from '../WeatherCard/WeatherCard';
import { getThumbnailUrl } from '../../utils/image';
import './ChatArea.css';
import { FullscreenLayer } from '../LayerSystem/LayerSystem';

export interface Message {
  id: string;
  conversation_id: string;
  parent_id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  mode?: 'daily' | 'expert' | 'search' | 'hermes';
  hermes_trace?: Array<{
    id: string;
    type: string;
    title: string;
    status: 'running' | 'completed' | 'failed';
    started_at?: string;
    ended_at?: string;
    duration_ms?: number;
    summary?: string;
    details?: string;
    raw?: unknown;
  }>;
  hermes_response_id?: string;
  hermes_context_version?: number;
  hermes_response_completed?: boolean;
  search?: {
    query: string;
    status: 'searching' | 'completed';
    results?: Array<{
      title: string;
      url: string;
      snippet: string;
    }>;
  };
  created_at: string;
  status?: 'pending' | 'loading' | 'completed' | 'error';
  metadata?: {
    resolution?: string;
		generationMode?: 'stream' | 'non_stream';
  };
  clientId?: string;
}


interface ChatAreaProps {
  messages: Message[];
  allMessages: Message[];
  onScrollStateChange?: (isAtBottom: boolean) => void;
  onShowSearch?: (data: SearchData) => void;
  onResend?: (msg: Message) => void;
  onEdit?: (msg: Message) => void;
  onSwitchBranch?: (messageId: string) => void;
  onOpenWorkspace?: (messageId: string, html: string, mode: 'code' | 'preview') => void;
  activeWorkspaceMessageId?: string | null;
}

export interface ChatAreaHandle {
  scrollToBottom: () => void;
}

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/></svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>
);

interface CodeBlockWrapperProps {
  lang: string;
  rawCode: string;
  children: React.ReactNode;
}

const CodeBlockWrapper = ({ lang, rawCode, children }: CodeBlockWrapperProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code: ', err);
    }
  };

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || 'text'}</span>
        <button 
          className={`code-block-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="复制代码"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {children}
    </div>
  );
};

const ResendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>
);

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>
);

const PrevIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></svg>
);

const NextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M383-240l-56-56 184-184-184-184 56-56 240 240-240 240Z"/></svg>
);

const WaitingForModel = ({ nonStreaming = false }: { nonStreaming?: boolean }) => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setSeconds(v => v + 1), 1000); return () => window.clearInterval(timer); }, []);
  return <div className="thinking-container"><div className="thinking-spinner"></div><span className="thinking-text">{nonStreaming ? '非流式输出 · 正在生成' : '正在等待模型响应'}{seconds >= 5 ? ` · ${seconds}s` : '...'}</span></div>;
};

type HermesStep = NonNullable<Message['hermes_trace']>[number];
type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asRecord = (value: unknown): JsonRecord => isRecord(value) ? value : {};
const firstString = (record: JsonRecord, ...keys: string[]) => {
  for (const key of keys) if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  return '';
};
const firstValue = (record: JsonRecord, ...keys: string[]) => {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
};
const looksLikeUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

const stepPayload = (step: HermesStep): unknown => {
  if (step.raw !== undefined && step.raw !== null) return step.raw;
  if (!step.details) return step.summary || null;
  try { return JSON.parse(step.details); } catch { return step.details; }
};

const displayJson = (value: unknown) => {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

const HermesCopyButton = ({ value }: { value: unknown }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof value === 'string' ? value : displayJson(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) { console.error('Failed to copy Hermes data:', error); }
  };
  return <button className="hermes-copy" onClick={copy} title="复制数据" aria-label="复制步骤数据">{copied ? <CheckIcon /> : <CopyIcon />}</button>;
};

const JsonValueCard = ({ value, depth = 0 }: { value: unknown; depth?: number }) => {
  if (value === null || value === undefined) return <span className="hermes-json-null">null</span>;
  if (typeof value === 'boolean') return <span className={`hermes-json-bool ${value ? 'true' : 'false'}`}>{String(value)}</span>;
  if (typeof value === 'number') return <span className="hermes-json-number">{value}</span>;
  if (typeof value === 'string') {
    if (looksLikeUrl(value)) return <a className="hermes-json-link" href={value} target="_blank" rel="noopener noreferrer">{value}</a>;
    if (value.length > 360) return <details className="hermes-long-value"><summary>{value.slice(0, 180)}…</summary><pre>{value}</pre></details>;
    return <span className="hermes-json-string">{value}</span>;
  }
  if (depth >= 4) return <code className="hermes-json-preview">{displayJson(value)}</code>;
  if (Array.isArray(value)) return (
    <div className="hermes-json-array">
      {value.length === 0 ? <span className="hermes-json-empty">空数组</span> : value.map((item, index) => <div className="hermes-json-row" key={index}><span className="hermes-json-key">{index + 1}</span><JsonValueCard value={item} depth={depth + 1} /></div>)}
    </div>
  );
  if (isRecord(value)) return (
    <div className="hermes-json-object">
      {Object.entries(value).map(([key, item]) => <div className="hermes-json-row" key={key}><span className="hermes-json-key">{key.replaceAll('_', ' ')}</span><JsonValueCard value={item} depth={depth + 1} /></div>)}
    </div>
  );
  return <span className="hermes-json-string">{String(value)}</span>;
};

const HermesDataCard = ({ title, icon, children, tone = 'default' }: { title: string; icon: string; children: React.ReactNode; tone?: string }) => (
  <section className={`hermes-data-card ${tone}`}>
    <header><span aria-hidden="true">{icon}</span><strong>{title}</strong></header>
    <div className="hermes-data-body">{children}</div>
  </section>
);

const LabeledValue = ({ label, value }: { label: string; value: unknown }) => value === undefined || value === null || value === '' ? null : (
  <div className="hermes-field"><span>{label}</span><JsonValueCard value={value} /></div>
);

const eventKind = (step: HermesStep, payload: JsonRecord, item: JsonRecord) => {
  const names = [step.type, step.title, firstString(payload, 'type', 'name'), firstString(item, 'type', 'name')].join(' ').toLowerCase();
  if (names.includes('response.created')) return 'response.created';
  if (names.includes('function_call_output')) return 'function_call_output';
  if (names.includes('web_search')) return 'web_search';
  if (names.includes('web_extract')) return 'web_extract';
  if (names.includes('terminal') || names.includes('shell') || names.includes('command')) return 'terminal';
  if (names.includes('message')) return 'message';
  return 'generic';
};

const HermesEventDetails = ({ step }: { step: HermesStep }) => {
  const value = stepPayload(step);
  const payload = asRecord(value);
  const item = asRecord(payload.item);
  const data = Object.keys(item).length ? item : payload;
  const kind = eventKind(step, payload, item);
  const rawPanel = <details className="hermes-raw"><summary>原始 JSON</summary><div className="hermes-raw-toolbar"><HermesCopyButton value={value} /></div><JsonValueCard value={value} /></details>;

  if (kind === 'response.created') {
    const response = asRecord(payload.response);
    const source = Object.keys(response).length ? response : data;
    return <><HermesDataCard title="响应已创建" icon="✦" tone="response"><div className="hermes-field-grid"><LabeledValue label="响应 ID" value={firstValue(source, 'id', 'response_id')} /><LabeledValue label="模型" value={firstValue(source, 'model')} /><LabeledValue label="状态" value={firstValue(source, 'status')} /><LabeledValue label="创建时间" value={firstValue(source, 'created_at', 'created')} /><LabeledValue label="上游响应" value={firstValue(source, 'previous_response_id')} /></div></HermesDataCard>{rawPanel}</>;
  }
  if (kind === 'terminal') {
    const command = firstValue(data, 'command', 'cmd', 'input', 'arguments');
    const output = firstValue(data, 'output', 'stdout', 'result', 'content');
    return <><HermesDataCard title="终端" icon=">_" tone="terminal"><LabeledValue label="工作目录" value={firstValue(data, 'cwd', 'working_directory', 'path')} />{command !== undefined && <div className="hermes-code-section"><span>命令</span><pre>{typeof command === 'string' ? command : displayJson(command)}</pre></div>}{output !== undefined && <div className="hermes-code-section"><span>输出</span><pre>{typeof output === 'string' ? output : displayJson(output)}</pre></div>}<div className="hermes-field-grid"><LabeledValue label="退出码" value={firstValue(data, 'exit_code', 'code')} /><LabeledValue label="状态" value={firstValue(data, 'status')} /></div></HermesDataCard>{rawPanel}</>;
  }
  if (kind === 'function_call_output') {
    const output = firstValue(data, 'output', 'result', 'content');
    return <><HermesDataCard title="函数调用结果" icon="ƒ" tone="function"><div className="hermes-field-grid"><LabeledValue label="函数" value={firstValue(data, 'name', 'function_name')} /><LabeledValue label="调用 ID" value={firstValue(data, 'call_id', 'id')} /><LabeledValue label="状态" value={firstValue(data, 'status')} /></div><LabeledValue label="参数" value={firstValue(data, 'arguments', 'input')} />{output !== undefined && <div className="hermes-output-block"><span>输出</span><JsonValueCard value={output} /></div>}</HermesDataCard>{rawPanel}</>;
  }
  if (kind === 'web_search') {
    const resultsValue = firstValue(data, 'results', 'sources', 'items');
    const results = Array.isArray(resultsValue) ? resultsValue : [];
    return <><HermesDataCard title="网页搜索" icon="⌕" tone="web"><div className="hermes-field-grid"><LabeledValue label="搜索词" value={firstValue(data, 'query', 'q', 'search_query')} /><LabeledValue label="状态" value={firstValue(data, 'status')} /></div>{results.length > 0 && <div className="hermes-web-results">{results.map((result, index) => { const record = asRecord(result); const url = firstString(record, 'url', 'link'); return <article key={index}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{firstString(record, 'title', 'name') || url}</a> : <strong>{firstString(record, 'title', 'name') || `结果 ${index + 1}`}</strong>}<small>{firstString(record, 'domain', 'site_name', 'source')}</small><p>{firstString(record, 'snippet', 'description', 'text')}</p></article>; })}</div>}</HermesDataCard>{rawPanel}</>;
  }
  if (kind === 'web_extract') {
    const url = firstString(data, 'url', 'link', 'source_url');
    const content = firstValue(data, 'content', 'text', 'markdown', 'excerpt');
    return <><HermesDataCard title="网页提取" icon="↗" tone="web"><div className="hermes-field-grid"><LabeledValue label="页面" value={firstValue(data, 'title', 'name')} /><LabeledValue label="来源" value={url} /><LabeledValue label="状态" value={firstValue(data, 'status')} /></div>{content !== undefined && <div className="hermes-extract-content"><JsonValueCard value={content} /></div>}</HermesDataCard>{rawPanel}</>;
  }
  if (kind === 'message') {
    const content = firstValue(data, 'content', 'text', 'message');
    return <><HermesDataCard title="消息" icon="◌" tone="message"><LabeledValue label="角色" value={firstValue(data, 'role')} />{typeof content === 'string' ? <div className="hermes-message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div> : <JsonValueCard value={content ?? data} />}</HermesDataCard>{rawPanel}</>;
  }
  return <HermesDataCard title="事件数据" icon="{}"><div className="hermes-generic-toolbar"><HermesCopyButton value={value} /></div><JsonValueCard value={value} /></HermesDataCard>;
};

const HermesChevron = ({ expanded }: { expanded: boolean }) => (
  <span className={`hermes-chevron ${expanded ? 'expanded' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5" /></svg>
  </span>
);

const HermesStepCard = ({ step }: { step: HermesStep }) => {
  const [expanded, setExpanded] = useState(false);
  const reactId = React.useId();
  const panelId = `hermes-step-${reactId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${step.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return <article className={`hermes-step ${step.status}`}>
    <button className="hermes-step-header" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={panelId}>
      <span className="hermes-step-dot"/><span className="hermes-step-title">{step.title || step.type}</span>{step.summary && <span className="hermes-step-summary">{step.summary}</span>}{step.duration_ms ? <time>{step.duration_ms}ms</time> : null}<HermesChevron expanded={expanded} />
    </button>
    <div className={`hermes-step-content ${expanded ? 'expanded' : ''}`} id={panelId}><div><HermesEventDetails step={step} /></div></div>
  </article>;
};

const HermesTimeline = ({ steps, loading }: { steps: NonNullable<Message['hermes_trace']>; loading: boolean }) => {
  const [expanded, setExpanded] = useState(loading);
  const wasLoading = useRef(loading);
  useEffect(() => {
    if (wasLoading.current && !loading) setExpanded(false);
    wasLoading.current = loading;
  }, [loading]);
  const failed = steps.some(step => step.status === 'failed');
  const statusLabel = loading ? '正在运行' : failed ? '运行失败' : '已完成';
  return <section className={`hermes-timeline ${expanded ? 'expanded' : 'collapsed'}`} aria-label="Hermes 执行过程">
    <button className="hermes-timeline-header" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
      <img className={loading ? 'hermes-pulse' : 'hermes-done'} src="/HermesAgent.png" alt="" /><strong>Hermes</strong><span className="hermes-step-count">{steps.length} 个步骤</span><small className={failed ? 'failed' : ''}>{statusLabel}</small><HermesChevron expanded={expanded} />
    </button>
    <div className={`hermes-timeline-content ${expanded ? 'expanded' : ''}`}><div>{steps.map(step => <HermesStepCard step={step} key={step.id} />)}</div></div>
  </section>;
};

function MessageItem({ 
  msg, 
  allMessages,
  onImageClick, 
  onShowSearch,
  onResend,
  onEdit,
  onSwitchBranch,
  onOpenWorkspace,
  activeWorkspaceMessageId
}: { 
  msg: Message; 
  allMessages: Message[];
  onImageClick: (url: string) => void;
  onShowSearch?: (data: SearchData) => void;
  onResend?: (msg: Message) => void;
  onEdit?: (msg: Message) => void;
  onSwitchBranch?: (messageId: string) => void;
  onOpenWorkspace?: (messageId: string, html: string, mode: 'code' | 'preview') => void;
  activeWorkspaceMessageId?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isManual, setIsManual] = useState(false);
  const [isUserCollapsed, setIsUserCollapsed] = useState(true);
  const [showExpandButton, setShowExpandButton] = useState(false);
  const userBubbleRef = useRef<HTMLDivElement>(null);

  const siblings = allMessages.filter(m => (m.parent_id || null) === (msg.parent_id || null));
  const siblingIndex = siblings.findIndex(m => m.id === msg.id);
  const hasSiblings = siblings.length > 1;

  // For assistant messages, we also check if the parent (user message) has siblings (e.g. user edited their question)
  const userParent = msg.role === 'assistant' ? allMessages.find(m => m.id === msg.parent_id) : null;
  const parentSiblings = userParent 
    ? allMessages.filter(m => (m.parent_id || null) === (userParent.parent_id || null))
    : [];
  const parentSiblingIndex = userParent 
    ? parentSiblings.findIndex(m => m.id === userParent.id)
    : -1;
  const hasParentSiblings = parentSiblings.length > 1;

  const handlePrevBranch = () => {
    if (siblingIndex > 0) {
      onSwitchBranch?.(siblings[siblingIndex - 1].id);
    }
  };

  const handleNextBranch = () => {
    if (siblingIndex < siblings.length - 1) {
      onSwitchBranch?.(siblings[siblingIndex + 1].id);
    }
  };

  const handlePrevParentBranch = () => {
    if (parentSiblingIndex > 0) {
      onSwitchBranch?.(parentSiblings[parentSiblingIndex - 1].id);
    }
  };

  const handleNextParentBranch = () => {
    if (parentSiblingIndex < parentSiblings.length - 1) {
      onSwitchBranch?.(parentSiblings[parentSiblingIndex + 1].id);
    }
  };

  const toggleUserCollapse = () => {
    const willExpand = isUserCollapsed;
    setIsUserCollapsed(!isUserCollapsed);
    
    // If expanding, scroll to bottom of the bubble after state update
    if (willExpand) {
      setTimeout(() => {
        userBubbleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 300); // Wait for transition animation (matching CSS 0.3s)
    }
  };

  // Auto-collapse logic for assistant reasoning
  useEffect(() => {
    if (isManual) return;

    if (msg.reasoning && !msg.content) {
      // Reasoning/content are streaming lifecycle signals from the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsCollapsed(false); // Expand while reasoning
    } else if (msg.reasoning && msg.content) {
      setIsCollapsed(true); // Collapse when main content starts
    }
  }, [msg.reasoning, msg.content, isManual]);

  // Check if user message is long enough to collapse
  useEffect(() => {
    if (msg.role === 'user' && userBubbleRef.current) {
      const scrollHeight = userBubbleRef.current.scrollHeight;
      // We use a threshold of 200px for "very long"
      if (scrollHeight > 200) {
        setShowExpandButton(true);
      }
    }
  }, [msg.content, msg.role]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const renderContent = () => {
    if (msg.status === 'loading' && !msg.content && !msg.reasoning && !msg.search && !msg.metadata?.resolution) {
      return <WaitingForModel nonStreaming={msg.metadata?.generationMode === 'non_stream'} />;
    }

    // Determine if we should show image loading placeholder
    const showImageLoader = msg.status === 'loading' && msg.metadata?.resolution && !msg.content.includes('<image');
    let aspectRatio: number | undefined;
    if (showImageLoader && msg.metadata?.resolution) {
      const [w, h] = msg.metadata.resolution.split('x').map(Number);
      aspectRatio = w / h;
    }

    let contentForRender = msg.content;
    if (contentForRender.includes('<image')) {
      contentForRender = contentForRender.substring(contentForRender.indexOf('<image'));
    }
    if (contentForRender.includes('<search>')) {
      contentForRender = contentForRender.substring(contentForRender.indexOf('<search>'));
    }
    if (contentForRender.includes('<weather>')) {
      contentForRender = contentForRender.substring(contentForRender.indexOf('<weather>'));
    }

    const processedContent = contentForRender
      .replace(/<image src="([^"]+)">/g, '![generated-image]($1)')
      .replace(/\n?<search>[\s\S]*?<\/search>\n?/g, '') // Remove completed search tag and surrounding newlines
      .replace(/\n?<search>[\s\S]*/g, '') // Remove partial search tag during streaming and leading newline
      .replace(/\n?<weather>[\s\S]*?<\/weather>\n?/g, '') // Remove weather tag
      .replace(/(?:ref\((\d+)\)|\[(\d+)\]|【(\d+)】)/g, (_, g1, g2, g3) => `[${g1 || g2 || g3}](ref:${g1 || g2 || g3})`);

    let displayWeather: WeatherData | null = null;
    const weatherMatch = msg.content.match(/<weather>([\s\S]*?)<\/weather>/);
    if (weatherMatch && weatherMatch[1]) {
      try {
        displayWeather = JSON.parse(weatherMatch[1].trim());
      } catch (e) {
        console.error('Failed to parse weather data:', e);
      }
    }
    // Fallback search data if msg.search is missing but exists in content
    let displaySearch = msg.search;
    if (!displaySearch && msg.content.includes('<search>')) {
      const match = msg.content.match(/<search>([\s\S]*?)<\/search>/);
      if (match && match[1]) {
        try {
          const content = match[1].trim();
          if (content) {
            const parsed = JSON.parse(content);
            displaySearch = {
              query: parsed.query || '',
              status: 'completed',
              results: parsed.results || []
            };
          }
        } catch (e) {
          console.error('Failed to parse search data from content:', e);
        }
      } else if (msg.content.includes('<search>')) {
        // Partial search tag during streaming, try to extract query if possible
        const queryMatch = msg.content.match(/"query"\s*:\s*"([^"]*)"/);
        if (queryMatch && queryMatch[1]) {
          displaySearch = {
            query: queryMatch[1],
            status: 'searching'
          };
        }
      }
    }


    type MarkdownElement = React.ReactElement<{ className?: string; children?: React.ReactNode }>;
    type PreRendererProps = React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode };
    type CodeRendererProps = React.HTMLAttributes<HTMLElement> & {
      inline?: boolean;
      children?: React.ReactNode;
    };

    const markdownComponents = {
      img: ({ src, alt }: { src?: string, alt?: string }) => {
        const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
          const target = e.target as HTMLImageElement;
          if (src && src.includes('alchatfiles.fiacloud.top')) {
            const fallback = src.replace('alchatfiles.fiacloud.top', 'alchatfiles-1350226447.cos.ap-tokyo.myqcloud.com');
            if (target.src !== fallback) {
              target.src = fallback;
            }
          }
        };
        return (
          <span className="image-container-msg">
            <img 
              src={getThumbnailUrl(src)} 
              alt={alt || "Generated"} 
              className="generated-image" 
              onClick={() => onImageClick(src!)}
              onError={handleImgError}
            />
          </span>
        );
      },
      a: ({ href, children }: { href?: string, children?: React.ReactNode }) => {
        const isRef = href?.startsWith('ref:');
        const childrenText = typeof children === 'string' ? children : '';
        const isNumericLink = /^\d+$/.test(childrenText);
        
        if (isRef || isNumericLink) {
          const indexStr = isRef ? (href as string).split(':')[1] : childrenText;
          const index = parseInt(indexStr) - 1;
          const result = displaySearch?.results?.[index];
          
          return (
            <span 
              className="ref-card" 
              onClick={() => result && window.open(result.url, '_blank')}
              title={result?.title || `引用 ${index + 1}`}
            >
              {index + 1}
            </span>
          );
        }
        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
      },
      pre: ({ children, ...props }: PreRendererProps) => {
        const isHtmlCodeBlock = React.Children.toArray(children).some((child) => {
          return React.isValidElement(child) && (child as MarkdownElement).props.className === 'language-html';
        });
        if (isHtmlCodeBlock) {
          return <>{children}</>;
        }

        const codeElement = React.Children.toArray(children).find(
          (child): child is MarkdownElement => React.isValidElement(child),
        );

        if (codeElement) {
          const className = codeElement.props.className || '';
          const match = /language-(\w+)/.exec(className);
          const lang = match ? match[1] : '';
          
          const getRawText = (node: unknown): string => {
            if (typeof node === 'string') return node;
            if (typeof node === 'number') return String(node);
            if (Array.isArray(node)) return node.map(getRawText).join('');
            if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
              return getRawText(node.props.children);
            }
            return '';
          };
          
          const rawCode = getRawText(codeElement.props.children).replace(/\n$/, '');

          return (
            <CodeBlockWrapper lang={lang} rawCode={rawCode}>
              <pre {...props}>{children}</pre>
            </CodeBlockWrapper>
          );
        }

        return <pre {...props}>{children}</pre>;
      },
      code: ({ inline, className, children, ...props }: CodeRendererProps) => {
        const match = /language-(\w+)/.exec(className || '');
        const lang = match ? match[1] : '';
        const codeContent = String(children).replace(/\n$/, '');
        
        if (!inline && lang === 'html') {
          const isActive = activeWorkspaceMessageId === msg.id;
          
          return (
            <div className={`html-preview-card ${isActive ? 'active' : ''}`}>
              <div className="html-preview-card-icon">
                <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                  <path d="M320-240 120-440l200-200 56 56-144 144 144 144-56 56Zm320 0-56-56 144-144-144-144 56-56 200 200-200 200Z"/>
                </svg>
              </div>
              <div className="html-preview-card-actions">
                <button 
                  className="html-preview-card-btn code-btn" 
                  onClick={() => onOpenWorkspace?.(msg.id, codeContent, 'code')}
                >
                  代码
                </button>
                <button 
                  className="html-preview-card-btn preview-btn" 
                  onClick={() => onOpenWorkspace?.(msg.id, codeContent, 'preview')}
                >
                  预览
                </button>
              </div>
            </div>
          );
        }
        
        return <code className={className} {...props}>{children}</code>;
      }
    };

    return (
      <>
        {displaySearch && (
          <div 
            className={`search-container ${displaySearch.status === 'completed' ? 'completed' : ''}`}
            onClick={() => displaySearch?.status === 'completed' && onShowSearch?.(displaySearch as SearchData)}
          >
            <div className="search-header">
              <div className="search-label">
                {displaySearch.status === 'searching' ? (
                  <div className="search-spinner"></div>
                ) : (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className="search-icon">
                    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                  </svg>
                )}
                <span className="search-text">
                  {displaySearch.status === 'searching' ? `正在搜索: ${displaySearch.query}` : `已找到 ${displaySearch.results?.length || 0} 条搜索结果`}
                </span>
              </div>
            </div>
          </div>
        )}
        {displayWeather && <WeatherCard data={displayWeather} />}
        {msg.reasoning && (
          <div className="reasoning-container">
            <div 
              className="reasoning-header" 
              onClick={() => {
                setIsCollapsed(!isCollapsed);
                setIsManual(true);
              }}
            >
              <div className="reasoning-label">
                <svg 
                  className={`collapse-icon ${isCollapsed ? '' : 'expanded'}`} 
                  viewBox="0 0 24 24" 
                  width="14" 
                  height="14" 
                  fill="currentColor"
                >
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
                思考内容
              </div>
            </div>
            <div className={`reasoning-content-wrapper ${!isCollapsed ? 'expanded' : ''}`}>
              <div className="reasoning-content-inner">
                <div className="reasoning-content">
                  <div className="reasoning-text">
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {msg.reasoning.replace(/(?:ref\((\d+)\)|\[(\d+)\]|【(\d+)】)/g, (_, g1, g2, g3) => `[${g1 || g2 || g3}](ref:${g1 || g2 || g3})`)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {showImageLoader ? (
          <div 
            className="image-loading-placeholder" 
            style={{ aspectRatio: `${aspectRatio}` }}
          >
            <div className="image-loading-shimmer"></div>
            <div className="loading-spinner-container">
              <div className="loading-spinner"></div>
              <span>正在绘制您的灵感...</span>
            </div>
          </div>
        ) : (
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {processedContent}
          </ReactMarkdown>
        )}
      </>
    );
  };

  const isPureImage = msg.content.trim().startsWith('<image') && msg.content.replace(/<image src="[^"]+">/g, '').trim() === '';

  return (
    <div className={`message-wrapper ${msg.role}`}>
      <div className="message-container">
        {msg.role === 'user' ? (
          <>
            <div 
              className={`message-bubble user-bubble ${showExpandButton && isUserCollapsed ? 'collapsed' : ''}`}
              ref={userBubbleRef}
            >
              {(msg.content.includes('<image') || msg.content.includes('<file')) ? (
                <div className="user-message-with-image">
                  {(() => {
                    const imageRegex = /<(?:image|file) src="([^"]+)">/g;
                    const images: string[] = [];
                    let match;
                    while ((match = imageRegex.exec(msg.content)) !== null) {
                      const url = match[1];
                      // Simple image extension check or just assume it's an image for now as requested
                      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(?:\?.*)?$/i.test(url) || url.includes('image');
                      if (isImage) {
                        images.push(url);
                      }
                    }
                    
                    const textContent = msg.content.replace(/<(?:image|file) src="([^"]+)">/g, '').trim();
                    
                    return (
                      <>
                        {images.length > 0 && (
                          <div className="user-images-grid">
                            {images.map((url, idx) => {
                              const handleUserImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                                const target = e.target as HTMLImageElement;
                                if (url && url.includes('alchatfiles.fiacloud.top')) {
                                  const fallback = url.replace('alchatfiles.fiacloud.top', 'alchatfiles-1350226447.cos.ap-tokyo.myqcloud.com');
                                  if (target.src !== fallback) {
                                    target.src = fallback;
                                  }
                                }
                              };
                              return (
                                <div key={idx} className="user-ref-image-card" onClick={() => onImageClick(url)}>
                                  <img 
                                    src={getThumbnailUrl(url)} 
                                    alt={`Reference ${idx}`} 
                                    onError={handleUserImgError}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {textContent && <div className="user-message-text">{textContent}</div>}
                      </>
                    );
                  })()}
                </div>
              ) : (
                msg.content
              )}
              {showExpandButton && (
                <button 
                  className={`user-collapse-toggle ${isUserCollapsed ? 'collapsed' : 'expanded'}`}
                  onClick={toggleUserCollapse}
                  title={isUserCollapsed ? '展开全部' : '收起内容'}
                >
                  {isUserCollapsed ? (
                    <svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 -960 960 960" width="32px" fill="#999999">
                      <path d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 -960 960 960" width="32px" fill="#999999">
                      <path d="M480-528 296-344l-56-56 240-240 240 240-56 56-184-184Z"/>
                    </svg>
                  )}
                </button>
              )}
            </div>
            {!isPureImage && (
              <div className="user-actions">
                <button 
                  className={`copy-button ${copied ? 'copied' : ''}`} 
                  onClick={handleCopy}
                  title="复制消息"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button 
                  className="action-button edit-action" 
                  onClick={() => onEdit?.(msg)}
                  title="编辑并发送"
                >
                  <EditIcon />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="assistant-message-content">
            <div className="message-text assistant-text">
              {msg.role === 'assistant' && msg.mode === 'hermes' && <HermesTimeline steps={msg.hermes_trace || []} loading={msg.status === 'loading'} />}
              {renderContent()}
            </div>
            {!isPureImage && (
              <div className="assistant-actions">
                {/* Branch Switcher: Priority to AI regeneration, then User edits */}
                {hasSiblings ? (
                  <div className="branch-switcher assistant">
                    <button 
                      className="branch-btn" 
                      onClick={handlePrevBranch} 
                      disabled={siblingIndex === 0}
                    >
                      <PrevIcon />
                    </button>
                    <span className="branch-info">{siblingIndex + 1} / {siblings.length}</span>
                    <button 
                      className="branch-btn" 
                      onClick={handleNextBranch} 
                      disabled={siblingIndex === siblings.length - 1}
                    >
                      <NextIcon />
                    </button>
                  </div>
                ) : hasParentSiblings ? (
                  <div className="branch-switcher assistant">
                    <button 
                      className="branch-btn" 
                      onClick={handlePrevParentBranch} 
                      disabled={parentSiblingIndex === 0}
                    >
                      <PrevIcon />
                    </button>
                    <span className="branch-info">{parentSiblingIndex + 1} / {parentSiblings.length}</span>
                    <button 
                      className="branch-btn" 
                      onClick={handleNextParentBranch} 
                      disabled={parentSiblingIndex === parentSiblings.length - 1}
                    >
                      <NextIcon />
                    </button>
                  </div>
                ) : null}

                <button 
                  className={`action-button copy-action ${copied ? 'copied' : ''}`} 
                  onClick={handleCopy}
                  title="复制消息"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>

                <button 
                  className={`action-button resend-action`} 
                  onClick={() => onResend?.(msg)}
                  title="重新发送"
                >
                  <ResendIcon />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatArea = forwardRef<ChatAreaHandle, ChatAreaProps>(({ 
  messages, 
  allMessages,
  onScrollStateChange, 
  onShowSearch, 
  onResend, 
  onEdit,
  onSwitchBranch,
  onOpenWorkspace,
  activeWorkspaceMessageId
}, ref) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isAutoScrollEnabledRef = useRef(true);
  const prevLastMessageIdRef = useRef<string | null>(messages[messages.length - 1]?.id || null);
  const isFirstRenderRef = useRef(true);
  // Track user-initiated scroll interactions to prevent content-change scrolls
  // from falsely re-enabling auto-scroll
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Detect user scroll interactions (wheel, touch, scrollbar drag)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const markUserScrolling = () => {
      isUserScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 200);
    };

    el.addEventListener('wheel', markUserScrolling, { passive: true });
    el.addEventListener('touchmove', markUserScrolling, { passive: true });
    el.addEventListener('mousedown', markUserScrolling);

    return () => {
      el.removeEventListener('wheel', markUserScrolling);
      el.removeEventListener('touchmove', markUserScrolling);
      el.removeEventListener('mousedown', markUserScrolling);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    
    // We consider it near bottom if within 10px
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 10;
    // CRITICAL: Only update auto-scroll tracking on user-initiated scrolls.
    // Content height changes (e.g., reasoning collapse)
    // can shift scroll position near bottom, which should NOT re-enable auto-scroll.
    if (isUserScrollingRef.current) {
      isAutoScrollEnabledRef.current = isNearBottom;
    }
    // Always report to parent for scroll-to-bottom button visibility
    onScrollStateChange?.(isNearBottom);

    // Manual active message detection for better accuracy, especially at bottom
    // We want the message that is currently at the top of the viewport (with some offset)
    const offset = 20; // 20px offset from top
    const userMessageEls = Array.from(messageRefs.current.entries())
      .filter(([id]) => {
        const msg = messages.find(m => m.id === id);
        return msg?.role === 'user';
      });

    // If at the very bottom, highlight the last user message
    if (scrollHeight - scrollTop - clientHeight < 50) {
      if (userMessageEls.length > 0) {
        setActiveMessageId(userMessageEls[userMessageEls.length - 1][0]);
        return;
      }
    }

    let currentActiveId = activeMessageId;
    let minDistance = Infinity;

    userMessageEls.forEach(([id, el]) => {
      const rect = el.getBoundingClientRect();
      const containerRect = scrollRef.current!.getBoundingClientRect();
      const distance = Math.abs(rect.top - containerRect.top - offset);
      
      if (distance < minDistance) {
        minDistance = distance;
        currentActiveId = id;
      }
    });

    if (currentActiveId !== activeMessageId) {
      setActiveMessageId(currentActiveId);
    }
  }, [onScrollStateChange, messages, activeMessageId]);

  // Remove the IntersectionObserver effect as we're now using manual scroll detection
  useEffect(() => {
    // No-op, functionality moved to handleScroll for better control
  }, [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior
      });
    }
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      isAutoScrollEnabledRef.current = true;
      scrollToBottom('smooth');
    }
  }));

  // Auto-scroll on new messages
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    const lastMessageId = lastMessage?.id || null;
    const prevLastMessageId = prevLastMessageIdRef.current;
    // Case 1: First render after mount — scroll to bottom immediately
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      prevLastMessageIdRef.current = lastMessageId;
      if (messages.length > 0) {
        scrollToBottom('auto');
      }
      return;
    }

    // Detect genuinely new messages (excluding temp->real ID renames)
    const isRename = !!(
      prevLastMessageId?.startsWith('temp-') &&
      lastMessageId &&
      !lastMessageId.startsWith('temp-')
    );
    const isGenuinelyNew =
      lastMessageId !== null &&
      lastMessageId !== prevLastMessageId &&
      !isRename;

    prevLastMessageIdRef.current = lastMessageId;

    // Case 2: A genuinely new message was added → force scroll to bottom
    if (isGenuinelyNew) {
      isAutoScrollEnabledRef.current = true;
      scrollToBottom('smooth');
      return;
    }

    // Case 3: Streaming update → do NOTHING (auto-scroll disabled during generation)

    // Case 4: Generation ended, content update, ID rename, etc. → do NOTHING
  }, [messages, scrollToBottom]);

  const handleDownload = async () => {
    if (!previewUrl) return;
    try {
      const response = await fetch(previewUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `generated-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to download image:', err);
    }
  };

  const scrollToMessage = (id: string) => {
    const el = messageRefs.current.get(id);
    if (el && scrollRef.current) {
      // el.offsetTop gives the distance from the top of the scrollable container
      // We subtract the container's padding-top (24px) to align it perfectly
      const targetScrollTop = el.offsetTop - 24;
      scrollRef.current.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      });
    }
  };

  const getFilteredContent = (content: string) => {
    if (!content) return '';
    
    // Check if it's purely a file or image message
    const hasFile = content.includes('<file');
    const hasImage = content.includes('<image');
    const hasWeather = content.includes('<weather>');

    // Strip <file ...>, <image ...>, <weather>...</weather> tags
    const filtered = content
      .replace(/<file[^>]*>/g, '')
      .replace(/<image[^>]*>/g, '')
      .replace(/\n?<weather>[\s\S]*?<\/weather>\n?/g, '')
      .trim();

    // If empty after filtering, show placeholder
    if (!filtered) {
      if (hasFile && hasImage) return '[文件与图片]';
      if (hasFile) return '[文件]';
      if (hasImage) return '[图片]';
      if (hasWeather) return '[天气]';
      return '消息';
    }

    return filtered;
  };

  return (
    <div className="chat-area" ref={scrollRef} onScroll={handleScroll}>
      <div className="chat-content">
        {messages.map((msg) => (
          <div 
            key={msg.clientId || msg.id} 
            data-message-id={msg.id}
            ref={(el) => {
              if (el) messageRefs.current.set(msg.id, el);
              else messageRefs.current.delete(msg.id);
            }}
          >
            <MessageItem 
              msg={msg} 
              allMessages={allMessages}
              onImageClick={setPreviewUrl} 
              onShowSearch={onShowSearch}
              onResend={onResend}
              onEdit={onEdit}
              onSwitchBranch={onSwitchBranch}
              onOpenWorkspace={onOpenWorkspace}
              activeWorkspaceMessageId={activeWorkspaceMessageId}
            />
          </div>
        ))}
      </div>

      {/* Message Navigator */}
      {messages.some(m => m.role === 'user') && (
        <div className="message-navigator">
          <div className="navigator-card">
            {messages.filter(m => m.role === 'user').map((msg) => (
              <div 
                key={msg.clientId || msg.id} 
                className={`navigator-item ${activeMessageId === msg.id ? 'active' : ''}`}
                onClick={() => scrollToMessage(msg.id)}
              >
                <span className="navigator-text">{getFilteredContent(msg.content)}</span>
                <span className="navigator-bar"></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewUrl && (
        <FullscreenLayer open ariaLabel="图片预览" onClose={() => setPreviewUrl(null)}>
          <div className="image-preview-overlay" onClick={() => setPreviewUrl(null)}>
            <div className="preview-header" onClick={e => e.stopPropagation()}>
              <button className="preview-action-btn download-btn" onClick={handleDownload} title="下载图片">
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>
              </button>
              <button className="preview-action-btn close-btn" onClick={() => setPreviewUrl(null)} title="关闭预览">
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>
              </button>
            </div>
            <div className="preview-content" onClick={e => e.stopPropagation()}>
              <img src={getThumbnailUrl(previewUrl)} alt="预览" className="preview-image" />
            </div>
          </div>
        </FullscreenLayer>
      )}
    </div>
  );
});
