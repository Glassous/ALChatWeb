import { useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { ChatArea, type Message } from './components/ChatArea/ChatArea';
import { InputArea } from './components/InputArea/InputArea';
import './App.css';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);

  const handleSend = (text: string) => {
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
  };

  return (
    <div className="app-container">
      <Sidebar onNewChat={handleNewChat} />
      <div className="main-content">
        <TopBar />
        <div className="chat-container">
          <ChatArea messages={messages} />
          <InputArea onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}

export default App;
