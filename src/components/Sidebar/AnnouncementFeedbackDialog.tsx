import { useState, useEffect } from 'react';
import '@material/web/dialog/dialog.js';
import '@material/web/button/text-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/tabs/tabs.js';
import '@material/web/tabs/primary-tab.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import './AnnouncementFeedbackDialog.css';
import { apiClient, type Announcement } from '../../services/api';

interface AnnouncementFeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: 'announcement' | 'feedback';
}

export function AnnouncementFeedbackDialog({ open, onClose, initialTab = 'announcement' }: AnnouncementFeedbackDialogProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnn, setLoadingAnn] = useState(false);
  const [feedbackType, setFeedbackType] = useState('bug');
  const [feedbackContent, setFeedbackContent] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab === 'announcement' ? 0 : 1);
      loadAnnouncements();
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setUserEmail(user.email || '');
      }
    }
  }, [open, initialTab]);

  const loadAnnouncements = async () => {
    setLoadingAnn(true);
    try {
      const data = await apiClient.getPublicAnnouncements();
      setAnnouncements(data);
    } catch (err) {
      console.error('Failed to load announcements:', err);
    } finally {
      setLoadingAnn(false);
    }
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackContent || !userEmail) {
      alert('请填写反馈内容和联系邮箱');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.submitFeedback({
        type: feedbackType,
        content: feedbackContent,
        user_email: userEmail,
        meta: {
          ua: navigator.userAgent,
          platform: 'Web'
        }
      });
      alert('提交成功，感谢您的反馈！');
      setFeedbackContent('');
      onClose();
    } catch (err) {
      alert('提交失败: ' + (err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <md-dialog 
      open={open} 
      onClose={onClose}
      className="announcement-feedback-dialog"
    >
      <div slot="headline">系统公告与反馈</div>
      
      <div slot="content" className="dialog-content">
        <md-tabs 
          active-tab-index={activeTab} 
          onchange={(e: any) => setActiveTab(e.target.activeTabIndex)}
        >
          <md-primary-tab>系统公告</md-primary-tab>
          <md-primary-tab>意见反馈</md-primary-tab>
        </md-tabs>

        <div className="tab-panels">
          {activeTab === 0 && (
            <div className="announcement-panel">
              {loadingAnn ? (
                <div className="loading-state">加载中...</div>
              ) : announcements.length > 0 ? (
                <div className="announcement-list">
                  {announcements.map(ann => (
                    <div key={ann.id} className={`announcement-item ${ann.type}`}>
                      <div className="ann-header">
                        <span className="ann-title">{ann.title}</span>
                        <span className="ann-date">{new Date(ann.published_at || ann.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="ann-body">{ann.content}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">暂无公告</div>
              )}
            </div>
          )}

          {activeTab === 1 && (
            <div className="feedback-panel">
              <p className="feedback-intro">欢迎向我们反馈产品问题或建议，我们会通过邮箱回复您。</p>
              
              <div className="form-group">
                <md-outlined-select 
                  label="反馈类型" 
                  value={feedbackType}
                  onInput={(e: any) => setFeedbackType(e.target.value)}
                >
                  <md-select-option value="bug">问题反馈 / Bug</md-select-option>
                  <md-select-option value="feature">功能建议</md-select-option>
                  <md-select-option value="other">其他</md-select-option>
                </md-outlined-select>
              </div>

              <div className="form-group">
                <md-outlined-text-field
                  label="反馈内容"
                  type="textarea"
                  rows={5}
                  value={feedbackContent}
                  onInput={(e: any) => setFeedbackContent(e.target.value)}
                  placeholder="请详细描述您遇到的问题或建议..."
                />
              </div>

              <div className="form-group">
                <md-outlined-text-field
                  label="联系邮箱"
                  type="email"
                  value={userEmail}
                  onInput={(e: any) => setUserEmail(e.target.value)}
                  placeholder="用于接收管理员回复"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div slot="actions">
        <md-text-button onClick={onClose}>取消</md-text-button>
        {activeTab === 1 && (
          <md-filled-button 
            onClick={handleSubmitFeedback} 
            disabled={isSubmitting || !feedbackContent || !userEmail}
          >
            {isSubmitting ? '提交中...' : '提交反馈'}
          </md-filled-button>
        )}
      </div>
    </md-dialog>
  );
}
