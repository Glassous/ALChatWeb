import { useState, useEffect } from 'react';
import styles from './AnnouncementFeedbackDialog.module.css';
import { apiClient, type Announcement } from '../../services/api';
import { ModalCard, modalButtonStyles, useToast } from '../LayerSystem/LayerSystem';

interface AnnouncementFeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: 'announcement' | 'feedback';
}

export function AnnouncementFeedbackDialog({ open, onClose, initialTab = 'announcement' }: AnnouncementFeedbackDialogProps) {
  const showToast = useToast();
  const [activeTab, setActiveTab] = useState(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnn, setLoadingAnn] = useState(false);
  const [feedbackType, setFeedbackType] = useState('bug');
  const [feedbackContent, setFeedbackContent] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setActiveTab(initialTab === 'announcement' ? 0 : 1);
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setUserEmail(user.email || '');
      }
      setLoadingAnn(true);
      try {
        const data = await apiClient.getPublicAnnouncements();
        if (!cancelled) setAnnouncements(data);
      } catch (err) {
        console.error('Failed to load announcements:', err);
      } finally {
        if (!cancelled) setLoadingAnn(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [open, initialTab]);

  const handleSubmitFeedback = async () => {
    if (!feedbackContent || !userEmail) {
      showToast({ tone: 'warning', message: '请填写反馈内容和联系邮箱' });
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
      showToast({ tone: 'success', message: '提交成功，感谢您的反馈！' });
      setFeedbackContent('');
      onClose();
    } catch (err) {
      showToast({ tone: 'error', message: `提交失败：${(err as Error).message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCard
      open={open}
      onClose={onClose}
      title="系统公告与反馈"
      size="large"
      busy={isSubmitting}
      actions={(
        <>
          <button type="button" className={modalButtonStyles.secondary} onClick={onClose} disabled={isSubmitting}>取消</button>
          {activeTab === 1 && (
            <button
              type="button"
              className={modalButtonStyles.primary}
              onClick={handleSubmitFeedback}
              disabled={isSubmitting || !feedbackContent || !userEmail}
            >
              {isSubmitting ? '提交中…' : '提交反馈'}
            </button>
          )}
        </>
      )}
    >
      <div className={styles.content}>
        <div className={styles.tabs} role="tablist" aria-label="公告与反馈">
          <button type="button" role="tab" aria-selected={activeTab === 0} className={activeTab === 0 ? styles.activeTab : styles.tab} onClick={() => setActiveTab(0)}>系统公告</button>
          <button type="button" role="tab" aria-selected={activeTab === 1} className={activeTab === 1 ? styles.activeTab : styles.tab} onClick={() => setActiveTab(1)}>意见反馈</button>
        </div>

        <div className={styles.panels}>
          {activeTab === 0 && (
            <div role="tabpanel">
              {loadingAnn ? (
                <div className={styles.state}>加载中...</div>
              ) : announcements.length > 0 ? (
                <div className={styles.announcementList}>
                  {announcements.map(ann => (
                    <article key={ann.id} className={`${styles.announcementItem} ${styles[ann.type] ?? ''}`}>
                      <div className={styles.announcementHeader}>
                        <span className={styles.announcementTitle}>{ann.title}</span>
                        <span className={styles.announcementDate}>{new Date(ann.published_at || ann.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className={styles.announcementBody}>{ann.content}</div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.state}>暂无公告</div>
              )}
            </div>
          )}

          {activeTab === 1 && (
            <div className={styles.feedbackPanel} role="tabpanel">
              <p className={styles.feedbackIntro}>欢迎向我们反馈产品问题或建议，我们会通过邮箱回复您。</p>
              
              <label className={styles.field}>
                <span>反馈类型</span>
                <select
                  value={feedbackType}
                  onChange={(event) => setFeedbackType(event.target.value)}
                >
                  <option value="bug">问题反馈 / Bug</option>
                  <option value="feature">功能建议</option>
                  <option value="other">其他</option>
                </select>
              </label>

              <label className={styles.field}>
                <span>反馈内容</span>
                <textarea
                  rows={5}
                  value={feedbackContent}
                  onChange={(event) => setFeedbackContent(event.target.value)}
                  placeholder="请详细描述您遇到的问题或建议..."
                />
              </label>

              <label className={styles.field}>
                <span>联系邮箱</span>
                <input
                  type="email"
                  value={userEmail}
                  onChange={(event) => setUserEmail(event.target.value)}
                  placeholder="用于接收管理员回复"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </ModalCard>
  );
}
