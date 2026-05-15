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
              <input
                type="password"
                id="new_password"
                required
                value={formData.new_password}
                onChange={(e) => {
                  setFormData({ ...formData, new_password: e.target.value });
                  setError('');
                }}
                placeholder="请输入新密码"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="confirm_password">确认新密码 *</label>
              <input
                type="password"
                id="confirm_password"
                required
                value={formData.confirm_password}
                onChange={(e) => {
                  setFormData({ ...formData, confirm_password: e.target.value });
                  setError('');
                }}
                placeholder="请再次输入新密码"
              />
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
