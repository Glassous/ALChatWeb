import { useState } from 'react';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/text-button.js';
import '@material/web/dialog/dialog.js';
import '@material/web/progress/circular-progress.js';
import './ShareDialog.css';
import { apiClient } from '../../services/api';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
}

export function ShareDialog({ open, onClose, conversationId }: ShareDialogProps) {
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleCreateShare = async () => {
    if (shareUrl) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.createShare(conversationId);
      const url = `${window.location.origin}/shared/${result.share_token}`;
      setShareUrl(url);
      // 自动复制到剪贴板
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.warn('Auto-copy failed:', err);
      }
    } catch (err) {
      setError('创建分享失败，请重试');
      console.error('Share creation failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setShareUrl('');
    setCopied(false);
    setError('');
    onClose();
  };

  return (
    <md-dialog open={open} onClose={handleClose}>
      <div slot="headline">分享对话</div>
      <div slot="content" className="share-dialog-content">
        {loading ? (
          <div className="share-loading">
            <md-circular-progress indeterminate />
            <span>正在生成分享链接...</span>
          </div>
        ) : error ? (
          <div className="share-error">{error}</div>
        ) : shareUrl ? (
          <div className="share-url-container">
            <input
              className="share-url-input"
              value={shareUrl}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="share-copy-btn" onClick={handleCopy}>
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
        ) : (
          <div className="share-info">
            <p>分享后，任何人都可以通过链接查看此对话内容。</p>
            <p className="share-hint">提示：如果对话被删除，分享链接将自动失效。</p>
          </div>
        )}
      </div>
      <div slot="actions">
        <md-text-button onClick={handleClose}>关闭</md-text-button>
        {!shareUrl && !loading && !error && (
          <md-filled-button onClick={handleCreateShare}>生成链接</md-filled-button>
        )}
      </div>
    </md-dialog>
  );
}
