import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar/TopBar';
import { ModalCard, modalButtonStyles, useToast } from '../components/LayerSystem/LayerSystem';
import { apiClient } from '../services/api';
import './UserSettings.css';

export function Membership() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [memberType, setMemberType] = useState('free');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const loadProfile = async () => {
    const user = await apiClient.getProfile();
    setMemberType(user.member_type || 'free'); setExpiry(user.member_expiry || null); setCredits(user.credits ?? 1000);
    localStorage.setItem('user', JSON.stringify(user));
  };
  // Profile data initializes this page after the request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadProfile().catch(error => console.error('Failed to load profile:', error)); }, []);

  const upgrade = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try { await apiClient.upgrade(code.trim()); setCode(''); await loadProfile(); setSuccess(true); window.dispatchEvent(new Event('user-profile-updated')); }
    catch (error) { showToast({ tone: 'error', message: error instanceof Error ? error.message : '升级失败' }); }
    finally { setBusy(false); }
  };

  return <div className="app-container"><div className="main-content">
    <TopBar conversationTitle="会员与额度" showBackButton onBack={() => navigate('/settings')} userMemberType={memberType} showBrand={false} />
    <div className="settings-page-container"><div className="settings-sections"><section className="settings-section"><h3 className="section-title">套餐订阅</h3><div className="subscription-card">
      <div className="subscription-status-row"><div className="status-item"><span className="label">当前等级</span><div className="value-with-badge"><img src={`/badge-${memberType}.svg`} alt={memberType} className="member-badge-large" /><span className="member-type-text">{memberType.toUpperCase()}</span></div></div><div className="status-item"><span className="label">剩余额度</span><span className="value-text">{credits?.toLocaleString()} Credits</span></div>{expiry && <div className="status-item"><span className="label">过期时间</span><span className="value-text">{new Date(expiry).toLocaleDateString()}</span></div>}</div>
      <div className="upgrade-input-wrapper"><md-outlined-text-field label="升级邀请码" value={code} onInput={(e: React.FormEvent<HTMLElement>) => setCode((e.target as HTMLInputElement).value)} placeholder="输入邀请码升级套餐" /><md-filled-button onClick={upgrade} disabled={busy || !code.trim()}>{busy ? '处理中...' : '立即升级'}</md-filled-button></div>
      <div className="subscription-benefits-grid"><div className="benefit-card"><span className="benefit-name">Free</span><span className="benefit-detail">1,000 Credit/天</span></div><div className="benefit-card pro"><span className="benefit-name">Pro</span><span className="benefit-detail">5,000 Credit/天</span></div><div className="benefit-card max"><span className="benefit-name">Max</span><span className="benefit-detail">10,000 Credit/天</span></div></div>
    </div></section></div></div>
    <ModalCard open={success} onClose={() => setSuccess(false)} size="small" ariaLabel="兑换成功" actions={<button className={modalButtonStyles.primary} onClick={() => setSuccess(false)}>太棒了</button>}><motion.div className="upgrade-success-content" initial={{ scale: .8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><h2>兑换成功！</h2><div className="success-details"><div className="success-detail-item"><span className="detail-label">当前等级</span><img src={`/badge-${memberType}.svg`} alt={memberType} className="member-badge-icon large" /></div>{expiry && <div className="success-detail-item"><span className="detail-label">有效期至</span><span className="detail-value">{new Date(expiry).toLocaleDateString()}</span></div>}</div></motion.div></ModalCard>
  </div></div>;
}
