import { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ChatArea.css';

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
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
  };
}


interface ChatAreaProps {
  messages: Message[];
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

function MessageItem({ msg, onImageClick }: { msg: Message; onImageClick: (url: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isManual, setIsManual] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Auto-collapse logic
  useEffect(() => {
    if (isManual) return;

    if (msg.reasoning && !msg.content) {
      setIsCollapsed(false); // Expand while reasoning
    } else if (msg.reasoning && msg.content) {
      setIsCollapsed(true); // Collapse when main content starts
    }
  }, [msg.reasoning, !!msg.content, isManual]);

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
    if (msg.status === 'loading' && msg.metadata?.resolution) {
      const [width, height] = msg.metadata.resolution.split('x').map(Number);
      const aspectRatio = width / height;
      
      return (
        <div 
          className="image-loading-placeholder" 
          style={{ aspectRatio: `${aspectRatio}` }}
        >
          <div className="loading-spinner-container">
            <div className="loading-spinner"></div>
            <span>正在生成图片...</span>
          </div>
        </div>
      );
    }

    const processedContent = msg.content
      .replace(/<image src="([^"]+)">/g, '![generated-image]($1)')
      .replace(/<search>[\s\S]*?<\/search>/g, ''); // Remove search tag from markdown content

    return (
      <>
        {msg.search && (
          <div 
            className={`search-container ${msg.search.status === 'completed' ? 'completed' : ''}`}
            onClick={() => msg.search?.status === 'completed' && setShowSearchModal(true)}
          >
            <div className="search-status-icon">
              {msg.search.status === 'searching' ? (
                <div className="search-spinner"></div>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              )}
            </div>
            <div className="search-info">
              <span className="search-text">
                {msg.search.status === 'searching' ? `正在搜索: ${msg.search.query}` : `已找到 ${msg.search.results?.length || 0} 条相关结果`}
              </span>
            </div>
            {msg.search.status === 'completed' && (
              <div className="search-view-more">
                查看来源
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </div>
            )}
          </div>
        )}
        {showSearchModal && msg.search?.results && (
          <div className="search-modal-overlay" onClick={() => setShowSearchModal(false)}>
            <div className="search-modal" onClick={e => e.stopPropagation()}>
              <div className="search-modal-header">
                <h3>搜索结果: {msg.search.query}</h3>
                <button className="close-modal-btn" onClick={() => setShowSearchModal(false)}>
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
              <div className="search-results-list">
                {msg.search.results.map((result, idx) => (
                  <a 
                    key={idx} 
                    href={result.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="search-result-item"
                  >
                    <div className="result-index">{idx + 1}</div>
                    <div className="result-content">
                      <div className="result-title">{result.title}</div>
                      <div className="result-url">{result.url}</div>
                      <div className="result-snippet">{result.snippet}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
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
                      components={{
                        img: ({ src, alt }) => (
                                <span className="image-container-msg">
                                  <img 
                                    src={src} 
                                    alt={alt || "Generated"} 
                                    className="generated-image" 
                                    onClick={() => onImageClick(src!)}
                                  />
                                </span>
                              )
                      }}
                    >
                      {msg.reasoning}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ src, alt }) => (
                    <span className="image-container-msg">
                      <img 
                        src={src} 
                        alt={alt || "Generated"} 
                        className="generated-image" 
                        onClick={() => onImageClick(src!)}
                      />
                    </span>
                  )
          }}
        >
          {processedContent}
        </ReactMarkdown>
      </>
    );
  };

  const isPureImage = msg.content.trim().startsWith('<image') && msg.content.replace(/<image src="[^"]+">/g, '').trim() === '';

  return (
    <div className={`message-wrapper ${msg.role}`}>
      <div className="message-container">
        {msg.role === 'user' ? (
          <>
            <div className="message-bubble user-bubble">
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
                            {images.map((url, idx) => (
                              <div key={idx} className="user-ref-image-card" onClick={() => onImageClick(url)}>
                                <img src={url} alt={`Reference ${idx}`} />
                              </div>
                            ))}
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
            </div>
            {!isPureImage && (
              <button 
                className={`copy-button ${copied ? 'copied' : ''}`} 
                onClick={handleCopy}
                title="复制消息"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            )}
          </>
        ) : (
          <div className="assistant-message-content">
            <div className="message-text assistant-text">
              {renderContent()}
            </div>
            {!isPureImage && (
              <div className="assistant-actions">
                <button 
                  className={`action-button copy-action ${copied ? 'copied' : ''}`} 
                  onClick={handleCopy}
                  title="复制消息"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatArea = forwardRef<ChatAreaHandle, ChatAreaProps>(({ messages }, ref) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToBottom
  }));

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
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

  return (
    <div className="chat-area" ref={scrollRef}>
      <div className="chat-content">
        {messages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} onImageClick={setPreviewUrl} />
        ))}
      </div>

      {previewUrl && (
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
            <img src={previewUrl} alt="Preview" className="preview-image" />
          </div>
        </div>
      )}
    </div>
  );
});
