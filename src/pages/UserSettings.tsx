import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { TopBar } from '../components/TopBar/TopBar';
import { ModalCard, modalButtonStyles, useToast } from '../components/LayerSystem/LayerSystem';
import { apiClient } from '../services/api';
import getCroppedImg from '../utils/cropImage';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/button/outlined-button.js';
import '@material/web/progress/circular-progress.js';
import './UserSettings.css';

export function UserSettings() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [nickname, setNickname] = useState('');
  const [originalNickname, setOriginalNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [memberType, setMemberType] = useState('free');
  const [isUploading, setIsUploading] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProfile = useCallback(async () => {
    try {
      const user = await apiClient.getProfile();
      const name = user.nickname || user.email || '';
      setNickname(name); setOriginalNickname(name); setAvatar(user.avatar || '');
      setMemberType(user.member_type || 'free');
      localStorage.setItem('user', JSON.stringify(user));
    } catch (error) { console.error('Failed to load user profile:', error); }
  }, []);

  // Profile data initializes this page after the request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => setImageToCrop(reader.result as string));
    reader.readAsDataURL(file);
  };

  const saveAvatar = async () => {
    if (!imageToCrop || !croppedPixels) return;
    setIsUploading(true);
    try {
      const blob = await getCroppedImg(imageToCrop, croppedPixels);
      if (!blob) throw new Error('Failed to crop image');
      const response = await apiClient.updateAvatar(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      setAvatar(response.avatar); window.dispatchEvent(new Event('user-profile-updated'));
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      showToast({ tone: 'error', message: '上传头像失败，请稍后重试' });
    } finally { setIsUploading(false); setImageToCrop(null); }
  };

  const saveNickname = async () => {
    if (!nickname.trim() || nickname === originalNickname) return;
    try {
      await apiClient.updateProfile({ nickname }); setOriginalNickname(nickname);
      window.dispatchEvent(new Event('user-profile-updated'));
      showToast({ tone: 'success', message: '昵称已更新' });
    } catch (error) {
      console.error('Failed to update nickname:', error);
      showToast({ tone: 'error', message: '修改昵称失败，请稍后重试' });
    }
  };

  const logout = async () => {
    try { await apiClient.logout(); } catch (error) { console.error('Logout error:', error); }
    localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/welcome';
  };

  const entries = [
    { path: '/membership', title: '会员与额度', description: '查看套餐、剩余额度并使用邀请码升级', icon: 'M480-80 120-280v-400l360-200 360 200v400L480-80Zm0-92 280-155v-306L480-788 200-633v306l280 155Z' },
    { path: '/settings/models', title: '模型与 Hermes', description: '配置自定义模型和 Hermes Agent 连接', icon: 'M320-200h320v-80H320v80Zm-80 80q-33 0-56.5-23.5T160-200v-560q0-33 23.5-56.5T240-840h480q33 0 56.5 23.5T800-760v560q0 33-23.5 56.5T720-120H240Zm0-80h480v-560H240v560Zm80-160h320v-80H320v80Zm0-160h320v-80H320v80Z' },
    { path: '/settings/system-prompt', title: '前置提示词', description: '设置系统提示词、时间与位置信息', icon: 'M160-120v-640q0-33 23.5-56.5T240-840h480q33 0 56.5 23.5T800-760v400q0 33-23.5 56.5T720-280H320L160-120Zm126-240h434v-400H240v444l46-44Zm34-80h320v-80H320v80Zm0-120h320v-80H320v80Z' },
  ];

  return <div className="app-container"><div className="main-content">
    <TopBar conversationTitle="用户设置" showBackButton onBack={() => navigate('/')} userMemberType={memberType} showBrand={false} />
    <div className="settings-page-container"><div className="settings-sections">
      <section className="settings-section"><h3 className="section-title">个人信息</h3><div className="profile-edit-card">
        <div className="avatar-edit-wrapper"><div className="avatar-edit-container" onClick={() => fileInputRef.current?.click()}>
          {avatar ? <img src={avatar} alt="Avatar" className="avatar-large" /> : <div className="avatar-large-placeholder"><svg viewBox="0 -960 960 960"><path d="M480-480q-66 0-113-47t-47-113 47-113 113-47 113 47 47 113-47 113-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z"/></svg></div>}
          {isUploading && <div className="avatar-loading-overlay"><md-circular-progress indeterminate /></div>}<div className="avatar-hover-overlay">修改</div>
        </div><input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} hidden /><p className="avatar-hint">点击头像进行修改</p></div>
        <div className="nickname-edit-wrapper"><md-outlined-text-field label="昵称" value={nickname} onInput={(e: React.FormEvent<HTMLElement>) => setNickname((e.target as HTMLInputElement).value)} style={{ width: '100%' }}>
          {nickname !== originalNickname && nickname.trim() && <div slot="trailing-icon" className="nickname-edit-actions"><md-icon-button onClick={() => setNickname(originalNickname)} title="取消">×</md-icon-button><md-icon-button onClick={saveNickname} title="确认">✓</md-icon-button></div>}
        </md-outlined-text-field></div>
      </div></section>
      <section className="settings-section"><h3 className="section-title">功能设置</h3><div className="settings-navigation-grid">{entries.map(entry => <button key={entry.path} className="settings-navigation-card" onClick={() => navigate(entry.path)}><svg viewBox="0 -960 960 960"><path d={entry.icon}/></svg><strong>{entry.title}</strong><span>{entry.description}</span></button>)}</div></section>
      <section className="settings-section logout-section-page"><md-outlined-button className="logout-button-full" onClick={logout}>退出登录</md-outlined-button></section><div className="settings-bottom-spacer" />
    </div></div>
    <ModalCard open={!!imageToCrop} onClose={() => setImageToCrop(null)} title="裁剪头像" size="large" actions={<><button className={modalButtonStyles.secondary} onClick={() => setImageToCrop(null)}>取消</button><button className={modalButtonStyles.primary} onClick={saveAvatar}>确定</button></>}>
      {imageToCrop && <div className="crop-container"><Cropper image={imageToCrop} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCroppedPixels(pixels)} /></div>}
    </ModalCard>
  </div></div>;
}
