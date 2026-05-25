import React, { useState, useEffect } from 'react';
import './Workspace.css';

interface WorkspaceProps {
  html: string;
  mode: 'code' | 'preview';
  onChangeMode: (mode: 'code' | 'preview') => void;
  onClose: () => void;
  title: string;
}

export const Workspace: React.FC<WorkspaceProps> = ({
  html,
  mode,
  onChangeMode,
  onClose,
  title,
}) => {
  const [localHtml, setLocalHtml] = useState(html);
  const [previewKey, setPreviewKey] = useState(0); // For forcing iframe reload

  // Sync state when external HTML changes (e.g. streaming update)
  useEffect(() => {
    setLocalHtml(html);
  }, [html]);

  const handleDownload = () => {
    const blob = new Blob([localHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'workspace_page'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRefresh = () => {
    setPreviewKey((prev) => prev + 1);
  };

  // Generate line numbers for the code block textarea
  const lineNumbers = localHtml.split('\n').map((_, index) => index + 1).join('\n');

  return (
    <div className="workspace-panel">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div className="workspace-header-left">
          <div className="workspace-tabs">
            <button
              className={`workspace-tab ${mode === 'code' ? 'active' : ''}`}
              onClick={() => onChangeMode('code')}
            >
              代码
            </button>
            <button
              className={`workspace-tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => onChangeMode('preview')}
            >
              预览
            </button>
          </div>
        </div>

        <div className="workspace-header-right">
          {mode === 'preview' && (
            <button className="workspace-tool-btn" onClick={handleRefresh} title="刷新页面">
              <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/>
              </svg>
            </button>
          )}
          <button className="workspace-tool-btn" onClick={handleDownload} title="下载代码文件">
            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
              <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
            </svg>
          </button>
          <button className="workspace-tool-btn close-btn" onClick={onClose} title="关闭工作区">
            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Workspace Content */}
      <div className="workspace-body">
        {mode === 'code' ? (
          <div className="workspace-editor-container">
            <pre className="workspace-line-numbers">{lineNumbers}</pre>
            <textarea
              className="workspace-textarea"
              value={localHtml}
              readOnly={true}
              placeholder="在这里查看 HTML 代码..."
              spellCheck="false"
            />
          </div>
        ) : (
          <div className="workspace-preview-container">
            <iframe
              key={previewKey}
              title="workspace-html-preview"
              srcDoc={localHtml}
              className="workspace-iframe"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </div>
        )}
      </div>
    </div>
  );
};
