import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ChatArea.css';

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  status?: 'pending' | 'loading' | 'completed' | 'error';
  metadata?: {
    resolution?: string;
  };
}

interface ChatAreaProps {
  messages: Message[];
}

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/></svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>
);

function MessageItem({ msg, onImageClick }: { msg: Message; onImageClick: (url: string) => void }) {
  const [copied, setCopied] = useState(false);

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

    const processedContent = msg.content.replace(/<image src="([^"]+)">/g, '![generated-image]($1)');

    return (
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
    );
  };

  const isPureImage = msg.content.trim().startsWith('<image') && msg.content.replace(/<image src="[^"]+">/g, '').trim() === '';

  return (
    <div className={`message-wrapper ${msg.role}`}>
      <div className="message-container">
        {msg.role === 'user' ? (
          <>
            <div className="message-bubble user-bubble">
              {msg.content.includes('<image') ? (
                <div className="user-message-with-image">
                  {(() => {
                    const re = /<image src="([^"]+)">/;
                    const match = msg.content.match(re);
                    if (match) {
                      const imageUrl = match[1];
                      const textContent = msg.content.replace(re, '').trim();
                      return (
                        <>
                          <div className="user-ref-image-card" onClick={() => onImageClick(imageUrl)}>
                            <img src={imageUrl} alt="Reference" />
                          </div>
                          {textContent && <div className="user-message-text">{textContent}</div>}
                        </>
                      );
                    }
                    return msg.content;
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

export function ChatArea({ messages }: ChatAreaProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
    <div className="chat-area">
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
}
