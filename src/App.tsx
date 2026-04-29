import { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar/TopBar';
import { ChatArea, type Message, type ChatAreaHandle } from './components/ChatArea/ChatArea';
import { TreeView } from './components/ChatArea/TreeView';
import { EditMessageDialog } from './components/ChatArea/EditMessageDialog';
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
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [hasMessages, setHasMessages] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isMessageLoading, setIsMessageLoading] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [searchData, setSearchData] = useState<SearchData | null>(null);
  const [isSearchSidebarOpen, setIsSearchSidebarOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTreeViewOpen, setIsTreeViewOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [systemPromptSettings, setSystemPromptSettings] = useState<{ include_location: boolean } | null>(null);
  const chatAreaRef = useRef<ChatAreaHandle>(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
    loadSystemPromptSettings();
  }, []);

  const loadSystemPromptSettings = async () => {
    try {
      const data = await apiClient.getSystemPrompt();
      setSystemPromptSettings(data);
    } catch (error) {
      console.error('Failed to load system prompt settings:', error);
    }
  };

  const loadConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const convs = await apiClient.getConversations();
      setConversations(convs || []); // Ensure it's always an array
      
      // Preload first 15 conversations
      if (convs && convs.length > 0) {
        const toPreload = convs.slice(0, 15);
        // Preload in parallel to populate the cache
        Promise.all(toPreload.map(conv => apiClient.getConversation(conv.id)))
          .catch(err => console.warn('Failed to preload some conversations:', err));
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setConversations([]); // Set empty array on error
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const loadConversation = async (conversationId: string, targetNodeId?: string) => {
    setIsMessageLoading(true);
    try {
      const conv = await apiClient.getConversation(conversationId);
      const messages = Array.isArray(conv.messages) ? conv.messages : [];
      setMessages(messages);
      setCurrentConversationId(conversationId);
      setHasMessages(messages.length > 0);
      
      // Determine the next node ID to display.
      let nextNodeId: string | null = null;
      if (targetNodeId && messages.some(m => m.id === targetNodeId)) {
        // 1. If targetNodeId is provided and exists in the new messages, use it.
        nextNodeId = targetNodeId;
      } else if (messages.length > 0) {
        // 2. If not found (e.g. after sending a message where IDs change), 
        // find the latest leaf node in the conversation to ensure we stay on the newest branch.
        const leaves = messages.filter(m => !messages.some(child => child.parent_id === m.id));
        if (leaves.length > 0) {
          const sortedLeaves = [...leaves].sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          nextNodeId = sortedLeaves[0].id;
        } else {
          nextNodeId = messages[messages.length - 1].id;
        }
      }
      
      setCurrentNodeId(nextNodeId);
      
      setIsMobileDrawerOpen(false); // Close drawer on mobile after loading
    } catch (error) {
      console.error('Failed to load conversation:', error);
      setMessages([]);
      setHasMessages(false);
    } finally {
      setIsMessageLoading(false);
    }
  };

  const handleSend = async (text: string, options?: { 
    isImageMode: boolean; 
    resolution: string; 
    refImageUrl?: string; 
    mode?: 'daily' | 'expert' | 'search';
    overrideParentId?: string | null;
  }) => {
    if (isLoading) return;

    let conversationId = currentConversationId;
    const currentMode = options?.mode || 'daily';
    const effectiveParentId = options?.hasOwnProperty('overrideParentId') 
      ? options.overrideParentId 
      : currentNodeId;

    // Create new conversation if needed
    if (!conversationId) {
      try {
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
    const userMsgId = `temp-user-${Date.now()}`;
    let userMsgContent = text;
    if (options?.refImageUrl) {
      userMsgContent = `<image src="${options.refImageUrl}">\n${text}`;
    }

    const newUserMsg: Message = {
      id: userMsgId,
      conversation_id: conversationId,
      parent_id: (effectiveParentId as string) || undefined,
      role: 'user',
      content: userMsgContent,
      created_at: new Date().toISOString(),
    };
    
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), newUserMsg]);
    setCurrentNodeId(userMsgId);
    setIsLoading(true);

    if (options?.isImageMode) {
      // Handle image generation
      const assistantMsgId = `temp-assistant-${Date.now() + 1}`;
      const loadingMsg: Message = {
        id: assistantMsgId,
        conversation_id: conversationId,
        parent_id: userMsgId,
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
          await apiClient.generateImage(
            conversationId, 
            text, 
            options.resolution,
            (imageTag) => {
              setMessages((prev) =>
                (Array.isArray(prev) ? prev : []).map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: imageTag, status: 'completed' }
                    : msg
                )
              );
            },
            (doneData) => {
              const realAssistantId = doneData?.assistant_message_id as string;
              const realUserId = doneData?.user_message_id as string;

              // Update IDs
              setMessages((prev) => {
                const updated = (Array.isArray(prev) ? prev : []).map((msg): Message => {
                  if (msg.id === assistantMsgId) {
                    return { ...msg, id: realAssistantId || msg.id, status: 'completed' };
                  }
                  if (msg.id === userMsgId) {
                    return { ...msg, id: realUserId || msg.id };
                  }
                  if (msg.parent_id === userMsgId) {
                    return { ...msg, parent_id: realUserId || msg.parent_id };
                  }
                  if (msg.parent_id === assistantMsgId) {
                    return { ...msg, parent_id: realAssistantId || msg.parent_id };
                  }
                  return msg;
                });
                return updated;
              });

              if (realAssistantId) {
                setCurrentNodeId(realAssistantId);
              }

              setIsLoading(false);
              if (conversationId) {
                loadConversation(conversationId, realAssistantId || undefined);
              }
              loadConversations();
            },
            (newTitle) => {
              if (conversationId) {
                handleUpdateConversation(conversationId, newTitle);
              }
            },
            (error) => {
              console.error('SSE Error:', error);
              setIsLoading(false);
              setMessages((prev) =>
                (Array.isArray(prev) ? prev : []).map((msg): Message =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: msg.content + `\n\n[Error: ${error}]`, status: 'error' }
                    : msg
                )
              );
            },
            options.refImageUrl, 
            effectiveParentId
          );
        } catch (error) {
        console.error('Failed to generate image:', error);
        setMessages((prev) =>
          (Array.isArray(prev) ? prev : []).map((msg): Message =>
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
    const assistantMsgId = `temp-assistant-${Date.now() + 1}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      conversation_id: conversationId,
      parent_id: userMsgId,
      role: 'assistant',
      content: '',
      reasoning: '',
      status: 'loading',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), assistantMsg]);
    setCurrentNodeId(assistantMsgId);

    // Stream AI response
    try {
      let location = undefined;
      if (systemPromptSettings?.include_location) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          location = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        } catch (e) {
          console.warn('Failed to get location:', e);
        }
      }

      await apiClient.sendMessage(
        conversationId,
        text,
        currentMode,
        (token) => {
          // Update assistant message with new token
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + token, status: 'loading' }
                : msg
            )
          );
        },
        (reasoning) => {
          // Update assistant message with reasoning token
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg): Message =>
              msg.id === assistantMsgId
                ? { ...msg, reasoning: (msg.reasoning || '') + reasoning, status: 'loading' }
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
        async (doneData) => {
          // Done - reload conversations to get updated timestamp and re-sort
          setIsLoading(false);

          const realAssistantId = doneData?.assistant_message_id as string;
          const realUserId = doneData?.user_message_id as string;

          // Swap temporary IDs with real IDs immediately to stabilize the UI
          if (realAssistantId && realUserId) {
            setMessages((prev) => {
              const updated = (Array.isArray(prev) ? prev : []).map((msg): Message => {
                if (msg.id === assistantMsgId) {
                  return { ...msg, id: realAssistantId, status: 'completed' };
                }
                if (msg.id === userMsgId) {
                  return { ...msg, id: realUserId };
                }
                // Update parent_ids of any messages pointing to temp IDs
                if (msg.parent_id === userMsgId) {
                  return { ...msg, parent_id: realUserId };
                }
                if (msg.parent_id === assistantMsgId) {
                  return { ...msg, parent_id: realAssistantId };
                }
                return msg;
              });
              return updated;
            });
            setCurrentNodeId(realAssistantId);
          }
          
          // Sync with real database IDs to maintain correct tree structure
          if (conversationId) {
            loadConversation(conversationId, realAssistantId || undefined);
          }
          loadConversations();
        },
        (newTitle) => {
          // Handle automatic title generation from backend
          if (conversationId) {
            handleUpdateConversation(conversationId, newTitle);
          }
        },
        (error) => {
          console.error('SSE Error:', error);
          setIsLoading(false);
          setMessages((prev) =>
            (Array.isArray(prev) ? prev : []).map((msg): Message =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + `\n\n[Error: ${error}]`, status: 'error' }
                : msg
            )
          );
        },
        location,
        effectiveParentId
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      setIsLoading(false);
      setMessages((prev) =>
        (Array.isArray(prev) ? prev : []).map((msg): Message =>
          msg.id === assistantMsgId
            ? { ...msg, content: msg.content + `\n\n[Failed to send message: ${error}]`, status: 'error' }
            : msg
        )
      );
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentNodeId(null);
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

    let textToResend = '';
    let parentId: string | null | undefined = null;

    if (msg.role === 'user') {
      textToResend = msg.content;
      parentId = msg.parent_id; // Resending user message: same parent as original
    } else {
      // Resending AI message: find the user message that triggered it
      const userMsg = messages.find(m => m.id === msg.parent_id);
      if (userMsg) {
        textToResend = userMsg.content;
        parentId = userMsg.parent_id; // New user message should be sibling of the original user message
      }
    }

    if (!textToResend) return;

    // Extract text part if it has images
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
      refImageUrl,
      overrideParentId: parentId
    });
  };

  const handleEdit = (msg: Message) => {
    if (isLoading) return;
    
    let messageToEdit = msg;
    if (msg.role === 'assistant') {
      // If user clicks edit on AI response, they actually want to edit the question
      const userMsg = messages.find(m => m.id === msg.parent_id);
      if (userMsg) {
        messageToEdit = userMsg;
      } else {
        return;
      }
    }
    
    setEditingMessage(messageToEdit);
    setIsEditOpen(true);
  };

  const handleConfirmEdit = async (newText: string) => {
    if (!editingMessage || !currentConversationId) return;
    
    // Extract original image if any
    let refImageUrl = undefined;
    const imageMatch = editingMessage.content.match(/<image src="([^"]+)">/);
    if (imageMatch) {
      refImageUrl = imageMatch[1];
    }

    // Explicitly set the node ID to prevent jumping
    const targetParentId = editingMessage.parent_id;

    handleSend(newText, { 
      isImageMode: false, 
      resolution: '1024x1024', 
      refImageUrl,
      overrideParentId: targetParentId
    });

    setIsEditOpen(false);
    setEditingMessage(null);
  };

  const activePath = useMemo(() => {
    if (!currentNodeId || messages.length === 0) return [];
    const path: Message[] = [];
    const msgMap = new Map(messages.map(m => [m.id, m]));
    
    let currId: string | undefined = currentNodeId;
    while (currId) {
      const msg = msgMap.get(currId);
      if (!msg) break;
      path.unshift(msg);
      currId = msg.parent_id;
    }
    return path;
  }, [messages, currentNodeId]);

  const findDeepestLeaf = (messageId: string, allMessages: Message[]): string => {
    const children = allMessages.filter(m => m.parent_id === messageId);
    if (children.length === 0) return messageId;
    
    // Sort children by created_at to find the latest branch
    const sortedChildren = [...children].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    return findDeepestLeaf(sortedChildren[0].id, allMessages);
  };

  const handleSwitchBranch = (messageId: string) => {
    const deepestLeafId = findDeepestLeaf(messageId, messages);
    setCurrentNodeId(deepestLeafId);
  };

  const isTree = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    const parentCounts = new Map<string | null, number>();
    messages.forEach(m => {
      const pid = m.parent_id || null;
      parentCounts.set(pid, (parentCounts.get(pid) || 0) + 1);
    });
    for (const count of parentCounts.values()) {
      if (count > 1) return true;
    }
    return false;
  }, [messages]);

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
        onSystemPromptUpdated={loadSystemPromptSettings}
        isLoading={isLoadingConversations}
        isMobileDrawerOpen={isMobileDrawerOpen}
        onMobileDrawerClose={() => setIsMobileDrawerOpen(false)}
      />
      <div className={`main-content ${isSearchSidebarOpen ? 'sidebar-open' : ''}`}>
        <TopBar 
          conversationTitle={conversationTitle}
          onMenuClick={() => setIsMobileDrawerOpen(true)}
          onNewChat={handleNewChat}
          showOverviewButton={isTree}
          onOverviewClick={() => setIsTreeViewOpen(!isTreeViewOpen)}
          isTreeViewOpen={isTreeViewOpen}
        />
        {isMessageLoading && <div className="loading-bar"></div>}
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
                messages={activePath}
                allMessages={messages}
                ref={chatAreaRef} 
                onScrollStateChange={setIsAtBottom}
                onShowSearch={handleShowSearch}
                onResend={handleResend}
                onEdit={handleEdit}
                onSwitchBranch={handleSwitchBranch}
              />
            </div>
          )}
          {isTreeViewOpen && (
            <TreeView 
              allMessages={messages}
              activePath={activePath}
              currentNodeId={currentNodeId}
              onSelectNode={(id) => {
                handleSwitchBranch(id);
                setIsTreeViewOpen(false);
              }}
              onClose={() => setIsTreeViewOpen(false)}
            />
          )}
          <InputArea 
            onSend={handleSend} 
            disabled={isLoading} 
            onScrollToBottom={() => chatAreaRef.current?.scrollToBottom()}
            isAtBottom={isAtBottom}
            isEmpty={!hasMessages}
            userMessages={activePath.filter(m => m.role === 'user').map(m => m.content)}
          />
        </div>
      </div>
      <SearchSidebar 
        isOpen={isSearchSidebarOpen} 
        searchData={searchData} 
        onClose={() => setIsSearchSidebarOpen(false)} 
      />
      <EditMessageDialog 
        open={isEditOpen}
        initialText={editingMessage ? editingMessage.content.replace(/<image src="[^"]+">\n?/, '') : ''}
        onClose={() => setIsEditOpen(false)}
        onConfirm={handleConfirmEdit}
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
