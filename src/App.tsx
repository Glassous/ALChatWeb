import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { ChatArea, type Message } from './components/ChatArea/ChatArea';
import { InputArea } from './components/InputArea/InputArea';
import { apiClient, type Conversation } from './services/api';
import './App.css';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [hasMessages, setHasMessages] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);

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
    if (!conversationId) {
      try {
        // Clean and truncate message for title
        // Remove newlines and extra spaces
        const cleanText = text.replace(/\s+/g, ' ').trim();
        const title = cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText;
        const newConv = await apiClient.createConversation(title);
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
        () => {
          // Done
          setIsLoading(false);
          loadConversations(); // Refresh conversation list
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
  };

  const handleSelectConversation = (conversationId: string) => {
    loadConversation(conversationId);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await apiClient.deleteConversation(conversationId);
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      
      // If deleted conversation is current, reset
      if (conversationId === currentConversationId) {
        handleNewChat();
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  return (
    <div className="app-container">
      <Sidebar 
        conversations={conversations}
        currentConversationId={currentConversationId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        isLoading={isLoadingConversations}
      />
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
          <InputArea onSend={handleSend} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}

export default App;
