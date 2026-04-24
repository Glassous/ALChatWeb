import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import './Auth.css';

export function ResetPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [question, setQuestion] = useState('');
  
  const [formData, setFormData] = useState({
    username: '',
    security_answer: '',
    new_password: '',
    confirm_password: '',
  });
  
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleGetQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;
    
    setIsLoading(true);
    try {
      const response = await apiClient.getSecurityQuestion(username);
      setQuestion(response.security_question);
      setFormData({ ...formData, username });
      setStep(2);
      setError('');
    } catch (err: any) {
      setError(err.message || '获取密保问题失败');
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
          <form onSubmit={handleGetQuestion} className="auth-form">
            <div className="form-group">
              <label htmlFor="username">请输入用户名</label>
              <input
                type="text"
                id="username"
                required
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                placeholder="用户名"
              />
            </div>
            
            {error && <div className="auth-error">{error}</div>}
            
            <button type="submit" className="auth-button" disabled={isLoading}>
              {isLoading ? '查询中...' : '下一步'}
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
              <label>密保问题</label>
              <div className="security-question-text">{question}</div>
            </div>
            
            <div className="form-group">
              <label htmlFor="security_answer">密保答案 *</label>
              <input
                type="text"
                id="security_answer"
                required
                value={formData.security_answer}
                onChange={(e) => {
                  setFormData({ ...formData, security_answer: e.target.value });
                  setError('');
                }}
                placeholder="请输入密保答案"
              />
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
