import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/fab/fab.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/dialog/dialog.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import './Sidebar.css';
import { apiClient } from '../../services/api';

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onUpdateConversation: (id: string, title: string) => void;
  isLoading?: boolean;
  isMobileDrawerOpen?: boolean;
  onMobileDrawerClose?: () => void;
}

const AI_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3">
    <path d="m176-120-56-56 301-302-181-45 198-123-17-234 179 151 216-88-87 217 151 178-234-16-124 198-45-181-301 301Zm24-520-80-80 80-80 80 80-80 80Zm355 197 48-79 93 7-60-71 35-86-86 35-71-59 7 92-79 49 90 22 23 90Zm165 323-80-80 80-80 80 80-80 80ZM569-570Z"/>
  </svg>
);

type Theme = 'auto' | 'light' | 'dark';

interface ContextMenuState {
  conversationId: string;
  position: { top: number; left: number };
}

export function Sidebar({ 
  conversations, 
  currentConversationId, 
  onNewChat, 
  onSelectConversation,
  onDeleteConversation,
  onUpdateConversation,
  isLoading = false,
  isMobileDrawerOpen = false,
  onMobileDrawerClose
}: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('al-chat-theme') as Theme) || 'auto';
  });
  const [cardPosition, setCardPosition] = useState({ bottom: 0, left: 0 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [showUserProfileDialog, setShowUserProfileDialog] = useState(false);
  const [userNickname, setUserNickname] = useState('');
  const [originalNickname, setOriginalNickname] = useState('');
  const settingsButtonRef = useRef<HTMLDivElement>(null);
  const settingsCardRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    localStorage.setItem('al-chat-theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsCardRef.current && !settingsCardRef.current.contains(event.target as Node) &&
        settingsButtonRef.current && !settingsButtonRef.current.contains(event.target as Node)
      ) {
        setShowSettings(false);
      }
      
      if (
        contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)
      ) {
        setContextMenu(null);
      }
    };

    if (showSettings) {
      const updatePosition = () => {
        if (settingsButtonRef.current) {
          const rect = settingsButtonRef.current.getBoundingClientRect();
          setCardPosition({
            bottom: window.innerHeight - rect.top + 12,
            left: rect.left
          });
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', updatePosition);
      updatePosition();
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('resize', updatePosition);
      };
    }
    
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showSettings, contextMenu]);

  const handleCloseUserDialog = () => {
    setShowUserProfileDialog(false);
  };

  const handleMoreClick = (e: React.MouseEvent, conversation: Conversation) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const menuHeight = 100; // Approximate menu height
    
    setContextMenu({
      conversationId: conversation.id,
      position: {
        top: spaceBelow > menuHeight ? rect.bottom + 4 : rect.top - menuHeight - 4,
        left: rect.left
      }
    });
  };

  const handleDeleteClick = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setShowDeleteDialog(true);
    setContextMenu(null);
  };

  const handleEditClick = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setEditTitle(conversation.title);
    setShowEditDialog(true);
    setContextMenu(null);
  };

  const handleConfirmDelete = async () => {
    if (selectedConversation) {
      try {
        await apiClient.deleteConversation(selectedConversation.id);
        setShowDeleteDialog(false);
        setSelectedConversation(null);
        // Call the callback after successful deletion
        onDeleteConversation(selectedConversation.id);
      } catch (error) {
        console.error('Failed to delete conversation:', error);
        alert('删除对话失败，请重试');
      }
    }
  };

  const handleConfirmEdit = async () => {
    if (selectedConversation && editTitle.trim()) {
      try {
        await apiClient.updateConversationTitle(selectedConversation.id, editTitle.trim());
        setShowEditDialog(false);
        setSelectedConversation(null);
        setEditTitle('');
        // Call the callback after successful update
        onUpdateConversation(selectedConversation.id, editTitle.trim());
      } catch (error) {
        console.error('Failed to update conversation title:', error);
        alert('更新标题失败，请重试');
      }
    }
  };

  const handleAIGenerateTitle = async () => {
    if (!selectedConversation || isGeneratingTitle) return;

    setIsGeneratingTitle(true);
    try {
      const newTitle = await apiClient.generateTitle(selectedConversation.id);
      setEditTitle(newTitle);
    } catch (error) {
      console.error('Failed to generate AI title:', error);
      alert('AI 生成标题失败，请重试');
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  return (
    <>
      {/* Mobile drawer backdrop */}
      {isMobileDrawerOpen && (
        <div 
          className="drawer-backdrop" 
          onClick={onMobileDrawerClose}
        />
      )}
      
      <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'} ${isMobileDrawerOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-top">
          <md-icon-button onClick={() => {
            // On mobile, close the drawer; on desktop, toggle expand/collapse
            if (window.innerWidth <= 768 && isMobileDrawerOpen) {
              onMobileDrawerClose?.();
            } else {
              setIsExpanded(!isExpanded);
            }
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z"/>
            </svg>
          </md-icon-button>
          
          <div className="fab-container">
            <button 
              className="new-chat-button"
              onClick={onNewChat}
              aria-label="新对话"
            >
              <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
              </svg>
              <span className="label">新对话</span>
            </button>
          </div>
        </div>

        <div className="sidebar-content">
          <md-list className={isExpanded ? '' : 'hidden'}>
            {isLoading ? (
              <div className="empty-history">加载中...</div>
            ) : conversations && conversations.length > 0 ? (
              conversations.map((conv) => (
                <div 
                  key={conv.id}
                  className={`history-item ${conv.id === currentConversationId ? 'active' : ''}`}
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <div className="history-item-content">{conv.title}</div>
                  <div className="history-item-actions" onClick={(e) => e.stopPropagation()}>
                    <md-icon-button onClick={(e: React.MouseEvent) => handleMoreClick(e, conv)}>
                      <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                        <path d="M480-160q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm0-240q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0-240q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Z"/>
                      </svg>
                    </md-icon-button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-history">暂无对话</div>
            )}
          </md-list>
        </div>

        <div className="sidebar-bottom">
          <div className="settings-button-container" ref={settingsButtonRef}>
            <md-icon-button onClick={() => setShowSettings(!showSettings)}>
              <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/>
              </svg>
            </md-icon-button>
          </div>

          {showSettings && createPortal(
            <div 
              className="settings-card" 
              ref={settingsCardRef}
              style={{ 
                position: 'fixed',
                bottom: `${cardPosition.bottom}px`,
                left: `${cardPosition.left}px`
              }}
            >
              <div className="settings-row">
                <span className="settings-label">主题</span>
                <div className="theme-toggle-group">
                  <button 
                    className={`theme-button ${theme === 'auto' ? 'active' : ''}`}
                    onClick={() => setTheme('auto')}
                    title="自动"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                      <path d="M312-320h64l32-92h146l32 92h62L512-680h-64L312-320Zm114-144 52-150h4l52 150H426Zm54 436L346-160H160v-186L28-480l132-134v-186h186l134-132 134 132h186v186l132 134-132 134v186H614L480-28Zm0-112 100-100h140v-140l100-100-100-100v-140H580L480-820 380-720H240v140L140-480l100 100v140h140l100 100Zm0-340Z"/>
                    </svg>
                  </button>
                  <button 
                    className={`theme-button ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                    title="浅色"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                      <path d="M565-395q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm-226.5 56.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z"/>
                    </svg>
                  </button>
                  <button 
                    className={`theme-button ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                    title="深色"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                      <path d="M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q14 0 27.5 1t26.5 3q-41 29-65.5 75.5T444-660q0 90 63 153t153 63q55 0 101-24.5t75-65.5q2 13 3 26.5t1 27.5q0 150-105 255T480-120Zm0-80q88 0 158-48.5T740-375q-20 5-40 8t-40 3q-123 0-209.5-86.5T364-660q0-20 3-40t8-40q-78 32-126.5 102T200-480q0 116 82 198t198 82Zm-10-270Z"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="settings-divider"></div>
              <div 
                className="settings-row user-info-row clickable"
                onClick={() => {
                  setShowSettings(false);
                  try {
                    const userStr = localStorage.getItem('user');
                    if (userStr) {
                      const user = JSON.parse(userStr);
                      const nickname = user.nickname || user.username || '';
                      setUserNickname(nickname);
                      setOriginalNickname(nickname);
                    }
                  } catch (e) { }
                  setShowUserProfileDialog(true);
                }}
              >
                <span className="settings-label user-label">用户</span>
                <div className="user-actions">
                  <span className="username-text">
                    {(() => {
                      try {
                        const userStr = localStorage.getItem('user');
                        if (userStr) {
                          const user = JSON.parse(userStr);
                          return user.nickname || user.username || '用户';
                        }
                      } catch (e) { }
                      return '用户';
                    })()}
                  </span>
                </div>
              </div>
            </div>,
            document.body
          )}

          {contextMenu && createPortal(
            <div 
              className="context-menu" 
              ref={contextMenuRef}
              style={{ 
                position: 'fixed',
                top: `${contextMenu.position.top}px`,
                left: `${contextMenu.position.left}px`
              }}
            >
              <button 
                className="context-menu-item"
                onClick={() => {
                  const conv = conversations.find(c => c.id === contextMenu.conversationId);
                  if (conv) handleEditClick(conv);
              }}
            >
              <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/>
              </svg>
              <span>编辑标题</span>
            </button>
              <button 
                className="context-menu-item danger"
                onClick={() => {
                  const conv = conversations.find(c => c.id === contextMenu.conversationId);
                  if (conv) handleDeleteClick(conv);
                }}
              >
                <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                  <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>
                </svg>
                <span>删除对话</span>
              </button>
            </div>,
            document.body
          )}

          {showDeleteDialog && selectedConversation && createPortal(
            <div className="dialog-overlay" onClick={() => setShowDeleteDialog(false)}>
              <div className="dialog" onClick={(e) => e.stopPropagation()}>
                <div className="dialog-title">删除对话</div>
                <div className="dialog-content">
                  确定要删除对话 "{selectedConversation.title}" 吗？此操作无法撤销。
                </div>
                <div className="dialog-actions">
                  <button 
                    className="dialog-button secondary"
                    onClick={() => setShowDeleteDialog(false)}
                  >
                    取消
                  </button>
                  <button 
                    className="dialog-button danger"
                    onClick={handleConfirmDelete}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {showEditDialog && selectedConversation && createPortal(
            <div className="dialog-overlay" onClick={() => setShowEditDialog(false)}>
              <div className="dialog" onClick={(e) => e.stopPropagation()}>
                <div className="dialog-title">编辑对话标题</div>
                <div className="dialog-input-container">
                  <input 
                    type="text"
                    className="dialog-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleConfirmEdit();
                      }
                    }}
                    autoFocus
                    placeholder="输入新标题"
                  />
                  <button 
                    className={`ai-generate-button ${isGeneratingTitle ? 'loading' : ''}`}
                    onClick={handleAIGenerateTitle}
                    title="AI 生成标题"
                    disabled={isGeneratingTitle}
                  >
                    {AI_ICON}
                  </button>
                </div>
                <div className="dialog-actions">
                  <button 
                    className="dialog-button secondary"
                    onClick={() => setShowEditDialog(false)}
                  >
                    取消
                  </button>
                  <button 
                    className="dialog-button primary"
                    onClick={handleConfirmEdit}
                    disabled={!editTitle.trim()}
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>

      {showUserProfileDialog && (
        <md-dialog 
          open={showUserProfileDialog}
          onClose={handleCloseUserDialog}
        >
          <div slot="headline">用户设置</div>
          <form slot="content" method="dialog" className="user-settings-content">
            <div className="nickname-section">
              <md-outlined-text-field
                label="修改昵称"
                value={userNickname}
                onInput={(e: any) => setUserNickname(e.target.value)}
                placeholder="请输入新昵称"
                style={{ width: '100%' }}
              >
                {userNickname !== originalNickname && userNickname.trim() && (
                  <div slot="trailing-icon" className="nickname-actions">
                    <md-icon-button
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setUserNickname(originalNickname);
                      }}
                      title="取消"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
                        <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                      </svg>
                    </md-icon-button>
                    <md-icon-button
                      onClick={async (e: React.MouseEvent) => {
                        e.stopPropagation();
                        try {
                          await apiClient.updateProfile({ nickname: userNickname });
                          const userStr = localStorage.getItem('user');
                          if (userStr) {
                            const user = JSON.parse(userStr);
                            user.nickname = userNickname;
                            localStorage.setItem('user', JSON.stringify(user));
                          }
                          setOriginalNickname(userNickname);
                        } catch (error) {
                          console.error('Failed to update profile', error);
                          alert('修改昵称失败，请稍后重试');
                        }
                      }}
                      title="确认"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
                        <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
                      </svg>
                    </md-icon-button>
                  </div>
                )}
              </md-outlined-text-field>
            </div>
            
            <div className="logout-section">
              <md-filled-button
                className="logout-btn"
                onClick={() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                  window.location.href = '/welcome';
                }}
                style={{ width: '100%' }}
              >
                退出登录
              </md-filled-button>
            </div>
          </form>
          <div slot="actions">
            <md-text-button onClick={handleCloseUserDialog}>关闭</md-text-button>
          </div>
        </md-dialog>
      )}
    </>
  );
}
