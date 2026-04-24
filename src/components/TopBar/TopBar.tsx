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
          <span className="icon" style={{ maskImage: 'url(/icons/menu.svg)', WebkitMaskImage: 'url(/icons/menu.svg)' }} />
        </md-icon-button>
        <div className="topbar-logo-container">
          <h1 className="topbar-title">AL Chat</h1>
          {conversationTitle && (
            <span className="mobile-conversation-title">{conversationTitle}</span>
          )}
        </div>
      </div>
      {conversationTitle && (
        <div className="topbar-center">
          <span className="current-conversation-title">{conversationTitle}</span>
        </div>
      )}
      <div className="topbar-right">
        <md-icon-button className="mobile-new-chat-button" onClick={onNewChat}>
          <span className="icon" style={{ maskImage: 'url(/icons/add.svg)', WebkitMaskImage: 'url(/icons/add.svg)' }} />
        </md-icon-button>
      </div>
    </header>
  );
}
