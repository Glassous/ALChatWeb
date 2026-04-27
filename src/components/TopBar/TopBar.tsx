import '@material/web/iconbutton/icon-button.js';
import './TopBar.css';

interface TopBarProps {
  conversationTitle?: string;
  onMenuClick?: () => void;
  onNewChat?: () => void;
}

export function TopBar({ conversationTitle, onMenuClick, onNewChat }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <md-icon-button className="mobile-menu-button" onClick={onMenuClick}>
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z"/>
          </svg>
        </md-icon-button>
        <div className="topbar-logo-container">
          <h1 className="topbar-title">AL Chat</h1>
          {conversationTitle && (
            <span key={conversationTitle} className="mobile-conversation-title">{conversationTitle}</span>
          )}
        </div>
      </div>
      {conversationTitle && (
        <div className="topbar-center">
          <span key={conversationTitle} className="current-conversation-title">{conversationTitle}</span>
        </div>
      )}
      <div className="topbar-right">
        <md-icon-button className="mobile-new-chat-button" onClick={onNewChat}>
          <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
          </svg>
        </md-icon-button>
      </div>
    </header>
  );
}
