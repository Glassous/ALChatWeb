import '@material/web/iconbutton/icon-button.js';
import './TopBar.css';

interface TopBarProps {
  conversationTitle?: string;
  isTempChat?: boolean;
  showPromote?: boolean;
  onMenuClick?: () => void;
  onNewChat?: () => void;
  onNewTempChat?: () => void;
  onPromote?: () => void;
  onShare?: () => void;
  showShareButton?: boolean;
  showOverviewButton?: boolean;
  onOverviewClick?: () => void;
  isTreeViewOpen?: boolean;
  userMemberType?: string;
  onShowUpgrade?: () => void;
  showBackButton?: boolean;
  onBack?: () => void;
  hasMessages?: boolean;
  hasConversation?: boolean;
}

export function TopBar({ 
  conversationTitle, 
  isTempChat,
  showPromote,
  onMenuClick, 
  onNewChat, 
  onNewTempChat,
  onPromote,
  onShare,
  showShareButton,
  showOverviewButton, 
  onOverviewClick,
  isTreeViewOpen,
  userMemberType = 'free',
  onShowUpgrade,
  showBackButton,
  onBack,
  hasMessages = false,
  hasConversation = false
}: TopBarProps) {
  const showTempChatBtn = !(hasMessages && hasConversation);

  return (
    <header className={`topbar ${hasConversation ? 'has-conversation' : ''}`}>
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
              <path d="M120-240v-80h480v80H120Zm0-400v-80h720v80H120Z"/>
            </svg>
          </md-icon-button>
        )}
        <div className="topbar-logo-container">
          <h1 className="topbar-title">AL Chat</h1>
          {isTempChat && <span className="temp-badge-logo">临时对话</span>}
          {conversationTitle && (
            <div className="mobile-title-container">
              <span className="mobile-conversation-title">{conversationTitle}</span>
            </div>
          )}
        </div>
      </div>
      {conversationTitle && (
        <div className="topbar-center">
          <span className="current-conversation-title">{conversationTitle}</span>
        </div>
      )}
      <div className="topbar-right">
        {showPromote && onPromote && (
          <button className="topbar-promote-btn" onClick={onPromote}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
              <path d="M440-160v-326L337-383l-57-57 200-200 200 200-57 57-103-103v326h-80ZM160-600v-120q0-33 23.5-56.5T240-800h480q33 0 56.5 23.5T800-720v120h-80v-120H240v120h-80Z"/>
            </svg>
            转入正式对话
          </button>
        )}
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
        {showShareButton && (
          <md-icon-button
            className="share-button"
            onClick={onShare}
            title="分享对话"
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T720-200q0-17-11.5-28.5T680-240q-17 0-28.5 11.5T640-200q0 17 11.5 28.5T680-160ZM200-440q17 0 28.5-11.5T240-480q0-17-11.5-28.5T200-520q-17 0-28.5 11.5T160-480q0 17 11.5 28.5T200-440Zm508.5-291.5Q720-743 720-760t-11.5-28.5Q697-800 680-800t-28.5 11.5Q640-777 640-760t11.5 28.5Q663-720 680-720t28.5-11.5ZM680-200ZM200-480Zm480-280Z"/>
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
        {showTempChatBtn && (
          isTempChat ? (
            <md-icon-button className="temp-chat-topbar-btn" onClick={onNewChat} title="新对话">
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v340h-80v-340H160v525l46-45H660v80H240L80-80Z"/>
                <path d="M800-400v80h-80v80h80v80h80v-80h80v-80h-80v-80h-80Z"/>
              </svg>
            </md-icon-button>
          ) : (
            <md-icon-button className="temp-chat-topbar-btn" onClick={onNewTempChat} title="临时对话">
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M80-480v-160h80v160H80Zm0 400v-320h80v125l46-45h114v80h-80L80-80Zm320-160v-80h160v80H400Zm240 0v-80h160v-80h80v80q0 33-23.5 56.5T800-240H640Zm160-240v-160h80v160h-80Zm0-239v-81H640v-80h160q33 0 56.5 23.5T880-800v81h-80Zm-400-81v-80h160v80H400ZM80-719v-81q0-33 23.5-56.5T160-880h160v80H160v81H80Z"/>
              </svg>
            </md-icon-button>
          )
        )}
        <md-icon-button className="mobile-new-chat-button" onClick={onNewChat}>
          <svg className="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v340h-80v-340H160v525l46-45H660v80H240L80-80Z"/>
            <path d="M800-400v80h-80v80h80v80h80v-80h80v-80h-80v-80h-80Z"/>
          </svg>
        </md-icon-button>
      </div>
    </header>
  );
}
