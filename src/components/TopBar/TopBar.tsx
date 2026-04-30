import '@material/web/iconbutton/icon-button.js';
import './TopBar.css';

interface TopBarProps {
  conversationTitle?: string;
  onMenuClick?: () => void;
  onNewChat?: () => void;
  showOverviewButton?: boolean;
  onOverviewClick?: () => void;
  isTreeViewOpen?: boolean;
  userMemberType?: string;
  onShowUpgrade?: () => void;
  showBackButton?: boolean;
  onBack?: () => void;
}

export function TopBar({ 
  conversationTitle, 
  onMenuClick, 
  onNewChat, 
  showOverviewButton, 
  onOverviewClick,
  isTreeViewOpen,
  userMemberType = 'free',
  onShowUpgrade,
  showBackButton,
  onBack
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {showBackButton ? (
          <md-icon-button onClick={onBack}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m313-440 224 224-57 57-320-320 320-320 57 57-224 224h487v80H313Z"/>
            </svg>
          </md-icon-button>
        ) : (
          <md-icon-button className="mobile-menu-button" onClick={onMenuClick}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z"/>
            </svg>
          </md-icon-button>
        )}
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
        {showOverviewButton && (
          <md-icon-button 
            className={`overview-button ${isTreeViewOpen ? 'active' : ''}`} 
            onClick={onOverviewClick}
            title="总览"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="M373.5-103.5Q330-147 330-210q0-52 31-91.5t79-53.5v-85H200v-160H100v-280h280v280H280v80h400v-85q-48-14-79-53.5T570-750q0-63 43.5-106.5T720-900q63 0 106.5 43.5T870-750q0 52-31 91.5T760-605v165H520v85q48 14 79 53.5t31 91.5q0 63-43.5 106.5T480-60q-63 0-106.5-43.5Zm396-597Q790-721 790-750t-20.5-49.5Q749-820 720-820t-49.5 20.5Q650-779 650-750t20.5 49.5Q691-680 720-680t49.5-20.5ZM180-680h120v-120H180v120Zm349.5 519.5Q550-181 550-210t-20.5-49.5Q509-280 480-280t-49.5 20.5Q410-239 410-210t20.5 49.5Q451-140 480-140t49.5-20.5ZM240-740Zm480-10ZM480-210Z"/>
            </svg>
          </md-icon-button>
        )}
        {userMemberType === 'free' ? (
          <button className="topbar-upgrade-btn" onClick={onShowUpgrade}>
            升级
          </button>
        ) : (
          <img
            className="topbar-member-badge"
            src={`/badge-${userMemberType}.svg`}
            alt={userMemberType}
          />
        )}
        <md-icon-button className="mobile-new-chat-button" onClick={onNewChat}>
          <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
          </svg>
        </md-icon-button>
      </div>
    </header>
  );
}
