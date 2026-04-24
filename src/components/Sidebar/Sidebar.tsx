import { useState } from 'react';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/fab/fab.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import './Sidebar.css';

interface SidebarProps {
  onNewChat: () => void;
}

export function Sidebar({ onNewChat }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-top">
        <md-icon-button onClick={() => setIsExpanded(!isExpanded)}>
          <span className="icon" style={{ maskImage: 'url(/icons/menu.svg)', WebkitMaskImage: 'url(/icons/menu.svg)' }} />
        </md-icon-button>
        
        <div className="fab-container">
          <button 
            className={`new-chat-button ${isExpanded ? 'expanded' : 'collapsed'}`}
            onClick={onNewChat}
            aria-label="New chat"
          >
            <span className="icon" style={{ maskImage: 'url(/icons/add.svg)', WebkitMaskImage: 'url(/icons/add.svg)' }} />
            {isExpanded && <span className="label">New chat</span>}
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {isExpanded && (
          <md-list>
            <md-list-item className="history-item">
              <div slot="headline">Project Alpha</div>
            </md-list-item>
            <md-list-item className="history-item">
              <div slot="headline">Project Beta</div>
            </md-list-item>
            <md-list-item className="history-item">
              <div slot="headline">Research notes</div>
            </md-list-item>
          </md-list>
        )}
      </div>

      <div className="sidebar-bottom">
        <md-icon-button>
          <span className="icon" style={{ maskImage: 'url(/icons/settings.svg)', WebkitMaskImage: 'url(/icons/settings.svg)' }} />
        </md-icon-button>
      </div>
    </div>
  );
}
