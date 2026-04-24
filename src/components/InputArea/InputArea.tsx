import { useState, useRef, useEffect } from 'react';
import './InputArea.css';
import { apiClient } from '../../services/api';

interface InputAreaProps {
  onSend: (message: string, options?: { isImageMode: boolean; resolution: string; refImageUrl?: string }) => void;
  disabled?: boolean;
}

const RESOLUTIONS = [
  '2048x2048',
  '2304x1728',
  '1728x2304',
  '2560x1440',
  '1440x2560'
];

export function InputArea({ onSend, disabled = false }: InputAreaProps) {
  const [text, setText] = useState('');
  const [isImageMode, setIsImageMode] = useState(false);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [showResolutions, setShowResolutions] = useState(false);
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setShowResolutions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSend = () => {
    if (text.trim() && !disabled && !isUploading) {
      onSend(text.trim(), { 
        isImageMode, 
        resolution, 
        refImageUrl: refImageUrl || undefined 
      });
      setText('');
      setRefImageUrl(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
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

  return (
    <div className="input-area-wrapper">
      <div className="input-container-square">
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
        {isUploading && (
          <div className="ref-image-preview-card uploading">
            <div className="upload-spinner"></div>
            <span>上传中...</span>
          </div>
        )}
        <div className="input-top-row">
          <textarea
            className="chat-textarea"
            placeholder={isImageMode ? "描述你想生成的图片..." : "输入消息..."}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled || isUploading}
            rows={1}
          />
          <button 
            className="send-button" 
            onClick={handleSend}
            disabled={!text.trim() || disabled || isUploading}
          >
            <svg viewBox="0 0 24 24" className="send-icon">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div className="input-bottom-row">
          <div className="tools-left">
            <button 
              className={`tool-btn ${isImageMode ? 'active' : ''}`}
              onClick={() => setIsImageMode(!isImageMode)}
              title="图片生成"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3">
                <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z"/>
              </svg>
            </button>
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
                <button 
                  className="tool-btn upload-btn"
                  onClick={handleUploadClick}
                  disabled={isUploading || !!refImageUrl}
                  title="上传参考图"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3">
                    <path d="M440-440ZM120-120q-33 0-56.5-23.5T40-200v-480q0-33 23.5-56.5T120-760h126l74-80h240v80H355l-73 80H120v480h640v-360h80v360q0 33-23.5 56.5T760-120H120Zm640-560v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80ZM440-260q75 0 127.5-52.5T620-440q0-75-52.5-127.5T440-620q-75 0-127.5 52.5T260-440q0 75 52.5 127.5T440-260Zm0-80q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29Z"/>
                  </svg>
                </button>
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
        </div>
      </div>
    </div>
  );
}
