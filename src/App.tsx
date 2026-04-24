import { useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { ChatArea, type Message } from './components/ChatArea/ChatArea';
import { InputArea } from './components/InputArea/InputArea';
import './App.css';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);

  const [hasMessages, setHasMessages] = useState(false);

  const [isExiting, setIsExiting] = useState(false);

  const handleSend = (text: string) => {
    if (!hasMessages) {
      setIsExiting(true);
      setTimeout(() => {
        setHasMessages(true);
        setIsExiting(false);
      }, 400); // Match fadeOut duration
    }
    // Add user message
    const newUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    };
    
    setMessages((prev) => [...prev, newUserMsg]);

    // Simulate assistant reply
    setTimeout(() => {
      const newAssistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `This is a simulated reply to: "${text}"`,
      };
      setMessages((prev) => [...prev, newAssistantMsg]);
    }, 1000);
  };

  const handleNewChat = () => {
    setMessages([]);
    setHasMessages(false);
  };

  return (
    <div className="app-container">
      <Sidebar onNewChat={handleNewChat} />
      <div className="main-content">
        <TopBar />
        <div className="chat-container">
          {!hasMessages ? (
            <div key="empty-state" className={`empty-state-container ${isExiting ? 'fade-out' : ''}`}>
              <div className="empty-greeting">
                <img src="/AL_Logo.svg" alt="AL Logo" className="empty-logo" />
                <h2>Hello, how can I help you today?</h2>
              </div>
            </div>
          ) : (
            <div key="chat-content" className="chat-area-wrapper">
              <ChatArea messages={messages} />
            </div>
          )}
          <InputArea onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}

export default App;
