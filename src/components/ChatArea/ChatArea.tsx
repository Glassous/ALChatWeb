import { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type SearchData } from '../SearchSidebar/SearchSidebar';
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
  onScrollStateChange?: (isAtBottom: boolean) => void;
  onShowSearch?: (data: SearchData) => void;
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

function MessageItem({ 
  msg, 
  onImageClick, 
  onShowSearch 
}: { 
  msg: Message; 
  onImageClick: (url: string) => void;
  onShowSearch?: (data: SearchData) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isManual, setIsManual] = useState(false);
  const [isUserCollapsed, setIsUserCollapsed] = useState(true);
  const [showExpandButton, setShowExpandButton] = useState(false);
  const userBubbleRef = useRef<HTMLDivElement>(null);

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
      setIsCollapsed(false); // Expand while reasoning
    } else if (msg.reasoning && msg.content) {
      setIsCollapsed(true); // Collapse when main content starts
    }
  }, [msg.reasoning, !!msg.content, isManual]);

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
      .replace(/\n?<search>[\s\S]*?<\/search>\n?/g, '') // Remove completed search tag and surrounding newlines
      .replace(/\n?<search>[\s\S]*/g, '') // Remove partial search tag during streaming and leading newline
      .replace(/(?:ref\((\d+)\)|\[(\d+)\]|【(\d+)】)/g, (_, g1, g2, g3) => `[${g1 || g2 || g3}](ref:${g1 || g2 || g3})`);

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

    const markdownComponents = {
      img: ({ src, alt }: { src?: string, alt?: string }) => (
        <span className="image-container-msg">
          <img 
            src={src} 
            alt={alt || "Generated"} 
            className="generated-image" 
            onClick={() => onImageClick(src!)}
          />
        </span>
      ),
      a: ({ href, children }: { href?: string, children: React.ReactNode }) => {
        const isRef = href?.startsWith('ref:');
        const childrenText = typeof children === 'string' ? children : '';
        const isNumericLink = /^\d+$/.test(childrenText);
        
        if (isRef || isNumericLink) {
          const indexStr = isRef ? href.split(':')[1] : childrenText;
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
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
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

export const ChatArea = forwardRef<ChatAreaHandle, ChatAreaProps>(({ messages, onScrollStateChange, onShowSearch }, ref) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabledRef = useRef(true);
  const prevMessagesLengthRef = useRef(messages.length);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // We consider it near bottom if within 150px
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
    isAutoScrollEnabledRef.current = isNearBottom;
    onScrollStateChange?.(isNearBottom);
  }, [onScrollStateChange]);

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
    const isNewMessage = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    // If it's a completely new message (user sent it or assistant just replied),
    // we should force auto-scroll
    if (isNewMessage) {
      isAutoScrollEnabledRef.current = true;
      // Use smooth for new messages
      scrollToBottom('smooth');
    } else if (isAutoScrollEnabledRef.current) {
      // Use auto (instant) for streaming to avoid jitter and interrupted smooth scrolling
      scrollToBottom('auto');
    }
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
    <div className="chat-area" ref={scrollRef} onScroll={handleScroll}>
      <div className="chat-content">
        {messages.map((msg) => (
          <MessageItem 
            key={msg.id} 
            msg={msg} 
            onImageClick={setPreviewUrl} 
            onShowSearch={onShowSearch}
          />
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
