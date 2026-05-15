import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import './Auth.css';

export function ResetPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [countdown, setCountdown] = useState(0);
  
  const [formData, setFormData] = useState({
    email: '',
    code: '',
    new_password: '',
    confirm_password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleSendCode = async () => {
    if (!email) {
      setError('请输入邮箱');
      return;
    }
    setIsLoading(true);
    try {
      await apiClient.sendCode(email, 'reset');
      setFormData({ ...formData, email });
      setStep(2);
      setError('');
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setError(err.message || '获取验证码失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.new_password !== formData.confirm_password) {
      setError('两次输入的密码不一致');
      return;
    }

    setIsLoading(true);
    
    try {
      await apiClient.resetPassword(formData);
      setSuccessMsg('密码重置成功，请重新登录');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      setError(err.message || '重置密码失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/AL_Logo.svg" alt="ALChat Logo" className="auth-logo" />
          <h2>重置密码</h2>
        </div>
        
        {step === 1 ? (
          <form onSubmit={(e) => { e.preventDefault(); handleSendCode(); }} className="auth-form">
            <div className="form-group">
              <label htmlFor="email">请输入注册邮箱</label>
              <input
                type="email"
                id="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                placeholder="邮箱地址"
              />
            </div>
            
            {error && <div className="auth-error">{error}</div>}
            
            <button type="submit" className="auth-button" disabled={isLoading}>
              {isLoading ? '发送中...' : '发送验证码'}
            </button>
            
            <div className="auth-links">
              <span onClick={() => navigate('/login')} className="auth-link">
                返回登录
              </span>
            </div>
          </form>
        ) : (
          <form onSubmit={handleReset} className="auth-form">
            <div className="form-group">
              <label htmlFor="code">验证码 *</label>
              <div className="code-input-group" style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  id="code"
                  required
                  value={formData.code}
                  onChange={(e) => {
                    setFormData({ ...formData, code: e.target.value });
                    setError('');
                  }}
                  placeholder="6 位验证码"
                  style={{ flex: 1 }}
                />
                <button 
                  type="button" 
                  className="send-code-button" 
                  onClick={handleSendCode}
                  disabled={countdown > 0}
                  style={{ 
                    width: '100px', 
                    fontSize: '12px',
                    backgroundColor: countdown > 0 ? '#ccc' : '#0078d4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: countdown > 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  {countdown > 0 ? `${countdown}s` : '重发'}
                </button>
              </div>
            </div>
            
            <div className="form-group">
              <label htmlFor="new_password">新密码 *</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="new_password"
                  required
                  value={formData.new_password}
                  onChange={(e) => {
                    setFormData({ ...formData, new_password: e.target.value });
                    setError('');
                  }}
                  placeholder="请输入新密码"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.44-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            
            <div className="form-group">
              <label htmlFor="confirm_password">确认新密码 *</label>
              <div className="password-input-wrapper">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirm_password"
                  required
                  value={formData.confirm_password}
                  onChange={(e) => {
                    setFormData({ ...formData, confirm_password: e.target.value });
                    setError('');
                  }}
                  placeholder="请再次输入新密码"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.44-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            
            {error && <div className="auth-error">{error}</div>}
            {successMsg && <div className="auth-success">{successMsg}</div>}
            
            <button type="submit" className="auth-button" disabled={isLoading || !!successMsg}>
              {isLoading ? '重置中...' : '重置密码'}
            </button>
            
            <div className="auth-links">
              <span onClick={() => setStep(1)} className="auth-link">
                上一步
              </span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
