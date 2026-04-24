import { useState } from 'react';
import './InputArea.css';

interface InputAreaProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function InputArea({ onSend, disabled = false }: InputAreaProps) {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (text.trim() && !disabled) {
      onSend(text.trim());
      setText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="input-area-wrapper">
      <div className="input-container">
        <input
          type="text"
          className="chat-input"
          placeholder="输入消息..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
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
    </div>
  );
}
