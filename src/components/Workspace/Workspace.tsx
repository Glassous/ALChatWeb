import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { readAttachmentData, type AttachmentDescriptor } from '../../services/attachments';
import { useToast } from '../LayerSystem/LayerSystem';
import './Workspace.css';

const CodePreview = lazy(() => import('../FilePreview/CodePreview').then(module => ({ default: module.CodePreview })));

interface WorkspaceProps {
  html: string;
  mode: 'code' | 'preview';
  onChangeMode: (mode: 'code' | 'preview') => void;
  onClose: () => void;
  title: string;
  filename?: string;
  file?: AttachmentDescriptor;
  isLoading?: boolean;
  error?: string;
  onRetry?: () => void;
}

export function Workspace({ html, mode, onChangeMode, onClose, title, filename, file, isLoading, error, onRetry }: WorkspaceProps) {
  const [previewKey, setPreviewKey] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const showToast = useToast();
  const downloadRequest = useRef<AbortController | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  useEffect(() => () => { downloadRequest.current?.abort(); }, [file]);
  const download = async () => {
    const controller = new AbortController(); downloadRequest.current = controller; setDownloading(true);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const data = file ? (await readAttachmentData(file, controller.signal)).bytes : html;
      const url = URL.createObjectURL(new Blob([data], { type: 'text/html;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = filename || (/\.html?$/i.test(title) ? title : `${title || 'workspace_page'}.html`);
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (!controller.signal.aborted) showToast({ tone: 'error', message: '下载失败，请重试' }); }
    finally { clearTimeout(timer); setDownloading(false); }
  };
  return <div className="workspace-panel">
    <div className="workspace-header">
      <div className="workspace-tabs"><button className={`workspace-tab ${mode === 'code' ? 'active' : ''}`} onClick={() => onChangeMode('code')}>代码</button>
        <button className={`workspace-tab ${mode === 'preview' ? 'active' : ''}`} onClick={() => onChangeMode('preview')}>预览</button></div>
      <div className="workspace-header-right">
        {mode === 'preview' && <button className="workspace-tool-btn" onClick={() => setPreviewKey(value => value + 1)} title="刷新页面">↻</button>}
        <button className="workspace-tool-btn" onClick={() => void download()} disabled={downloading || (!html && !file)} title="下载 HTML 文件" aria-label="下载 HTML 文件">↓</button>
        <button className="workspace-tool-btn close-btn" onClick={onClose} title="关闭工作区" aria-label="关闭工作区">×</button>
      </div>
    </div>
    <div className="workspace-body">
      {error ? <div className="preview-loading" role="status"><p>{error}</p><button type="button" onClick={onRetry}>重新加载</button></div>
        : isLoading && !html ? <p className="preview-loading" role="status">正在加载 HTML…</p>
          : mode === 'code' ? <Suspense fallback={<p className="preview-loading" role="status">正在加载代码预览…</p>}><CodePreview code={html} language="html" virtualized follow={isLoading} /></Suspense>
            : <div className="workspace-preview-container"><iframe ref={iframe} key={previewKey} title={title} srcDoc={html} className="workspace-iframe" sandbox="allow-scripts allow-popups" /></div>}
    </div>
  </div>;
}
