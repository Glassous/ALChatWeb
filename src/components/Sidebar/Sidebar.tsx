import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/fab/fab.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
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
            <span className="icon" style={{ maskImage: 'url(/icons/menu.svg)', WebkitMaskImage: 'url(/icons/menu.svg)' }} />
          </md-icon-button>
          
          <div className="fab-container">
            <button 
              className="new-chat-button"
              onClick={onNewChat}
              aria-label="新对话"
            >
              <span className="icon" style={{ maskImage: 'url(/icons/add.svg)', WebkitMaskImage: 'url(/icons/add.svg)' }} />
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
                      <span className="icon" style={{ maskImage: 'url(/icons/more_vert.svg)', WebkitMaskImage: 'url(/icons/more_vert.svg)' }} />
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
              <span className="icon" style={{ maskImage: 'url(/icons/settings.svg)', WebkitMaskImage: 'url(/icons/settings.svg)' }} />
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
              <div className="settings-row user-info-row">
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
                  <button 
                    className="logout-button"
                    onClick={() => {
                      localStorage.removeItem('token');
                      localStorage.removeItem('user');
                      window.location.href = '/welcome';
                    }}
                  >
                    退出登录
                  </button>
                </div>
              </div>
              <div className="settings-divider"></div>
              <div className="settings-row">
                <span className="settings-label">主题</span>
                <div className="theme-toggle-group">
                  <button 
                    className={`theme-button ${theme === 'auto' ? 'active' : ''}`}
                    onClick={() => setTheme('auto')}
                    title="自动"
                  >
                    <span className="icon" style={{ maskImage: 'url(/icons/auto.svg)', WebkitMaskImage: 'url(/icons/auto.svg)' }} />
                  </button>
                  <button 
                    className={`theme-button ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                    title="浅色"
                  >
                    <span className="icon" style={{ maskImage: 'url(/icons/light_mode.svg)', WebkitMaskImage: 'url(/icons/light_mode.svg)' }} />
                  </button>
                  <button 
                    className={`theme-button ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                    title="深色"
                  >
                    <span className="icon" style={{ maskImage: 'url(/icons/dark_mode.svg)', WebkitMaskImage: 'url(/icons/dark_mode.svg)' }} />
                  </button>
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
                <span className="icon" style={{ maskImage: 'url(/icons/settings.svg)', WebkitMaskImage: 'url(/icons/settings.svg)' }} />
                <span>编辑标题</span>
              </button>
              <button 
                className="context-menu-item danger"
                onClick={() => {
                  const conv = conversations.find(c => c.id === contextMenu.conversationId);
                  if (conv) handleDeleteClick(conv);
                }}
              >
                <span className="icon" style={{ maskImage: 'url(/icons/add.svg)', WebkitMaskImage: 'url(/icons/add.svg)', transform: 'rotate(45deg)' }} />
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
    </>
  );
}
