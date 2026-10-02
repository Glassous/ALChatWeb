import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import './InputArea.css';
import { documentFile, fileSize, type AttachmentDescriptor } from '../../services/attachments';
import { apiClient } from '../../services/api';
import { AnchoredPopover, useToast } from '../LayerSystem/LayerSystem';

interface InputAreaProps {
  onSend: (message: string, options?: { isImageMode: boolean; resolution: string; refImageUrl?: string; attachments?: AttachmentDescriptor[]; mode?: 'daily' | 'expert' | 'search' | 'hermes' | 'agent' }) => void;
  contextKey?: string | null;
  onUploadingChange?: (uploading: boolean) => void;
  onStopAgent?: () => void;
  agentCancelling?: boolean;
  disabled?: boolean;
  onScrollToBottom?: () => void;
  isAtBottom?: boolean;
  isEmpty?: boolean;
  userMessages?: string[];
  userCredits?: number | null;
  userMemberType?: string;
  onShowUpgrade?: () => void;
  style?: React.CSSProperties;
  isTemp?: boolean;
  onModeChange?: (mode: 'daily' | 'expert' | 'search' | 'hermes' | 'agent') => void;
  onImageModeChange?: (isImageMode: boolean) => void;
}

const RESOLUTIONS = [
  { label: '1:1', value: '2048x2048', ratio: 1 },
  { label: '4:3', value: '2304x1728', ratio: 4/3 },
  { label: '3:4', value: '1728x2304', ratio: 3/4 },
  { label: '16:9', value: '2560x1440', ratio: 16/9 },
  { label: '9:16', value: '1440x2560', ratio: 9/16 }
];

export function InputArea({ 
  onSend, 
  contextKey,
  onUploadingChange,
  disabled = false, 
  onScrollToBottom, 
  isAtBottom = true, 
  isEmpty = true,
  userMessages = [],
  userCredits = null,
  userMemberType = 'free',
  onShowUpgrade,
  style,
  isTemp = false,
  onModeChange,
  onImageModeChange,
  onStopAgent,
  agentCancelling = false
}: InputAreaProps) {
  const showToast = useToast();
  const [text, setText] = useState('');
  const [isImageMode, setIsImageMode] = useState(false);
  const [mode, setMode] = useState<'daily' | 'expert'>('daily');
  const [isSearch, setIsSearch] = useState(false);
  const [isHermes, setIsHermes] = useState(false);
  const [isAgent, setIsAgent] = useState(false);
  const [hermesAvailable, setHermesAvailable] = useState(false);

  useEffect(() => { if (!isTemp) apiClient.getHermes().then(v => setHermesAvailable(v.tested)).catch(() => setHermesAvailable(false)); }, [isTemp]);

  useEffect(() => {
    let currentEffectiveMode: 'daily' | 'expert' | 'search' | 'hermes' | 'agent' = isAgent && !isTemp ? 'agent' : isHermes ? 'hermes' : mode;
    if (!isAgent && mode === 'daily' && isSearch) {
      currentEffectiveMode = 'search';
    }
    onModeChange?.(currentEffectiveMode);
  }, [mode, isSearch, isHermes, isAgent, isTemp, onModeChange]);

  useEffect(() => {
    onImageModeChange?.(isImageMode);
  }, [isImageMode, onImageModeChange]);
  const [resolution, setResolution] = useState(RESOLUTIONS[0].value);
  const [showResolutions, setShowResolutions] = useState(false);
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDescriptor[]>([]);
  const [selectedAttachmentType, setSelectedAttachmentType] = useState<'image' | 'video' | 'document' | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  const [isExpanded, setIsExpanded] = useState(false);
  const [dragStatus, setDragStatus] = useState<'none' | 'supported' | 'unsupported'>('none');
  const [dragMessage, setDragMessage] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestion, setSuggestion] = useState('');
  const suggestionRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const uploadTicket = useRef(0);
  const uploadingNow = useRef(false);
  const refDescriptor = useRef<AttachmentDescriptor | null>(null);
  useEffect(() => { onUploadingChange?.(isUploading); }, [isUploading, onUploadingChange]);
  useEffect(() => {
    uploadTicket.current++;
    uploadingNow.current = false;
    setIsUploading(false); setAttachments([]); setRefImageUrl(null); setSelectedAttachmentType(null);
    setText(''); setSuggestion(''); setHistoryIndex(-1); setIsExpanded(false);
    if (textareaRef.current) textareaRef.current.style.height = '44px';
    refDescriptor.current = null;
    return () => { uploadTicket.current++; uploadingNow.current = false; };
  }, [contextKey]);
  useEffect(() => {
    if (isAgent) return;
    setAttachments(previous => previous.filter(item => item.type !== 'document'));
    setSelectedAttachmentType(null);
  }, [isAgent]);
  const leaveAgent = () => {
    if (attachments.some(item => item.type === 'document')) showToast({ tone: 'info', message: '已移除文档附件，文档仅限 Agent 模式' });
    setAttachments(previous => previous.filter(item => item.type !== 'document'));
    setIsAgent(false);
  };

  const handleModeSelect = (selected: 'expert' | 'image') => {
    if (disabled || isUploading) return;

    let targetExpert = false;
    let targetImage = false;

    if (selected === 'expert') {
      targetExpert = mode !== 'expert';
    } else if (selected === 'image') {
      targetImage = !isImageMode;
    }

    setMode(targetExpert ? 'expert' : 'daily');
    leaveAgent();
    setIsImageMode(targetImage);
    setIsSearch(false);

    if (targetImage) {
      setAttachments([]);
      setSelectedAttachmentType(null);
      refDescriptor.current = null;
      setRefImageUrl(null);
    }
  };

  // Parent updates must not clear a draft while files upload.
  const historyKey = JSON.stringify(userMessages);
  useEffect(() => {
    const messages: string[] = JSON.parse(historyKey);
    const filtered = messages.map(msg => msg.replace(/<(file|image|video)\s+src="[^"]*">/g, '').trim()).filter(Boolean);
    setHistory(filtered.reverse().slice(0, 50));
  }, [historyKey]);

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

  const handleSend = () => {
    if ((text.trim() || attachments.length > 0) && !disabled && !isUploading && !uploadingNow.current) {
      let finalMode: 'daily' | 'expert' | 'search' | 'hermes' | 'agent' = isAgent && !isTemp ? 'agent' : isHermes ? 'hermes' : mode;
      if (isImageMode) {
        finalMode = 'daily';
      } else if (!isAgent && mode === 'daily' && isSearch) {
        finalMode = 'search';
      }

      // Format attachments into message
      let finalMsg = text.trim();
      if (attachments.length > 0) {
        const attachmentTags = attachments.map(att => `<${att.type === 'image' ? 'image' : 'file'} src="${att.url}">`).join('\n');
        finalMsg = `${attachmentTags}\n${finalMsg}`;
      }

      onSend(finalMsg, { 
        isImageMode, 
        resolution, 
        refImageUrl: refImageUrl || undefined,
        attachments: refDescriptor.current ? [...attachments, refDescriptor.current] : attachments,
        mode: finalMode
      });
      
      // Update history
      const newHistory = text.trim() ? [text.trim(), ...history.filter(h => h !== text.trim())].slice(0, 50) : history;
      setHistory(newHistory);
      setHistoryIndex(-1);
      setSuggestion('');
      
      setText('');
      refDescriptor.current = null;
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

  const handleUploadClick = () => { if (!isTemp) fileInputRef.current?.click(); };
  const handleAttachmentClick = () => { if (!isTemp) setShowAttachmentMenu(value => !value); };
  const handleAttachmentTypeSelect = (type: 'image' | 'video' | 'document') => {
    if (!isAgent && attachments.some(item => item.type !== type)) {
      showToast({ tone: 'warning', message: '请先移除不同类型的附件' }); return;
    }
    setSelectedAttachmentType(type); setShowAttachmentMenu(false);
    setTimeout(() => attachmentInputRef.current?.click(), 0);
  };
  const uploadFiles = async (files: File[], reference = false) => {
    if (isTemp || disabled || uploadingNow.current || !files.length) return;
    const kinds = files.map(file => documentFile(file.name) ? 'document' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file');
    if (kinds.includes('file') || (!isAgent && kinds.includes('document'))) {
      showToast({ tone: 'warning', message: isAgent ? '仅支持图片、视频、PDF、DOCX、XLSX' : '普通模式仅支持图片或视频' }); return;
    }
    if (files.some((file, index) => kinds[index] === 'document' && file.size > 5 * 1024 * 1024)) {
      showToast({ tone: 'warning', message: '每个文档不能超过 5 MiB' }); return;
    }
    if ((isImageMode || reference) && (files.length !== 1 || kinds[0] !== 'image' || refImageUrl)) {
      showToast({ tone: 'warning', message: '图片生成模式只能上传一张图片' }); return;
    }
    if (!isAgent && !reference && new Set([...attachments.map(item => item.type), ...kinds]).size > 1) {
      showToast({ tone: 'warning', message: '普通模式不能混合图片和视频' }); return;
    }
    const ticket = ++uploadTicket.current;
    uploadingNow.current = true; setIsUploading(true);
    for (const file of files) {
      if (ticket !== uploadTicket.current) break;
      try {
        const item = await apiClient.uploadAttachment(file, isAgent);
        if (ticket !== uploadTicket.current) { void apiClient.deleteReferenceImage(item.url).catch(() => {}); break; }
        if (reference || isImageMode) { refDescriptor.current = item; setRefImageUrl(item.url); }
        else setAttachments(previous => [...previous, item]);
      } catch (error) {
        if (ticket === uploadTicket.current) showToast({ tone: 'error', message: error instanceof Error ? error.message : '上传失败，请重试' });
      }
    }
    if (ticket === uploadTicket.current) { uploadingNow.current = false; setIsUploading(false); }
  };
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await uploadFiles(Array.from(event.target.files || []), true); event.target.value = '';
  };
  const handleAttachmentFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await uploadFiles(Array.from(event.target.files || [])); event.target.value = '';
  };
  const removeRefImage = () => {
    if (refImageUrl) void apiClient.deleteReferenceImage(refImageUrl).catch(() => {});
    refDescriptor.current = null; setRefImageUrl(null);
  };
  const removeAttachment = (index: number) => {
    const item = attachments[index];
    setAttachments(previous => previous.filter(value => value.url !== item.url));
    void apiClient.deleteReferenceImage(item.url).catch(() => {});
  };
  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    if (isTemp || disabled || uploadingNow.current) return;
    setDragStatus('supported'); setDragMessage(isAgent ? '松手上传图片、视频或文档' : '松手上传图片或视频');
  };
  const handleDragLeave = (event: React.DragEvent) => { event.preventDefault(); setDragStatus('none'); setDragMessage(''); };
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault(); event.stopPropagation(); setDragStatus('none'); setDragMessage('');
    await uploadFiles(Array.from(event.dataTransfer.files));
  };
  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
    if (files.length) { event.preventDefault(); await uploadFiles(files); }
  };

  const isExhausted = userCredits !== null && userCredits <= 0;
  const warningThreshold = userMemberType === 'free' ? 50 : 100;
  const showWarning = userCredits !== null && userCredits > 0 && userCredits <= warningThreshold;

  return (
    <div className="input-area-wrapper" style={style}>
      {showWarning && (
        <div className="credit-warning-container">
          <div className="credit-warning-text">
            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
              <path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
            </svg>
            <span>额度即将耗尽 (剩余 {userCredits.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
          </div>
          <div className="upgrade-link" onClick={onShowUpgrade}>立即升级</div>
        </div>
      )}
      {isExhausted && (
        <div className="credit-warning-container exhausted">
          <div className="credit-warning-text">
            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
              <path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
            </svg>
            <span>今日额度已用完，请明天再来或升级会员</span>
          </div>
          <div className="upgrade-link" onClick={onShowUpgrade}>升级会员</div>
        </div>
      )}
      {(refImageUrl || attachments.length > 0 || isUploading) && !isExhausted && (
        <div className="previews-container">
          {refImageUrl && (
            <div className="ref-image-preview-card">
              <img 
                src={refImageUrl} 
                alt="Reference" 
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (refImageUrl && refImageUrl.includes('alchatfiles.fiacloud.top')) {
                    const fallback = refImageUrl.replace('alchatfiles.fiacloud.top', 'alchatfiles-1350226447.cos.ap-tokyo.myqcloud.com');
                    if (target.src !== fallback) {
                      target.src = fallback;
                    }
                  }
                }}
              />
              <button className="remove-ref-image" onClick={removeRefImage}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          )}
          {attachments.map((att, index) => (
            <div key={index} className="ref-image-preview-card" title={`${att.filename} · ${fileSize(att.size)}`}>
              {att.type === 'document' ? <div className="video-preview-placeholder" style={{fontSize: 10, padding: 4}}>{att.filename}</div> : att.type === 'image' ? (
                <img 
                  src={att.url} 
                  alt={`Attachment ${index}`} 
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    if (att.url && att.url.includes('alchatfiles.fiacloud.top')) {
                      const fallback = att.url.replace('alchatfiles.fiacloud.top', 'alchatfiles-1350226447.cos.ap-tokyo.myqcloud.com');
                      if (target.src !== fallback) {
                        target.src = fallback;
                      }
                    }
                  }}
                />
              ) : (
                <div className="video-preview-placeholder" title={`${att.filename} · ${fileSize(att.size)}`}>
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
      {!isExhausted && (
        <div 
          className={`input-container-square ${isExpanded ? 'expanded' : ''} ${dragStatus !== 'none' ? `dragging ${dragStatus}` : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
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
                onPaste={handlePaste}
                disabled={disabled}
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
            {dragStatus !== 'none' && (
              <div className={`drag-hint ${dragStatus}`}>
                {dragMessage}
              </div>
            )}
            {(text.trim() || attachments.length > 0) && (
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
                {!isAgent && !isHermes && !isTemp && !isImageMode && (
                  <div className="tool-slot">
                    <button 
                      className={`tool-btn mode-toggle-btn ${mode === 'expert' ? 'expert' : ''}`}
                      onClick={() => handleModeSelect('expert')}
                      title={mode === 'daily' ? '日常模式' : '专家模式'}
                      disabled={disabled || isUploading}
                    >
                      {mode === 'daily' ? '日常' : '专家'}
                    </button>
                  </div>
                )}
                {!isAgent && !isHermes && !isTemp && mode !== 'expert' && (
                  <div className="tool-slot">
                    <button 
                      className={`tool-btn image-mode-btn ${isImageMode ? 'active' : ''}`}
                      onClick={() => handleModeSelect('image')}
                      title="图片生成"
                      disabled={disabled || isUploading}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                        <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z"/>
                      </svg>
                    </button>
                  </div>
                )}
                {isImageMode && (
                  <div className="tool-slot image-tools-slot">
                    <div className="resolution-selector" ref={popupRef}>
                      <button 
                        className="resolution-btn"
                        onClick={() => setShowResolutions(!showResolutions)}
                        disabled={disabled || isUploading}
                      >
                        {resolution}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                          <path d="M7 10l5 5 5-5z" />
                        </svg>
                      </button>
                      <AnchoredPopover open={showResolutions} anchorRef={popupRef} onClose={() => setShowResolutions(false)}>
                          <motion.div 
                            className="resolution-popup"
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                          >
                            <div className="resolution-header">选择图片比例</div>
                            <div className="resolution-grid">
                              {RESOLUTIONS.map(res => {
                                const boxSize = 36;
                                const boxWidth = res.ratio >= 1 ? boxSize : boxSize * res.ratio;
                                const boxHeight = res.ratio <= 1 ? boxSize : boxSize / res.ratio;
                                const isActive = res.value === resolution;

                                return (
                                  <div 
                                    key={res.value} 
                                    className={`resolution-card ${isActive ? 'active' : ''}`}
                                    onClick={() => {
                                      setResolution(res.value);
                                      setShowResolutions(false);
                                    }}
                                  >
                                    <div className="resolution-illustration-box">
                                      <div 
                                        className="resolution-rect"
                                        style={{ 
                                          width: `${boxWidth}px`, 
                                          height: `${boxHeight}px` 
                                        }}
                                      />
                                    </div>
                                    <div className="resolution-info">
                                      <span className="resolution-value">{res.value}</span>
                                      <span className="resolution-ratio-hint">{res.label}</span>
                                    </div>
                                    <button className="resolution-select-tag">
                                      {isActive ? '已选' : '选择'}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                      </AnchoredPopover>
                    </div>
                    {!refImageUrl && !isUploading && (
                      <button 
                        className="tool-btn upload-btn"
                        onClick={handleUploadClick}
                        title="上传参考图"
                        style={{ marginLeft: 4 }}
                        disabled={disabled || isUploading}
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
                  </div>
                )}
                {!isAgent && !isTemp && hermesAvailable && !isImageMode && mode !== 'expert' && (
                  <div className="tool-slot">
                    <button className={`tool-btn hermes-mode-btn ${isHermes ? 'active' : ''}`} title="Hermes 模式" disabled={disabled || isUploading}
                      onClick={() => { setIsHermes(v => !v); setIsAgent(false); setIsSearch(false); setMode('daily'); setAttachments([]); setRefImageUrl(null); setSelectedAttachmentType(null); }}>
                      <img className="hermes-icon" src="/HermesAgent.png" alt="" /><span>Hermes</span>
                    </button>
                  </div>
                )}
                {!isHermes && !isTemp && <div className="tool-slot">
                  <button className={`tool-btn agent-mode-btn ${isAgent ? 'active' : ''}`} aria-pressed={isAgent} title="自主搜索与整理" disabled={disabled || isUploading}
                    onClick={() => { if (isAgent) leaveAgent(); else setIsAgent(true); setIsHermes(false); setIsSearch(false); setIsImageMode(false); setMode('daily'); setRefImageUrl(null); setShowAttachmentMenu(false); }}>Agent</button>
                </div>}
                {onStopAgent && <button type="button" className="tool-btn agent-stop-btn" onClick={onStopAgent} disabled={agentCancelling}
                  aria-label={agentCancelling ? '停止中' : '停止 Agent'} title={agentCancelling ? '停止中' : '停止 Agent'}>
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" /></svg>
                </button>}
            </div>
            <div className="tools-right">
              {!isHermes && <>
                {!isEmpty && !isAtBottom && (
                  <div className="tool-slot">
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
                  </div>
                )}
                {!isTemp && !isImageMode && (
                  <div className="tool-slot">
                    <div className="attachment-selector" ref={attachmentMenuRef}>
                      <button 
                        className="tool-btn attachment-btn"
                        onClick={handleAttachmentClick}
                        title="添加附件"
                        disabled={disabled || isUploading}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                          <path d="M720-330q0 104-73 177T470-80q-104 0-177-73t-73-177v-370q0-75 52.5-127.5T400-880q75 0 127.5 52.5T580-700v350q0 46-32 78t-78 32q-46 0-78-32t-32-78v-350h80v350q0 13 8.5 21.5T470-350q13 0 21.5-8.5T500-380v-320q0-42-29-71t-71-29q-42 0-71 29t-29 71v370q0 71 49.5 120.5T470-160q71 0 120.5-49.5T640-330v-370h80v370Z"/>
                        </svg>
                      </button>
                      <AnchoredPopover open={showAttachmentMenu} anchorRef={attachmentMenuRef} align="end" onClose={() => setShowAttachmentMenu(false)}>
                          <motion.div 
                            className="attachment-menu"
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                          >
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
                            {isAgent && <div className="attachment-menu-item" onClick={() => handleAttachmentTypeSelect('document')}>PDF / DOCX / XLSX · 5 MiB</div>}
                          </motion.div>
                      </AnchoredPopover>
                      <input 
                        type="file"
                        ref={attachmentInputRef}
                        onChange={handleAttachmentFileChange}
                        accept={selectedAttachmentType === 'document' ? '.pdf,.docx,.xlsx' : selectedAttachmentType === 'image' ? 'image/*' : 'video/*'}
                        multiple
                        style={{ display: 'none' }}
                      />
                    </div>
                  </div>
                )}
                <div className="tool-slot">
                  <button 
                    type="button"
                    className={`tool-btn expand-btn ${isExpanded ? 'active' : ''}`}
                    onClick={toggleExpand}
                    title={isExpanded ? "缩小输入框" : "放大输入框"}
                    disabled={disabled || isUploading}
                  >
                    {isExpanded ? (
                      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M240-120v-120H120v-80h200v200h-80Zm400 0v-200h200v80H720v120h-80ZM120-640v-80h120v-120h80v200H120Zm520 0v-200h80v120h120v80H640Z"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M120-120v-200h80v120h120v80H120Zm520 0v-80h120v-120h80v200H640ZM120-640v-200h200v80H200v120h-80Zm640 0v-120H640v-80h200v200h-80Z"/></svg>
                    )}
                  </button>
                </div>
              </>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
