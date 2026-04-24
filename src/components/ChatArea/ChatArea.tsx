import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ChatArea.css';

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
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

function MessageItem({ msg }: { msg: Message }) {
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

  return (
    <div className={`message-wrapper ${msg.role}`}>
      <div className="message-container">
        {msg.role === 'user' ? (
          <>
            <div className="message-bubble user-bubble">
              {msg.content}
            </div>
            <button 
              className={`copy-button ${copied ? 'copied' : ''}`} 
              onClick={handleCopy}
              title="复制消息"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </>
        ) : (
          <div className="assistant-message-content">
            <div className="message-text assistant-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            </div>
            <div className="assistant-actions">
              <button 
                className={`action-button copy-action ${copied ? 'copied' : ''}`} 
                onClick={handleCopy}
                title="复制消息"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatArea({ messages }: ChatAreaProps) {
  return (
    <div className="chat-area">
      <div className="chat-content">
        {messages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} />
        ))}
      </div>
    </div>
  );
}
