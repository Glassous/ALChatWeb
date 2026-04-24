import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { ChatArea, type Message } from './components/ChatArea/ChatArea';
import { InputArea } from './components/InputArea/InputArea';
import { apiClient, type Conversation } from './services/api';
import { Welcome } from './pages/Welcome';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ResetPassword } from './pages/ResetPassword';
import './App.css';

// Protected Route component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/welcome" replace />;
  }
  return children;
}

// Chat Application component
function ChatApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [hasMessages, setHasMessages] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const convs = await apiClient.getConversations();
      setConversations(convs || []); // Ensure it's always an array
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setConversations([]); // Set empty array on error
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const conv = await apiClient.getConversation(conversationId);
      const messages = Array.isArray(conv.messages) ? conv.messages : [];
      setMessages(messages);
      setCurrentConversationId(conversationId);
      setHasMessages(messages.length > 0);
      setIsMobileDrawerOpen(false); // Close drawer on mobile after loading
    } catch (error) {
      console.error('Failed to load conversation:', error);
      setMessages([]);
      setHasMessages(false);
    }
  };

  const handleSend = async (text: string) => {
    if (isLoading) return;

    let conversationId = currentConversationId;

    // Create new conversation if needed
    let isFirstMessage = false;
    if (!conversationId) {
      try {
        isFirstMessage = true;
        const newConv = await apiClient.createConversation(' ');
        conversationId = newConv.id;
        setCurrentConversationId(conversationId);
        setConversations((prev) => [newConv, ...prev]);
      } catch (error) {
        console.error('Failed to create conversation:', error);
        return;
      }
    }

    if (!hasMessages) {
      setIsExiting(true);
      setTimeout(() => {
        setHasMessages(true);
        setIsExiting(false);
      }, 400);
    }

    // Add user message
    const newUserMsg: Message = {
      id: Date.now().toString(),
      conversation_id: conversationId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), newUserMsg]);
    setIsLoading(true);

    // Create placeholder for assistant message
    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantMsgId,
      conversation_id: conversationId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), assistantMsg]);

    // Stream AI response
    try {
      await apiClient.sendMessage(
        conversationId,
        text,
        (token) => {
          // Update assistant message with new token
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + token }
                : msg
            )
          );
        },
        async () => {
          // Done - reload conversations to get updated timestamp and re-sort
          setIsLoading(false);
          
          // If this was the first message, generate a title using AI
          if (isFirstMessage && conversationId) {
            try {
              const generatedTitle = await apiClient.generateTitle(conversationId);
              handleUpdateConversation(conversationId, generatedTitle);
            } catch (error) {
              console.error('Failed to auto-generate title:', error);
            }
          }
          
          loadConversations();
        },
        (error) => {
          // Error
          console.error('Chat error:', error);
          setIsLoading(false);
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: `Error: ${error}` }
                : msg
            )
          );
        }
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setHasMessages(false);
    setCurrentConversationId(null);
    setIsMobileDrawerOpen(false); // Close drawer on mobile
  };

  const handleSelectConversation = (conversationId: string) => {
    loadConversation(conversationId);
    setIsMobileDrawerOpen(false); // Close drawer on mobile after selection
  };

  const handleDeleteConversation = (conversationId: string) => {
    // Remove from local state
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    
    // If deleted conversation is current, reset
    if (conversationId === currentConversationId) {
      handleNewChat();
    }
  };

  const handleUpdateConversation = (conversationId: string, newTitle: string) => {
    // Update local state with new title and updated timestamp
    const now = new Date().toISOString();
    setConversations((prev) => {
      // Update the conversation
      const updated = prev.map((c) => 
        c.id === conversationId 
          ? { ...c, title: newTitle, updated_at: now } 
          : c
      );
      // Sort by updated_at descending (most recent first)
      return updated.sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });
  };

  const currentConversation = conversations.find(c => c.id === currentConversationId);
  const conversationTitle = currentConversation?.title;

  return (
    <div className="app-container">
      <Sidebar 
        conversations={conversations}
        currentConversationId={currentConversationId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onUpdateConversation={handleUpdateConversation}
        isLoading={isLoadingConversations}
        isMobileDrawerOpen={isMobileDrawerOpen}
        onMobileDrawerClose={() => setIsMobileDrawerOpen(false)}
      />
      <div className="main-content">
        <TopBar 
          conversationTitle={conversationTitle}
          onMenuClick={() => setIsMobileDrawerOpen(true)}
          onNewChat={handleNewChat}
        />
        <div className="chat-container">
          {!hasMessages ? (
            <div key="empty-state" className={`empty-state-container ${isExiting ? 'fade-out' : ''}`}>
              <div className="empty-greeting">
                <img src="/AL_Logo.svg" alt="AL Logo" className="empty-logo" />
                <h2>你好，今天我能帮你什么？</h2>
              </div>
            </div>
          ) : (
            <div key="chat-content" className="chat-area-wrapper">
              <ChatArea messages={messages} />
            </div>
          )}
          <InputArea onSend={handleSend} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <ChatApp />
            </ProtectedRoute>
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
