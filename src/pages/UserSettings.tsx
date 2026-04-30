import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar/TopBar';
import Cropper from 'react-easy-crop';
import type { Point, Area } from 'react-easy-crop';
import { motion } from 'framer-motion';
import { apiClient } from '../services/api';
import getCroppedImg from '../utils/cropImage';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/dialog/dialog.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/progress/circular-progress.js';
import './UserSettings.css';

export function UserSettings() {
  const navigate = useNavigate();
  const [userNickname, setUserNickname] = useState('');
  const [originalNickname, setOriginalNickname] = useState('');
  const [userAvatar, setUserAvatar] = useState('');
  const [userMemberType, setUserMemberType] = useState('free');
  const [userMemberExpiry, setUserMemberExpiry] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState<number | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [includeDateTime, setIncludeDateTime] = useState(false);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [isSavingSystemPrompt, setIsSavingSystemPrompt] = useState(false);
  const [isLoadingSystemPrompt, setIsLoadingSystemPrompt] = useState(true);
  const [invitationCode, setInvitationCode] = useState('');
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [showUpgradeSuccess, setShowUpgradeSuccess] = useState(false);
  const [upgradeInfo, setUpgradeInfo] = useState<{ type: string; expiry: string | null } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadUserProfile();
    loadSystemPrompt();
    const handleProfileUpdate = () => loadUserProfile();
    window.addEventListener('user-profile-updated', handleProfileUpdate);
    return () => window.removeEventListener('user-profile-updated', handleProfileUpdate);
  }, []);

  const loadUserProfile = async () => {
    try {
      const user = await apiClient.getProfile();
      setUserNickname(user.nickname || user.username || '');
      setOriginalNickname(user.nickname || user.username || '');
      setUserAvatar(user.avatar || '');
      setUserMemberType(user.member_type || 'free');
      setUserMemberExpiry(user.member_expiry || null);
      setUserCredits(user.credits ?? 1000);
      localStorage.setItem('user', JSON.stringify(user));
    } catch (error) {
      console.error('Failed to load user profile:', error);
    }
  };

  const loadSystemPrompt = async () => {
    setIsLoadingSystemPrompt(true);
    try {
      const data = await apiClient.getSystemPrompt();
      setSystemPrompt(data.system_prompt || '');
      setIncludeDateTime(data.include_datetime || false);
      setIncludeLocation(data.include_location || false);
    } catch (error) {
      console.error('Failed to load system prompt:', error);
    } finally {
      setIsLoadingSystemPrompt(false);
    }
  };

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setImageToCrop(reader.result as string);
      setIsCropping(true);
    });
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_: Area, _croppedAreaPixels: Area) => {
    setCroppedAreaPixels(_croppedAreaPixels);
  }, []);

  const handleConfirmCrop = async () => {
    if (!imageToCrop || !croppedAreaPixels) return;
    setIsUploadingAvatar(true);
    setIsCropping(false);
    try {
      const croppedBlob = await getCroppedImg(imageToCrop, croppedAreaPixels);
      if (!croppedBlob) throw new Error('Failed to crop image');
      const croppedFile = new File([croppedBlob], 'avatar.jpg', { type: 'image/jpeg' });
      const response = await apiClient.updateAvatar(croppedFile);
      setUserAvatar(response.avatar);
      window.dispatchEvent(new Event('user-profile-updated'));
    } catch (error) {
      console.error('Failed to upload avatar', error);
      alert('上传头像失败，请稍后重试');
    } finally {
      setIsUploadingAvatar(false);
      setImageToCrop(null);
    }
  };

  const handleUpdateNickname = async () => {
    if (!userNickname.trim() || userNickname === originalNickname) return;
    try {
      await apiClient.updateProfile({ nickname: userNickname });
      setOriginalNickname(userNickname);
      window.dispatchEvent(new Event('user-profile-updated'));
    } catch (error) {
      console.error('Failed to update nickname', error);
      alert('修改昵称失败，请稍后重试');
    }
  };

  const handleSaveSystemPrompt = async () => {
    setIsSavingSystemPrompt(true);
    try {
      await apiClient.updateSystemPrompt({
        system_prompt: systemPrompt,
        include_datetime: includeDateTime,
        include_location: includeLocation
      });
      alert('系统提示词已保存');
    } catch (error) {
      console.error('Failed to save system prompt', error);
      alert('保存失败，请重试');
    } finally {
      setIsSavingSystemPrompt(false);
    }
  };

  const handleUpgrade = async () => {
    if (!invitationCode.trim()) return;
    setIsUpgrading(true);
    try {
      await apiClient.upgrade(invitationCode.trim());
      setInvitationCode('');
      const user = await apiClient.getProfile();
      setUpgradeInfo({ type: user.member_type || 'free', expiry: user.member_expiry || null });
      setShowUpgradeSuccess(true);
      window.dispatchEvent(new Event('user-profile-updated'));
    } catch (error: any) {
      alert(error.message || '升级失败');
    } finally {
      setIsUpgrading(false);
    }
  };

  return (
    <div className="app-container">
      <div className="main-content">
        <TopBar 
          conversationTitle="用户设置"
          showBackButton={true}
          onBack={() => navigate('/')}
          userMemberType={userMemberType}
        />
        <div className="settings-page-container">
          <div className="settings-sections">
            {/* User Profile Section */}
            <section className="settings-section">
              <h3 className="section-title">个人信息</h3>
              <div className="profile-edit-card">
                <div className="avatar-edit-wrapper">
                  <div className="avatar-edit-container" onClick={handleAvatarClick}>
                    {userAvatar ? (
                      <img src={userAvatar} alt="Avatar" className="avatar-large" />
                    ) : (
                      <div className="avatar-large-placeholder">
                        <svg xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 -960 960 960" width="48px" fill="currentColor">
                          <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z"/>
                        </svg>
                      </div>
                    )}
                    {isUploadingAvatar && (
                      <div className="avatar-loading-overlay">
                        <md-circular-progress indeterminate style={{ '--md-circular-progress-size': '40px' }} />
                      </div>
                    )}
                    <div className="avatar-hover-overlay">
                      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                        <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
                      </svg>
                    </div>
                  </div>
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" style={{ display: 'none' }} />
                  <p className="avatar-hint">点击头像进行修改</p>
                </div>
                <div className="nickname-edit-wrapper">
                  <md-outlined-text-field
                    label="昵称"
                    value={userNickname}
                    onInput={(e: React.FormEvent<HTMLInputElement>) => setUserNickname((e.target as HTMLInputElement).value)}
                    style={{ width: '100%' }}
                  >
                    {userNickname !== originalNickname && userNickname.trim() && (
                      <div slot="trailing-icon" className="nickname-edit-actions">
                        <md-icon-button onClick={() => setUserNickname(originalNickname)} title="取消">
                          <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                          </svg>
                        </md-icon-button>
                        <md-icon-button onClick={handleUpdateNickname} title="确认">
                          <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                            <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
                          </svg>
                        </md-icon-button>
                      </div>
                    )}
                  </md-outlined-text-field>
                </div>
              </div>
            </section>

            {/* Subscription Section */}
            <section className="settings-section">
              <h3 className="section-title">套餐订阅</h3>
              <div className="subscription-card">
                <div className="subscription-status-row">
                  <div className="status-item">
                    <span className="label">当前等级</span>
                    <div className="value-with-badge">
                      <img src={`/badge-${userMemberType}.svg`} alt={userMemberType} className="member-badge-large" />
                      <span className="member-type-text">{userMemberType.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="status-item">
                    <span className="label">剩余额度</span>
                    <span className="value-text">{userCredits?.toLocaleString()} Credits</span>
                  </div>
                  {userMemberExpiry && (
                    <div className="status-item">
                      <span className="label">过期时间</span>
                      <span className="value-text">{new Date(userMemberExpiry).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                
                <div className="upgrade-input-wrapper">
                  <md-outlined-text-field
                    label="升级邀请码"
                    value={invitationCode}
                    onInput={(e: React.FormEvent<HTMLInputElement>) => setInvitationCode((e.target as HTMLInputElement).value)}
                    placeholder="输入邀请码升级套餐"
                    style={{ flex: 1 }}
                  />
                  <md-filled-button onClick={handleUpgrade} disabled={isUpgrading || !invitationCode.trim()}>
                    {isUpgrading ? '处理中...' : '立即升级'}
                  </md-filled-button>
                </div>
                
                <div className="subscription-benefits-grid">
                  <div className="benefit-card">
                    <span className="benefit-name">Free</span>
                    <span className="benefit-detail">1,000 Credit/天</span>
                  </div>
                  <div className="benefit-card pro">
                    <span className="benefit-name">Pro</span>
                    <span className="benefit-detail">5,000 Credit/天</span>
                  </div>
                  <div className="benefit-card max">
                    <span className="benefit-name">Max</span>
                    <span className="benefit-detail">10,000 Credit/天</span>
                  </div>
                </div>
              </div>
            </section>

            {/* System Prompt Section */}
            <section className="settings-section">
              <h3 className="section-title">前置提示词</h3>
              <div className="prompt-config-card">
                {isLoadingSystemPrompt ? (
                  <div className="section-loading">
                    <md-circular-progress indeterminate />
                  </div>
                ) : (
                  <>
                    <md-outlined-text-field
                      type="textarea"
                      label="自定义前置提示词"
                      rows={8}
                      value={systemPrompt}
                      onInput={(e: React.FormEvent<HTMLInputElement>) => setSystemPrompt((e.target as HTMLInputElement).value)}
                      style={{ width: '100%' }}
                    />
                    <div className="prompt-options-row">
                      <div 
                        className={`prompt-option-chip ${includeDateTime ? 'active' : ''}`}
                        onClick={() => setIncludeDateTime(!includeDateTime)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
                          <path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Z"/>
                        </svg>
                        <span>包含日期和时间</span>
                      </div>
                      <div 
                        className={`prompt-option-chip ${includeLocation ? 'active' : ''}`}
                        onClick={() => setIncludeLocation(!includeLocation)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
                          <path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 400Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 115-79.5 232.5T480-80Z"/>
                        </svg>
                        <span>包含地理位置</span>
                      </div>
                    </div>
                    <div className="prompt-save-actions">
                      <md-filled-button onClick={handleSaveSystemPrompt} disabled={isSavingSystemPrompt}>
                        {isSavingSystemPrompt ? '保存中...' : '保存配置'}
                      </md-filled-button>
                    </div>
                  </>
                )}
              </div>
            </section>
            
            <section className="settings-section logout-section-page">
              <md-outlined-button 
                onClick={() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                  window.location.href = '/welcome';
                }}
                className="logout-button-full"
              >
                退出登录
              </md-outlined-button>
            </section>
            
            {/* Spacer for bottom padding */}
            <div className="settings-bottom-spacer"></div>
          </div>
        </div>
      </div>

      {/* Shared Dialogs */}
      {isCropping && imageToCrop && (
        <md-dialog open={isCropping} onClose={() => setIsCropping(false)} className="crop-dialog">
          <div slot="headline">裁剪头像</div>
          <div slot="content" className="crop-container">
            <Cropper
              image={imageToCrop}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          </div>
          <div slot="actions">
            <md-text-button onClick={() => { setIsCropping(false); setImageToCrop(null); }}>取消</md-text-button>
            <md-filled-button onClick={handleConfirmCrop}>确定</md-filled-button>
          </div>
        </md-dialog>
      )}

      {showUpgradeSuccess && upgradeInfo && (
        <md-dialog open={showUpgradeSuccess} onClose={() => setShowUpgradeSuccess(false)} className="upgrade-success-dialog">
          <div slot="content" className="upgrade-success-content">
            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
            >
              <div className="success-icon-wrapper">
                <svg viewBox="0 0 52 52" className="success-check-svg">
                  <circle className="success-check-circle" cx="26" cy="26" r="25" fill="none"/>
                  <path className="success-check-path" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
              </div>
              <h2>兑换成功！</h2>
              <div className="success-details">
                <div className="success-detail-item">
                  <span className="detail-label">当前等级</span>
                  <img src={`/badge-${upgradeInfo.type}.svg`} alt={upgradeInfo.type} className="member-badge-icon large" />
                </div>
                {upgradeInfo.expiry && (
                  <div className="success-detail-item">
                    <span className="detail-label">有效期至</span>
                    <span className="detail-value">{new Date(upgradeInfo.expiry).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
          <div slot="actions">
            <md-filled-button onClick={() => setShowUpgradeSuccess(false)}>太棒了</md-filled-button>
          </div>
        </md-dialog>
      )}
    </div>
  );
}
