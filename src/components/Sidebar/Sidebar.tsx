import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/fab/fab.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import './Sidebar.css';

interface SidebarProps {
  onNewChat: () => void;
}

type Theme = 'auto' | 'light' | 'dark';

export function Sidebar({ onNewChat }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('al-chat-theme') as Theme) || 'auto';
  });
  const [cardPosition, setCardPosition] = useState({ bottom: 0, left: 0 });
  const settingsButtonRef = useRef<HTMLDivElement>(null);
  const settingsCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    localStorage.setItem('al-chat-theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsCardRef.current && !settingsCardRef.current.contains(event.target as Node) &&
        settingsButtonRef.current && !settingsButtonRef.current.contains(event.target as Node)
      ) {
        setShowSettings(false);
      }
    };

    if (showSettings) {
      const updatePosition = () => {
        if (settingsButtonRef.current) {
          const rect = settingsButtonRef.current.getBoundingClientRect();
          setCardPosition({
            bottom: window.innerHeight - rect.top + 12,
            left: rect.left
          });
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', updatePosition);
      updatePosition();
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [showSettings]);

  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-top">
        <md-icon-button onClick={() => setIsExpanded(!isExpanded)}>
          <span className="icon" style={{ maskImage: 'url(/icons/menu.svg)', WebkitMaskImage: 'url(/icons/menu.svg)' }} />
        </md-icon-button>
        
        <div className="fab-container">
          <button 
            className="new-chat-button"
            onClick={onNewChat}
            aria-label="New chat"
          >
            <span className="icon" style={{ maskImage: 'url(/icons/add.svg)', WebkitMaskImage: 'url(/icons/add.svg)' }} />
            <span className="label">New chat</span>
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        <md-list className={isExpanded ? '' : 'hidden'}>
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
      </div>

      <div className="sidebar-bottom">
        <div className="settings-button-container" ref={settingsButtonRef}>
          <md-icon-button onClick={() => setShowSettings(!showSettings)}>
            <span className="icon" style={{ maskImage: 'url(/icons/settings.svg)', WebkitMaskImage: 'url(/icons/settings.svg)' }} />
          </md-icon-button>
        </div>

        {showSettings && createPortal(
          <div 
            className="settings-card" 
            ref={settingsCardRef}
            style={{ 
              position: 'fixed',
              bottom: `${cardPosition.bottom}px`,
              left: `${cardPosition.left}px`
            }}
          >
            <div className="settings-row">
              <span className="settings-label">Theme</span>
              <div className="theme-toggle-group">
                <button 
                  className={`theme-button ${theme === 'auto' ? 'active' : ''}`}
                  onClick={() => setTheme('auto')}
                  title="Auto"
                >
                  <span className="icon" style={{ maskImage: 'url(/icons/auto.svg)', WebkitMaskImage: 'url(/icons/auto.svg)' }} />
                </button>
                <button 
                  className={`theme-button ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => setTheme('light')}
                  title="Light"
                >
                  <span className="icon" style={{ maskImage: 'url(/icons/light_mode.svg)', WebkitMaskImage: 'url(/icons/light_mode.svg)' }} />
                </button>
                <button 
                  className={`theme-button ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => setTheme('dark')}
                  title="Dark"
                >
                  <span className="icon" style={{ maskImage: 'url(/icons/dark_mode.svg)', WebkitMaskImage: 'url(/icons/dark_mode.svg)' }} />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
