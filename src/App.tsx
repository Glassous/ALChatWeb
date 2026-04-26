import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { ChatArea, type Message, type ChatAreaHandle } from './components/ChatArea/ChatArea';
import { SearchSidebar, type SearchData } from './components/SearchSidebar/SearchSidebar';
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
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [searchData, setSearchData] = useState<SearchData | null>(null);
  const [isSearchSidebarOpen, setIsSearchSidebarOpen] = useState(false);
  const chatAreaRef = useRef<ChatAreaHandle>(null);

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

  const handleSend = async (text: string, options?: { isImageMode: boolean; resolution: string; refImageUrl?: string; mode?: 'daily' | 'expert' | 'search' }) => {
    if (isLoading) return;

    let conversationId = currentConversationId;
    const currentMode = options?.mode || 'daily';

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

    // Add user message to UI immediately
    const userMsgId = Date.now().toString();
    let userMsgContent = text;
    if (options?.refImageUrl) {
      userMsgContent = `<image src="${options.refImageUrl}">\n${text}`;
    }

    const newUserMsg: Message = {
      id: userMsgId,
      conversation_id: conversationId,
      role: 'user',
      content: userMsgContent,
      created_at: new Date().toISOString(),
    };
    
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), newUserMsg]);
    setIsLoading(true);

    if (options?.isImageMode) {
      // Handle image generation
      const assistantMsgId = (Date.now() + 1).toString();
      const loadingMsg: Message = {
        id: assistantMsgId,
        conversation_id: conversationId,
        role: 'assistant',
        content: '',
        created_at: new Date().toISOString(),
        status: 'loading',
        metadata: {
          resolution: options.resolution
        }
      };
      setMessages((prev) => [...(Array.isArray(prev) ? prev : []), loadingMsg]);
      setIsLoading(true);

      try {
        const imageUrl = await apiClient.generateImage(conversationId, text, options.resolution, options.refImageUrl);
        
        // Update loading message with image tag and completed status
        setMessages((prev) =>
          (Array.isArray(prev) ? prev : []).map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, content: `<image src="${imageUrl}">`, status: 'completed' }
              : msg
          )
        );
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
      } catch (error) {
        console.error('Failed to generate image:', error);
        setMessages((prev) =>
          (Array.isArray(prev) ? prev : []).map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, content: `Error generating image: ${error}`, status: 'error' }
              : msg
          )
        );
        setIsLoading(false);
      }
      return;
    }

    // Create placeholder for assistant message
    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantMsgId,
      conversation_id: conversationId,
      role: 'assistant',
      content: '',
      reasoning: '',
      status: 'loading',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), assistantMsg]);

    // Stream AI response
    try {
      await apiClient.sendMessage(
        conversationId,
        text,
        currentMode,
        (token) => {
          // Update assistant message with new token
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + token, status: 'completed' }
                : msg
            )
          );
        },
        (reasoning) => {
          // Update assistant message with reasoning token
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, reasoning: (msg.reasoning || '') + reasoning, status: 'completed' }
                : msg
            )
          );
        },
        (searchData) => {
          // Update assistant message with search data
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, search: searchData }
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
          console.error('SSE Error:', error);
          setIsLoading(false);
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + `\n\n[Error: ${error}]`, status: 'error' }
                : msg
            )
          );
        }
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      setIsLoading(false);
      setMessages((prev) =>
        (Array.isArray(prev) ? prev : []).map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, content: msg.content + `\n\n[Failed to send message: ${error}]`, status: 'error' }
            : msg
        )
      );
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setHasMessages(false);
    setCurrentConversationId(null);
    setIsMobileDrawerOpen(false); // Close drawer on mobile
    setIsInitialLoad(false); // Disable animation for subsequent new chats
  };

  const handleSelectConversation = (conversationId: string) => {
    loadConversation(conversationId);
    setIsMobileDrawerOpen(false); // Close drawer on mobile after selection
    setIsInitialLoad(false);
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

  const handleShowSearch = (data: SearchData) => {
    setSearchData(data);
    setIsSearchSidebarOpen(true);
  };

  const handleResend = async (msg: Message) => {
    if (isLoading || !currentConversationId) return;

    const msgIndex = messages.findIndex(m => m.id === msg.id);
    if (msgIndex === -1) return;

    let textToResend = '';
    let truncateId = '';

    if (msg.role === 'user') {
      textToResend = msg.content;
      truncateId = msg.id;
    } else {
      // If assistant, we resend the previous user message
      const prevMsg = messages[msgIndex - 1];
      if (prevMsg && prevMsg.role === 'user') {
        textToResend = prevMsg.content;
        truncateId = prevMsg.id;
      } else {
        return; // Should not happen in normal flow
      }
    }

    try {
      // 1. Truncate in backend
      await apiClient.truncateMessages(currentConversationId, truncateId);

      // 2. Truncate in frontend state
      const truncateIndex = messages.findIndex(m => m.id === truncateId);
      setMessages(prev => prev.slice(0, truncateIndex));

      // 3. Resend
      // handleSend expects clean text, but user message might have <image> tags
      // We need to extract the text part if it has images
      let textOnly = textToResend;
      let refImageUrl = undefined;
      
      const imageMatch = textToResend.match(/<image src="([^"]+)">/);
      if (imageMatch) {
        refImageUrl = imageMatch[1];
        textOnly = textToResend.replace(/<image src="[^"]+">\n?/, '');
      }

      handleSend(textOnly, { 
        isImageMode: false, 
        resolution: '1024x1024', 
        refImageUrl 
      });
    } catch (error) {
      console.error('Failed to resend:', error);
    }
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
      <div className={`main-content ${isSearchSidebarOpen ? 'sidebar-open' : ''}`}>
        <TopBar 
          conversationTitle={conversationTitle}
          onMenuClick={() => setIsMobileDrawerOpen(true)}
          onNewChat={handleNewChat}
        />
        <div className="chat-container">
          {!hasMessages ? (
            <div key="empty-state" className={`empty-state-container ${isExiting ? 'fade-out' : ''}`}>
              <div className={`empty-greeting ${isInitialLoad ? 'initial-animate' : ''}`}>
                <img src="/AL_Logo.svg" alt="AL Logo" className="empty-logo" />
                <div className="empty-greeting-text-wrapper">
                  <h2>你好，今天我能帮你什么？</h2>
                </div>
              </div>
            </div>
          ) : (
            <div key="chat-content" className="chat-area-wrapper">
              <ChatArea 
                messages={messages} 
                ref={chatAreaRef} 
                onScrollStateChange={setIsAtBottom}
                onShowSearch={handleShowSearch}
                onResend={handleResend}
              />
            </div>
          )}
          <InputArea 
            onSend={handleSend} 
            disabled={isLoading} 
            onScrollToBottom={() => chatAreaRef.current?.scrollToBottom()}
            isAtBottom={isAtBottom}
            isEmpty={!hasMessages}
            userMessages={messages.filter(m => m.role === 'user').map(m => m.content)}
          />
        </div>
      </div>
      <SearchSidebar 
        isOpen={isSearchSidebarOpen} 
        searchData={searchData} 
        onClose={() => setIsSearchSidebarOpen(false)} 
      />
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
