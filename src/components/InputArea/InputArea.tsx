import { useState, useRef, useEffect } from 'react';
import './InputArea.css';

interface InputAreaProps {
  onSend: (message: string, options?: { isImageMode: boolean; resolution: string }) => void;
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
  const popupRef = useRef<HTMLDivElement>(null);

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
    if (text.trim() && !disabled) {
      onSend(text.trim(), { isImageMode, resolution });
      setText('');
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

  return (
    <div className="input-area-wrapper">
      <div className="input-container-square">
        <div className="input-top-row">
          <textarea
            className="chat-textarea"
            placeholder={isImageMode ? "描述你想生成的图片..." : "输入消息..."}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
          />
          <button 
            className="send-button" 
            onClick={handleSend}
            disabled={!text.trim() || disabled}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
