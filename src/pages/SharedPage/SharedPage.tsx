import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient, type SharedConversationResponse, type Message } from '../../services/api';
import { ChatArea } from '../../components/ChatArea/ChatArea';
import './SharedPage.css';

export function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SharedConversationResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiClient.getSharedConversation(token)
      .then(setData)
      .catch(() => setData({ status: 'deleted' }))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const result = await apiClient.saveSharedConversation(token);
      navigate('/', { state: { openConversationId: result.conversation_id } });
    } catch (err) {
      console.error('Failed to save shared conversation:', err);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleLogin = () => {
    const currentUrl = window.location.pathname;
    navigate(`/login?redirect=${encodeURIComponent(currentUrl)}`);
  };

  if (loading) {
    return (
      <div className="shared-page">
        <div className="shared-status-container">
          <div className="shared-loading-spinner" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shared-page">
        <div className="shared-status-container">
          <div className="shared-status-icon">🔗</div>
          <h2>链接不存在</h2>
          <p>该分享链接无效或已过期。</p>
        </div>
      </div>
    );
  }

  const renderStatus = () => {
    switch (data.status) {
      case 'deleted':
        return (
          <div className="shared-status-container">
            <div className="shared-status-icon">🚫</div>
            <h2>分享已取消</h2>
            {data.sharer_nickname && (
              <p className="shared-sharer-info">{data.sharer_nickname} 已取消了该分享</p>
            )}
            {data.created_at && (
              <p className="shared-time-info">分享创建于 {new Date(data.created_at).toLocaleString('zh-CN')}</p>
            )}
          </div>
        );
      case 'expired':
        return (
          <div className="shared-status-container">
            <div className="shared-status-icon">⏰</div>
            <h2>链接已过期</h2>
            <p>该分享链接已超过有效期。</p>
          </div>
        );
      case 'conversation_deleted':
        return (
          <div className="shared-status-container">
            <div className="shared-status-icon">🗑️</div>
            <h2>对话已被删除</h2>
            {data.sharer_nickname && (
              <p className="shared-sharer-info">{data.sharer_nickname} 的对话已被删除</p>
            )}
            {data.title && <p className="shared-conv-title">原对话标题：{data.title}</p>}
          </div>
        );
      case 'messages_deleted':
        return (
          <div className="shared-status-container">
            <div className="shared-status-icon">📭</div>
            <h2>内容已被清空</h2>
            <p>该对话的消息内容已被全部删除。</p>
          </div>
        );
      default:
        return null;
    }
  };

  const statusOverlay = renderStatus();
  const isLoggedIn = !!localStorage.getItem('token');

  const sharedMessages = (data.messages || []) as Message[];

  return (
    <div className="shared-page">
      <header className="shared-header">
        <div className="shared-header-left">
          <h1 className="shared-logo">AL Chat</h1>
        </div>
        {isLoggedIn ? (
          <div className="shared-header-right">
            <button className="shared-save-btn" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '添加到我的对话'}
            </button>
          </div>
        ) : (
          <div className="shared-header-right">
            <button className="shared-login-btn" onClick={handleLogin}>登录</button>
          </div>
        )}
      </header>

      <main className="shared-main">
        {statusOverlay ? (
          statusOverlay
        ) : (
          <div className="shared-conversation">
            <div className="shared-conversation-header">
              <h2 className="shared-conversation-title">{data.title}</h2>
              {data.sharer_nickname && (
                <div className="shared-conversation-sharer-container">
                  <div className="shared-sharer-avatar">
                    {data.sharer_avatar ? (
                      <img src={data.sharer_avatar} alt={data.sharer_nickname} />
                    ) : (
                      data.sharer_nickname.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="shared-conversation-sharer">由 {data.sharer_nickname} 分享</span>
                </div>
              )}
            </div>
            <div className="shared-chat-wrapper">
              <ChatArea
                messages={sharedMessages}
                allMessages={sharedMessages}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
