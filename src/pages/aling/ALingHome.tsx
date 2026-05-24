import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '@material/web/iconbutton/icon-button.js';
import alingApi, { type ALingToolItem } from '../../services/alingApi';
import './ALingHome.css';

export function ALingHome() {
  const navigate = useNavigate();
  const [tools, setTools] = useState<ALingToolItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    alingApi.getTools()
      .then(res => {
        setTools(res.tools);
        setLoading(false);
      })
      .catch(() => {
        setTools([]);
        setLoading(false);
      });
  }, []);

  const renderToolIcon = (iconName: string) => {
    if (iconName === 'translate') {
      return (
        <svg className="aling-tool-icon" xmlns="http://www.w3.org/2000/svg" height="40px" viewBox="0 -960 960 960" width="40px" fill="currentColor">
          <path d="m476-80 182-480h84L924-80h-84l-43-122H603L560-80h-84ZM160-200l-56-56 202-202q-35-35-63.5-80T190-640h84q20 39 40 68t48 58q33-33 68.5-92.5T484-720H40v-80h280v-80h80v80h280v80H564q-21 72-63 148t-83 116l96 98-30 82-122-125-202 201Zm468-72h144l-72-204-72 204Z"/>
        </svg>
      );
    }
    // Default fallback icon
    return (
      <svg className="aling-tool-icon" xmlns="http://www.w3.org/2000/svg" height="40px" viewBox="0 -960 960 960" width="40px" fill="currentColor">
        <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm540-453h100v-107H700v107Zm0 186h100v-106H700v106ZM160-240h460v-480H160v480Zm540 0h100v-107H700v107Z"/>
      </svg>
    );
  };

  if (loading) {
    return (
      <div className="aling-page">
        <header className="aling-topbar">
          <div className="aling-topbar-left">
            <md-icon-button onClick={() => navigate('/')}>
              <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="m313-440 224 224-57 57-320-320 320-320 57 57-224 224h487v80H313Z"/>
              </svg>
            </md-icon-button>
            <h1 className="aling-topbar-title">ALing</h1>
          </div>
        </header>
        <main className="aling-main loading-container">
          <div className="aling-loading-spinner" />
        </main>
      </div>
    );
  }

  return (
    <div className="aling-page">
      <header className="aling-topbar">
        <div className="aling-topbar-left">
          <md-icon-button onClick={() => navigate('/')}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m313-440 224 224-57 57-320-320 320-320 57 57-224 224h487v80H313Z"/>
            </svg>
          </md-icon-button>
          <h1 className="aling-topbar-title">ALing</h1>
        </div>
      </header>
      <main className="aling-main">
        <div className="aling-tools-grid">
          {tools.map(tool => (
            <button
              key={tool.id}
              className="aling-tool-card"
              onClick={() => tool.enabled && navigate(tool.route)}
              disabled={!tool.enabled}
            >
              {renderToolIcon(tool.icon)}
              <div className="aling-tool-info">
                <span className="aling-tool-name">{tool.name}</span>
                <span className="aling-tool-desc">{tool.description}</span>
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
