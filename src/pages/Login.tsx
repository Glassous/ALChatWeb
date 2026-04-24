import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import './Auth.css';

export function Login() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await apiClient.login(formData);
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
      navigate('/');
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/AL_Logo.svg" alt="ALChat Logo" className="auth-logo" />
          <h2>登录 ALChat</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="username">用户名</label>
            <input
              type="text"
              id="username"
              name="username"
              required
              value={formData.username}
              onChange={handleChange}
              placeholder="请输入用户名"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">密码</label>
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
          
          {error && <div className="auth-error">{error}</div>}
          
          <button type="submit" className="auth-button" disabled={isLoading}>
            {isLoading ? '登录中...' : '登录'}
          </button>
          
          <div className="auth-links">
            <span onClick={() => navigate('/register')} className="auth-link">
              注册账号
            </span>
            <span onClick={() => navigate('/reset-password')} className="auth-link">
              忘记密码？
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
