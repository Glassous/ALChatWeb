import { useEffect, useRef } from 'react';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/divider/divider.js';
import './SearchSidebar.css';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchData {
  query: string;
  status: 'searching' | 'completed';
  results?: SearchResult[];
}

interface SearchSidebarProps {
  isOpen: boolean;
  searchData: SearchData | null;
  onClose: () => void;
}

export function SearchSidebar({ isOpen, searchData, onClose }: SearchSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = window.innerWidth <= 768;

  // Handle click outside to close on mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isMobile && isOpen && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isMobile && isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, isMobile, onClose]);

  if (!searchData) return null;

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobile && isOpen && (
        <div className="search-sidebar-backdrop" onClick={onClose} />
      )}
      
      <div 
        ref={sidebarRef}
        className={`search-sidebar ${isOpen ? 'open' : ''} ${isMobile ? 'mobile' : 'desktop'}`}
      >
        <div className="search-sidebar-header">
          <div className="header-content">
            <h2 className="search-title">搜索结果</h2>
            <p className="search-query">{searchData.query}</p>
          </div>
          <md-icon-button onClick={onClose}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </md-icon-button>
        </div>

        <div className="search-sidebar-content">
          {searchData.results && searchData.results.length > 0 ? (
            <md-list>
              {searchData.results.map((result, idx) => (
                <a 
                  key={idx} 
                  href={result.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="search-result-link"
                >
                  <md-list-item type="button" interactive>
                    <div slot="headline" className="result-header">
                      <span className="result-number">{idx + 1}</span>
                      <span className="result-title">{result.title}</span>
                    </div>
                    <div slot="supporting-text" className="result-url">{result.url}</div>
                    <div slot="supporting-text" className="result-snippet">{result.snippet}</div>
                  </md-list-item>
                </a>
              ))}
            </md-list>
          ) : (
            <div className="no-results">
              {searchData.status === 'searching' ? '正在搜索...' : '未找到相关结果'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
