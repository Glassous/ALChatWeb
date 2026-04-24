import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import './Auth.css';

export function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: '',
    nickname: '',
    password: '',
    confirm_password: '',
    security_question: '',
    security_answer: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirm_password) {
      setError('两次输入的密码不一致');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.register(formData);
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
      navigate('/');
    } catch (err: any) {
      setError(err.message || '注册失败');
      if (err.message === 'Username already exists') {
        setError('用户名已存在，请重新输入');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/AL_Logo.svg" alt="ALChat Logo" className="auth-logo" />
          <h2>注册 ALChat</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="username">用户名 *</label>
            <input
              type="text"
              id="username"
              name="username"
              required
              value={formData.username}
              onChange={handleChange}
              placeholder="用于登录的唯一标识"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="nickname">昵称</label>
            <input
              type="text"
              id="nickname"
              name="nickname"
              value={formData.nickname}
              onChange={handleChange}
              placeholder="显示名称（选填）"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">密码 *</label>
            <input
              type="password"
              id="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              placeholder="请输入密码"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="confirm_password">确认密码 *</label>
            <input
              type="password"
              id="confirm_password"
              name="confirm_password"
              required
              value={formData.confirm_password}
              onChange={handleChange}
              placeholder="请再次输入密码"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="security_question">密保问题 *</label>
            <input
              type="text"
              id="security_question"
              name="security_question"
              required
              value={formData.security_question}
              onChange={handleChange}
              placeholder="例如：我最喜欢的颜色是？"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="security_answer">密保答案 *</label>
            <input
              type="text"
              id="security_answer"
              name="security_answer"
              required
              value={formData.security_answer}
              onChange={handleChange}
              placeholder="用于重置密码"
            />
          </div>
          
          {error && <div className="auth-error">{error}</div>}
          
          <button type="submit" className="auth-button" disabled={isLoading}>
            {isLoading ? '注册中...' : '注册'}
          </button>
          
          <div className="auth-links">
            <span onClick={() => navigate('/login')} className="auth-link">
              已有账号？去登录
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
