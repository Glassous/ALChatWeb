import { useNavigate } from 'react-router-dom';
import './Auth.css';

export function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="welcome-container">
      <div className="welcome-content">
        <div className="welcome-logo-area">
          <img src="/AL_Logo.svg" alt="ALChat Logo" className="welcome-logo" />
          <h1 className="welcome-title">ALChat</h1>
        </div>
        
        <p className="welcome-subtitle">欢迎来到 ALChat</p>
        
        <div className="welcome-actions">
          <button 
            className="welcome-btn login-btn"
            onClick={() => navigate('/login')}
          >
            登录
          </button>
          
          <button 
            className="welcome-btn register-btn"
            onClick={() => navigate('/register')}
          >
            注册
          </button>
        </div>
      </div>
    </div>
  );
}
