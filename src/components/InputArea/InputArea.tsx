import { useState, useRef, useEffect } from 'react';
import './InputArea.css';
import { apiClient } from '../../services/api';

interface InputAreaProps {
  onSend: (message: string, options?: { isImageMode: boolean; resolution: string; refImageUrl?: string; mode?: 'daily' | 'expert' | 'search' }) => void;
  disabled?: boolean;
  onScrollToBottom?: () => void;
  isAtBottom?: boolean;
  isEmpty?: boolean;
  userMessages?: string[];
}

const RESOLUTIONS = [
  '2048x2048',
  '2304x1728',
  '1728x2304',
  '2560x1440',
  '1440x2560'
];

export function InputArea({ 
  onSend, 
  disabled = false, 
  onScrollToBottom, 
  isAtBottom = true, 
  isEmpty = true,
  userMessages = []
}: InputAreaProps) {
  const [text, setText] = useState('');
  const [isImageMode, setIsImageMode] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [mode, setMode] = useState<'daily' | 'expert'>('daily');
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [showResolutions, setShowResolutions] = useState(false);
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachments, setAttachments] = useState<Array<{url: string, type: 'image' | 'video'}>>([]);
  const [selectedAttachmentType, setSelectedAttachmentType] = useState<'image' | 'video' | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestion, setSuggestion] = useState('');
  const suggestionRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync history with userMessages from props
  useEffect(() => {
    // When userMessages changes (switching conversation or new message),
    // we should reset the current input and suggestion state if it was from history
    setSuggestion('');
    setHistoryIndex(-1);
    setText('');
    setIsExpanded(false);
    // CRITICAL: Clear memory history when conversation changes
    setHistory([]);
    
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }

    if (userMessages.length > 0) {
      // Filter out media tags like <file src="..."> or <image src="..."> and trim
      const filteredMessages = userMessages.map(msg => 
        msg.replace(/<(file|image|video)\s+src="[^"]*">/g, '').trim()
      ).filter(msg => msg.length > 0);

      setHistory([...filteredMessages].reverse().slice(0, 50));
    }
  }, [userMessages]);

  // Sync textarea height with suggestion when text is empty
  useEffect(() => {
    if (suggestion && text === '' && textareaRef.current) {
      // Create a temporary hidden div to measure the suggestion height accurately
      const tempDiv = document.createElement('div');
      const styles = window.getComputedStyle(textareaRef.current);
      
      // Copy essential styles for measurement
      tempDiv.style.width = styles.width;
      tempDiv.style.fontFamily = styles.fontFamily;
      tempDiv.style.fontSize = styles.fontSize;
      tempDiv.style.lineHeight = styles.lineHeight;
      tempDiv.style.padding = styles.padding;
      tempDiv.style.border = styles.border;
      tempDiv.style.boxSizing = styles.boxSizing;
      tempDiv.style.whiteSpace = 'pre-wrap';
      tempDiv.style.wordBreak = 'break-word';
      tempDiv.style.position = 'absolute';
      tempDiv.style.visibility = 'hidden';
      tempDiv.style.height = 'auto';
      
      tempDiv.textContent = suggestion;
      document.body.appendChild(tempDiv);
      
      const targetHeight = tempDiv.scrollHeight;
      document.body.removeChild(tempDiv);

      if (!isExpanded) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(targetHeight, 150)}px`;
      }
    } else if (!suggestion && text === '' && textareaRef.current && !isExpanded) {
      textareaRef.current.style.height = '44px';
    }
  }, [suggestion, text, isExpanded]);

  // Sync scroll between textarea and suggestion overlay
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (suggestionRef.current) {
      suggestionRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setShowResolutions(false);
      }
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSend = () => {
    if (text.trim() && !disabled && !isUploading) {
      let finalMode: 'daily' | 'expert' | 'search' = mode;
      if (isImageMode) {
        finalMode = 'daily';
      } else if (isSearchMode) {
        finalMode = 'search';
      }

      // Format attachments into message
      let finalMsg = text.trim();
      if (attachments.length > 0) {
        const attachmentTags = attachments.map(att => `<file src="${att.url}">`).join('\n');
        finalMsg = `${attachmentTags}\n${finalMsg}`;
      }

      onSend(finalMsg, { 
        isImageMode, 
        resolution, 
        refImageUrl: refImageUrl || undefined,
        mode: finalMode
      });
      
      // Update history
      const newHistory = [text.trim(), ...history.filter(h => h !== text.trim())].slice(0, 50);
      setHistory(newHistory);
      setHistoryIndex(-1);
      setSuggestion('');
      
      setText('');
      setRefImageUrl(null);
      setAttachments([]);
      setSelectedAttachmentType(null);
      setIsExpanded(false);
      if (textareaRef.current) {
        // For smooth shrinking after send, we set a small height
        // The CSS transition will handle the animation
        textareaRef.current.style.height = '44px'; // Base height for 1 row
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (text.length === 0) {
      if (e.key === 'ArrowUp') {
        if (history.length > 0) {
          e.preventDefault();
          const nextIndex = Math.min(historyIndex + 1, history.length - 1);
          setHistoryIndex(nextIndex);
          setSuggestion(history[nextIndex]);
        }
      } else if (e.key === 'ArrowDown') {
        if (historyIndex >= 0) {
          e.preventDefault();
          const nextIndex = historyIndex - 1;
          setHistoryIndex(nextIndex);
          if (nextIndex === -1) {
            setSuggestion('');
          } else {
            setSuggestion(history[nextIndex]);
          }
        }
      } else if (e.key === 'Tab' && suggestion) {
        e.preventDefault();
        setText(suggestion);
        setSuggestion('');
        setHistoryIndex(-1);
      }
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    
    // Always reset history navigation when typing or clearing
    if (suggestion || historyIndex !== -1) {
      setSuggestion('');
      setHistoryIndex(-1);
    }

    if (!isExpanded) {
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
    }
  };

  const toggleExpand = () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    if (textareaRef.current) {
      if (nextState) {
        textareaRef.current.style.height = '400px';
      } else {
        // Calculate the height needed for content (clamped to default max 150px)
        // We temporarily set height to 'auto' to get an accurate scrollHeight measurement
        const currentHeight = textareaRef.current.style.height;
        textareaRef.current.style.height = 'auto';
        const targetHeight = Math.min(textareaRef.current.scrollHeight, 150);
        // Restore current height immediately to allow transition to start from there
        textareaRef.current.style.height = currentHeight;
        
        // Use requestAnimationFrame to ensure the browser registers the current height
        // before we set the target height for the transition
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = `${targetHeight}px`;
          }
        });
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleAttachmentClick = () => {
    if (selectedAttachmentType) {
      attachmentInputRef.current?.click();
    } else {
      setShowAttachmentMenu(!showAttachmentMenu);
    }
  };

  const handleAttachmentTypeSelect = (type: 'image' | 'video') => {
    setSelectedAttachmentType(type);
    setShowAttachmentMenu(false);
    setTimeout(() => {
      attachmentInputRef.current?.click();
    }, 0);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const url = await apiClient.uploadReferenceImage(file);
      setRefImageUrl(url);
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('上传图片失败，请重试');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAttachmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const newAttachments = [...attachments];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const url = await apiClient.uploadReferenceImage(file);
        newAttachments.push({ url, type: selectedAttachmentType! });
      }
      setAttachments(newAttachments);
    } catch (error) {
      console.error('Failed to upload file:', error);
      alert('上传文件失败，请重试');
    } finally {
      setIsUploading(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  const removeRefImage = async () => {
    if (refImageUrl) {
      try {
        await apiClient.deleteReferenceImage(refImageUrl);
      } catch (error) {
        console.error('Failed to delete image from OSS:', error);
      }
    }
    setRefImageUrl(null);
  };

  const removeAttachment = async (index: number) => {
    const att = attachments[index];
    try {
      await apiClient.deleteReferenceImage(att.url);
    } catch (error) {
      console.error('Failed to delete file from OSS:', error);
    }
    const newAttachments = [...attachments];
    newAttachments.splice(index, 1);
    setAttachments(newAttachments);
    if (newAttachments.length === 0) {
      setSelectedAttachmentType(null);
    }
  };

  return (
    <div className="input-area-wrapper">
      {(refImageUrl || attachments.length > 0 || isUploading) && (
        <div className="previews-container">
          {refImageUrl && (
            <div className="ref-image-preview-card">
              <img src={refImageUrl} alt="Reference" />
              <button className="remove-ref-image" onClick={removeRefImage}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          )}
          {attachments.map((att, index) => (
            <div key={index} className="ref-image-preview-card">
              {att.type === 'image' ? (
                <img src={att.url} alt={`Attachment ${index}`} />
              ) : (
                <div className="video-preview-placeholder">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                    <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09s-.03 1.29-.1 2.09c-.06.8-.15 1.43-.28 1.9-.13.47-.4.83-.8 1.08-.4.25-.97.43-1.7.54-1 .16-2.23.23-3.69.23-1.47 0-2.7-.07-3.69-.23-.74-.11-1.3-.29-1.7-.54-.4-.25-.67-.61-.8-1.08-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09s.03-1.29.1-2.09c.06-.8.15-1.43.28-1.9.13-.46.4-.82.8-1.07.4-.25.97-.43 1.7-.54 1-.16 2.23-.23 3.69-.23 1.47 0 2.7.07 3.69.23.74.11 1.3.29 1.7.54.4.25.67.61.8 1.07z" />
                  </svg>
                </div>
              )}
              <button className="remove-ref-image" onClick={() => removeAttachment(index)}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          ))}
          {isUploading && (
            <div className="ref-image-preview-card uploading">
              <div className="upload-spinner"></div>
              <span>上传中...</span>
            </div>
          )}
        </div>
      )}
      <div className={`input-container-square ${isExpanded ? 'expanded' : ''}`}>
        <div className="input-top-row">
          <div className="textarea-wrapper">
            {suggestion && (
              <div ref={suggestionRef} className="input-suggestion-overlay">
                {suggestion}
              </div>
            )}
            <textarea
              className="chat-textarea"
              placeholder={suggestion ? "" : (isImageMode ? "描述你想生成的图片..." : "输入消息...")}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              disabled={disabled || isUploading}
              rows={1}
              ref={textareaRef}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {suggestion && (
            <div className="tab-hint">
              按 Tab 插入
            </div>
          )}
          {text.trim() && (
            <button 
              className="send-button" 
              onClick={handleSend}
              disabled={disabled || isUploading}
            >
              <svg viewBox="0 0 24 24" className="send-icon">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor" />
              </svg>
            </button>
          )}
        </div>
        <div className="input-bottom-row">
          <div className="tools-left">
            {!isImageMode && !isSearchMode && attachments.length === 0 && (
              <button 
                className={`tool-btn mode-toggle-btn ${mode === 'expert' ? 'expert' : ''}`}
                onClick={() => setMode(mode === 'daily' ? 'expert' : 'daily')}
                title={mode === 'daily' ? '日常模式' : '专家模式'}
              >
                {mode === 'daily' ? '日常' : '专家'}
              </button>
            )}
            {!isSearchMode && attachments.length === 0 && (
              <button 
                className={`tool-btn image-mode-btn ${isImageMode ? 'active' : ''}`}
                onClick={() => {
                  setIsImageMode(!isImageMode);
                  if (!isImageMode) setIsSearchMode(false);
                }}
                title="图片生成"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                  <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z"/>
                </svg>
              </button>
            )}
            {!isImageMode && attachments.length === 0 && (
              <button 
                className={`tool-btn search-toggle-btn ${isSearchMode ? 'active' : ''}`}
                onClick={() => setIsSearchMode(!isSearchMode)}
                title="联网搜索"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                  <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/>
                </svg>
              </button>
            )}
            {isImageMode && (
              <>
                <div className="resolution-selector" ref={popupRef}>
                  <button 
                    className="resolution-btn"
                    onClick={() => setShowResolutions(!showResolutions)}
                  >
                    {resolution}
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7 10l5 5 5-5z" />
                    </svg>
                  </button>
                  {showResolutions && (
                    <div className="resolution-popup">
                      {RESOLUTIONS.map(res => (
                        <div 
                          key={res} 
                          className={`resolution-item ${res === resolution ? 'active' : ''}`}
                          onClick={() => {
                            setResolution(res);
                            setShowResolutions(false);
                          }}
                        >
                          {res}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {!refImageUrl && !isUploading && (
                  <button 
                    className="tool-btn upload-btn"
                    onClick={handleUploadClick}
                    title="上传参考图"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                      <path d="M440-440ZM120-120q-33 0-56.5-23.5T40-200v-480q0-33 23.5-56.5T120-760h126l74-80h240v80H355l-73 80H120v480h640v-360h80v360q0 33-23.5 56.5T760-120H120Zm640-560v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80ZM440-260q75 0 127.5-52.5T620-440q0-75-52.5-127.5T440-620q-75 0-127.5 52.5T260-440q0 75 52.5 127.5T440-260Zm0-80q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29Z"/>
                    </svg>
                  </button>
                )}
                <input 
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  style={{ display: 'none' }}
                />
              </>
            )}
          </div>
          <div className="tools-right">
            {!isEmpty && !isAtBottom && (
              <button 
                type="button"
                className="tool-btn scroll-bottom-btn"
                onClick={onScrollToBottom}
                title="回到底部"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                  <path d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z"/>
                </svg>
              </button>
            )}
            {!isImageMode && !isSearchMode && (
              <div className="attachment-selector" ref={attachmentMenuRef}>
                <button 
                  className="tool-btn attachment-btn"
                  onClick={handleAttachmentClick}
                  title="添加附件"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                    <path d="M720-330q0 104-73 177T470-80q-104 0-177-73t-73-177v-370q0-75 52.5-127.5T400-880q75 0 127.5 52.5T580-700v350q0 46-32 78t-78 32q-46 0-78-32t-32-78v-350h80v350q0 13 8.5 21.5T470-350q13 0 21.5-8.5T500-380v-320q0-42-29-71t-71-29q-42 0-71 29t-29 71v370q0 71 49.5 120.5T470-160q71 0 120.5-49.5T640-330v-370h80v370Z"/>
                  </svg>
                </button>
                {showAttachmentMenu && (
                  <div className="attachment-menu">
                    <div className="attachment-menu-item" onClick={() => handleAttachmentTypeSelect('image')}>
                      <svg viewBox="0 -960 960 960" width="20" height="20" fill="currentColor">
                        <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z"/>
                      </svg>
                      <span>图片</span>
                    </div>
                    <div className="attachment-menu-item" onClick={() => handleAttachmentTypeSelect('video')}>
                      <svg viewBox="0 -960 960 960" width="20" height="20" fill="currentColor">
                        <path d="m380-380 280-100-280-100v200Zm0 180q-108 0-184-76t-76-184q0-108 76-184t184-76q108 0 184 76t76 184q0 108-76 184t-184 76Zm0-80q75 0 127.5-52.5T560-440q0-75-52.5-127.5T380-620q-75 0-127.5 52.5T200-440q0 75 52.5 127.5T380-280Zm0-160Z"/>
                      </svg>
                      <span>视频</span>
                    </div>
                  </div>
                )}
                <input 
                  type="file"
                  ref={attachmentInputRef}
                  onChange={handleAttachmentFileChange}
                  accept={selectedAttachmentType === 'image' ? 'image/*' : 'video/*'}
                  multiple
                  style={{ display: 'none' }}
                />
              </div>
            )}
            <button 
              type="button"
              className={`tool-btn expand-btn ${isExpanded ? 'active' : ''}`}
              onClick={toggleExpand}
              title={isExpanded ? "缩小输入框" : "放大输入框"}
            >
              {isExpanded ? (
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M240-120v-120H120v-80h200v200h-80Zm400 0v-200h200v80H720v120h-80ZM120-640v-80h120v-120h80v200H120Zm520 0v-200h80v120h120v80H640Z"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M120-120v-200h80v120h120v80H120Zm520 0v-80h120v-120h80v200H640ZM120-640v-200h200v80H200v120h-80Zm640 0v-120H640v-80h200v200h-80Z"/></svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
