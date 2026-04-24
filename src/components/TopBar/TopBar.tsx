import './TopBar.css';

interface TopBarProps {
  conversationTitle?: string;
}

export function TopBar({ conversationTitle }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-logo-container">
        <h1 className="topbar-title">AL Chat</h1>
      </div>
      {conversationTitle && (
        <div className="topbar-center">
          <span className="current-conversation-title">{conversationTitle}</span>
        </div>
      )}
    </header>
  );
}
