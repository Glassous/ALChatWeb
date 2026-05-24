import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/dialog/dialog.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/text-button.js';
import alingApi, { type ALingTranslationHistory } from '../../services/alingApi';
import './ALingTranslator.css';

export function ALingTranslator() {
  const navigate = useNavigate();
  const [languages, setLanguages] = useState<string[]>([]);
  const [activeLang, setActiveLang] = useState<string>('');
  const [sourceText, setSourceText] = useState<string>('');
  const [targetText, setTargetText] = useState<string>('');
  const [history, setHistory] = useState<ALingTranslationHistory[]>([]);
  
  // UI states
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [showAddInput, setShowAddInput] = useState<boolean>(false);
  const [newLangName, setNewLangName] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showAllLanguagesOverlay, setShowAllLanguagesOverlay] = useState<boolean>(false);

  // Dialog states for delete confirmations and restore presets
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState<boolean>(false);
  const [pendingDeleteLanguage, setPendingDeleteLanguage] = useState<string>('');
  
  const [showDeleteHistoryConfirmDialog, setShowDeleteHistoryConfirmDialog] = useState<boolean>(false);
  const [pendingDeleteHistoryId, setPendingDeleteHistoryId] = useState<string>('');
  
  const [showRestoreConfirmDialog, setShowRestoreConfirmDialog] = useState<boolean>(false);
  
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Fetch languages and history on mount
  useEffect(() => {
    loadLanguages();
    loadHistory();
  }, []);

  // Helper to manage global dialog blur
  useEffect(() => {
    const isAnyDialogOpen = showDeleteConfirmDialog || showDeleteHistoryConfirmDialog || showRestoreConfirmDialog;
    if (isAnyDialogOpen) {
      document.body.classList.add('dialog-open-blur');
    } else {
      document.body.classList.remove('dialog-open-blur');
    }
    return () => document.body.classList.remove('dialog-open-blur');
  }, [showDeleteConfirmDialog, showDeleteHistoryConfirmDialog, showRestoreConfirmDialog]);

  const loadLanguages = async () => {
    try {
      const res = await alingApi.getTranslatorLanguages();
      setLanguages(res.languages);
      if (res.languages.length > 0 && !activeLang) {
        setActiveLang(res.languages[0]);
      }
    } catch (e) {
      console.error('Failed to load languages', e);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await alingApi.getTranslationHistory();
      setHistory(res.history);
    } catch (e) {
      console.error('Failed to load history', e);
    }
  };

  const handleAddLanguage = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLang = newLangName.trim();
    if (!cleanLang) return;
    
    // Local duplicate check
    const lowerLang = cleanLang.toLowerCase();
    if (languages.some(l => l.trim().toLowerCase() === lowerLang)) {
      setErrorMessage('该语言已存在于选择列表中，不能重复添加');
      return;
    }
    
    try {
      setErrorMessage('');
      await alingApi.addTranslatorLanguage(cleanLang);
      setNewLangName('');
      setShowAddInput(false);
      
      // Reload languages and set active
      const res = await alingApi.getTranslatorLanguages();
      setLanguages(res.languages);
      setActiveLang(cleanLang);
    } catch (err: any) {
      setErrorMessage(err.message || '添加失败');
    }
  };

  // Open confirmation modal for language deletion
  const requestDeleteLanguage = (lang: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteLanguage(lang);
    setShowDeleteConfirmDialog(true);
  };

  const confirmDeleteLanguage = async () => {
    if (!pendingDeleteLanguage) return;
    try {
      await alingApi.deleteTranslatorLanguage(pendingDeleteLanguage);
      const updatedLangs = languages.filter(l => l !== pendingDeleteLanguage);
      setLanguages(updatedLangs);
      if (activeLang === pendingDeleteLanguage) {
        setActiveLang(updatedLangs.length > 0 ? updatedLangs[0] : '');
      }
      setShowDeleteConfirmDialog(false);
      setPendingDeleteLanguage('');
    } catch (e) {
      console.error('Failed to delete language', e);
    }
  };

  const confirmRestoreLanguages = async () => {
    try {
      const res = await alingApi.resetTranslatorLanguages();
      setLanguages(res.languages);
      if (res.languages.length > 0) {
        setActiveLang(res.languages[0]);
      }
      setShowRestoreConfirmDialog(false);
    } catch (e) {
      console.error('Failed to restore languages', e);
    }
  };

  const handleTranslate = async () => {
    const textToTranslate = sourceText.trim();
    if (!textToTranslate || !activeLang || isTranslating) return;

    setIsTranslating(true);
    setTargetText('');
    
    try {
      const response = await alingApi.translateText(textToTranslate, activeLang);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      
      if (reader) {
        let accumulatedText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.type === 'token') {
                  accumulatedText += data.content;
                  setTargetText(accumulatedText);
                } else if (data.type === 'done') {
                  if (data.target_text) {
                    setTargetText(data.target_text);
                  }
                  // Reload history to show the newly saved translation
                  loadHistory();
                } else if (data.type === 'error') {
                  setTargetText(prev => prev + `\n[错误: ${data.content}]`);
                }
              } catch (e) {
                // Ignore json parse error for partial lines
              }
            }
          }
        }
      }
    } catch (err: any) {
      setTargetText(`翻译失败: ${err.message || '网络错误'}`);
    } finally {
      setIsTranslating(false);
    }
  };

  // Open confirmation modal for history deletion
  const requestDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteHistoryId(id);
    setShowDeleteHistoryConfirmDialog(true);
  };

  const confirmDeleteHistory = async () => {
    if (!pendingDeleteHistoryId) return;
    try {
      await alingApi.deleteTranslationHistory(pendingDeleteHistoryId);
      setHistory(prev => prev.filter(item => item.id !== pendingDeleteHistoryId));
      setShowDeleteHistoryConfirmDialog(false);
      setPendingDeleteHistoryId('');
    } catch (e) {
      console.error('Failed to delete history item', e);
    }
  };

  const handleLoadHistoryItem = (item: ALingTranslationHistory) => {
    setSourceText(item.source_text);
    setTargetText(item.target_text);
    if (languages.includes(item.target_lang)) {
      setActiveLang(item.target_lang);
    } else {
      // If the language was deleted but is in history, we dynamically append it or select it
      setLanguages(prev => [...prev.filter(l => l !== item.target_lang), item.target_lang]);
      setActiveLang(item.target_lang);
    }
    // Close history drawer on mobile for better UX
    if (window.innerWidth <= 768) {
      setIsHistoryOpen(false);
    }
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setSourceText(text);
      }
    } catch (err) {
      console.error('Failed to read clipboard', err);
    }
  };

  return (
    <div className="aling-translator-page">
      <header className="aling-translator-topbar">
        <div className="aling-translator-topbar-left">
          <md-icon-button onClick={() => navigate('/aling')}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m313-440 224 224-57 57-320-320 320-320 57 57-224 224h487v80H313Z"/>
            </svg>
          </md-icon-button>
          <h1 className="aling-translator-topbar-title">AL翻译</h1>
        </div>
        <div className="aling-translator-topbar-right">
          <md-icon-button onClick={() => setIsHistoryOpen(!isHistoryOpen)} aria-label="翻译历史">
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="M480-120q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q82 0 155.5 35T757-706v-74h80v220H617v-80h108q-41-62-108-96T480-760q-117 0-198.5 81.5T200-480q0 117 81.5 198.5T480-200q117 0 198.5-81.5T760-480h80q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm40-394L374-660l56-56 110 110v186h-80v-94Z"/>
            </svg>
          </md-icon-button>
        </div>
      </header>

      <div className="aling-translator-workspace">
        <main className={`aling-translator-main ${isHistoryOpen ? 'history-open' : ''}`}>
          <div className="translator-boxes-container">
            {/* Source Input Box */}
            <div className="translator-box source-box">
              <div className="translator-box-header">
                <span className="box-header-title">原文 (语种自动检测)</span>
                <div className="header-actions">
                  <button className="paste-btn" onClick={handlePaste} title="从剪贴板粘贴">
                    粘贴
                  </button>
                  {sourceText && (
                    <button className="clear-btn" onClick={() => { setSourceText(''); setTargetText(''); }} title="清空文本">
                      清空
                    </button>
                  )}
                </div>
              </div>
              <textarea
                className="translator-textarea"
                placeholder="在此输入需要翻译的文本..."
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                maxLength={5000}
              />
              <div className="translator-box-footer">
                <span className="char-counter">{sourceText.length}/5000</span>
                <div className="footer-actions">
                  <button 
                    className="action-icon-btn" 
                    onClick={() => copyToClipboard(sourceText)} 
                    disabled={!sourceText}
                    title="复制原文"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                      <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
                    </svg>
                  </button>
                  <button 
                    className="translate-btn" 
                    onClick={handleTranslate} 
                    disabled={!sourceText.trim() || !activeLang || isTranslating}
                  >
                    {isTranslating ? '翻译中...' : '翻译'}
                  </button>
                </div>
              </div>
            </div>

            {/* Target Output Box */}
            <div className={`translator-box target-box ${isTranslating ? 'pulse-border' : ''}`}>
              <div className="translator-box-header languages-header">
                <div className="languages-scroll-container">
                  {languages.map((lang) => (
                    <div 
                      key={lang} 
                      className={`lang-pill ${activeLang === lang ? 'active' : ''}`}
                      onClick={() => setActiveLang(lang)}
                    >
                      <span>{lang}</span>
                      <button 
                        className="delete-lang-btn" 
                        onClick={(e) => requestDeleteLanguage(lang, e)}
                        title={`删除 ${lang}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor">
                          <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                  
                  {!showAllLanguagesOverlay && (
                    showAddInput ? (
                      <form onSubmit={handleAddLanguage} className="add-lang-form">
                        <input 
                          type="text" 
                          className="add-lang-input"
                          placeholder="新语言名..."
                          value={newLangName}
                          onChange={(e) => setNewLangName(e.target.value)}
                          autoFocus
                          onBlur={() => {
                            setTimeout(() => {
                              setShowAddInput(false);
                              setNewLangName('');
                              setErrorMessage('');
                            }, 200);
                          }}
                        />
                      </form>
                    ) : (
                      <button 
                        className="add-lang-btn-pill" 
                        onClick={() => setShowAddInput(true)}
                        title="添加目标语言"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor">
                          <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
                        </svg>
                      </button>
                    )
                  )}
                </div>
                
                <button 
                  className="expand-languages-btn"
                  onClick={() => setShowAllLanguagesOverlay(!showAllLanguagesOverlay)}
                  title={showAllLanguagesOverlay ? "收起" : "展开语言列表"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                    <path d={showAllLanguagesOverlay ? "m296-344-56-56 240-240 240 240-56 56-184-184-184 184Z" : "m480-340-240-240 56-56 184 184 184-184 56 56-240 240Z"}/>
                  </svg>
                </button>
              </div>
              
              {errorMessage && <div className="lang-error-msg">{errorMessage}</div>}

              <div className="output-container">
                {showAllLanguagesOverlay ? (
                  /* Overlay covering the entire output card */
                  <div className="all-languages-overlay">
                    <h3 className="overlay-title">全部目标语言</h3>
                    <div className="all-languages-grid">
                      {languages.map((lang) => (
                        <div 
                          key={lang} 
                          className={`lang-pill ${activeLang === lang ? 'active' : ''}`}
                          onClick={() => {
                            setActiveLang(lang);
                            setShowAllLanguagesOverlay(false);
                          }}
                        >
                          <span>{lang}</span>
                          <button 
                            className="delete-lang-btn" 
                            onClick={(e) => requestDeleteLanguage(lang, e)}
                            title={`删除 ${lang}`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor">
                              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                      
                      {showAddInput ? (
                        <form onSubmit={handleAddLanguage} className="add-lang-form">
                          <input 
                            type="text" 
                            className="add-lang-input"
                            placeholder="新语言名..."
                            value={newLangName}
                            onChange={(e) => setNewLangName(e.target.value)}
                            autoFocus
                            onBlur={() => {
                              setTimeout(() => {
                                setShowAddInput(false);
                                setNewLangName('');
                                setErrorMessage('');
                              }, 200);
                            }}
                          />
                        </form>
                      ) : (
                        <button 
                          className="add-lang-btn-pill" 
                          onClick={() => setShowAddInput(true)}
                          title="添加目标语言"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor">
                            <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
                          </svg>
                          <span style={{ fontSize: '12px', marginLeft: '4px' }}>添加</span>
                        </button>
                      )}
                    </div>
                    
                    <div className="overlay-actions-row">
                      <button 
                        className="restore-presets-btn" 
                        onClick={() => setShowRestoreConfirmDialog(true)}
                        title="恢复为预设语言"
                      >
                        恢复预设
                      </button>
                      <button 
                        className="overlay-close-btn" 
                        onClick={() => setShowAllLanguagesOverlay(false)}
                      >
                        收起
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea
                      className="translator-textarea readonly-textarea"
                      placeholder="翻译结果将在此处显示..."
                      value={targetText}
                      readOnly
                    />
                    {isTranslating && (
                      <div className="loading-dots-container">
                        <span className="loading-dot"></span>
                        <span className="loading-dot"></span>
                        <span className="loading-dot"></span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {!showAllLanguagesOverlay && (
                <div className="translator-box-footer">
                  <div ref={outputEndRef} />
                  <button 
                    className="action-icon-btn" 
                    onClick={() => copyToClipboard(targetText)} 
                    disabled={!targetText || isTranslating}
                    title="复制译文"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                      <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Translation History Drawer */}
        <aside className={`aling-translator-sidebar ${isHistoryOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <h3>历史记录</h3>
            <button className="sidebar-close-btn" onClick={() => setIsHistoryOpen(false)}>
              <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
              </svg>
            </button>
          </div>
          <div className="history-list-container">
            {history.length === 0 ? (
              <div className="empty-history">暂无历史记录</div>
            ) : (
              history.map((item) => (
                <div 
                  key={item.id} 
                  className="history-item"
                  onClick={() => handleLoadHistoryItem(item)}
                >
                  <div className="history-item-meta">
                    <span className="history-lang-badge">{item.target_lang}</span>
                    <span className="history-time">
                      {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  
                  {/* Double preview showing both source and target previews */}
                  <div className="history-item-preview">
                    <div className="preview-source">原文: {item.source_text}</div>
                    <div className="preview-target">译文: {item.target_text}</div>
                  </div>
                  
                  <button 
                    className="delete-history-btn" 
                    onClick={(e) => requestDeleteHistory(item.id, e)}
                    title="删除记录"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
                      <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* Confirmation Dialogs Portal */}
      {createPortal(
        <>
          {showDeleteConfirmDialog && (
            <md-dialog open={showDeleteConfirmDialog} onClose={() => { setShowDeleteConfirmDialog(false); setPendingDeleteLanguage(''); }}>
              <div slot="headline">删除语言</div>
              <div slot="content">确定要从列表中删除语言“{pendingDeleteLanguage}”吗？</div>
              <div slot="actions">
                <md-text-button onClick={() => { setShowDeleteConfirmDialog(false); setPendingDeleteLanguage(''); }}>取消</md-text-button>
                <md-filled-button 
                  onClick={confirmDeleteLanguage}
                  style={{ '--md-filled-button-container-color': '#ba1a1a', '--md-filled-button-label-text-color': '#ffffff' }}
                >
                  删除
                </md-filled-button>
              </div>
            </md-dialog>
          )}

          {showDeleteHistoryConfirmDialog && (
            <md-dialog open={showDeleteHistoryConfirmDialog} onClose={() => { setShowDeleteHistoryConfirmDialog(false); setPendingDeleteHistoryId(''); }}>
              <div slot="headline">删除历史记录</div>
              <div slot="content">确定要永久删除此条翻译历史记录吗？</div>
              <div slot="actions">
                <md-text-button onClick={() => { setShowDeleteHistoryConfirmDialog(false); setPendingDeleteHistoryId(''); }}>取消</md-text-button>
                <md-filled-button 
                  onClick={confirmDeleteHistory}
                  style={{ '--md-filled-button-container-color': '#ba1a1a', '--md-filled-button-label-text-color': '#ffffff' }}
                >
                  删除
                </md-filled-button>
              </div>
            </md-dialog>
          )}

          {showRestoreConfirmDialog && (
            <md-dialog open={showRestoreConfirmDialog} onClose={() => setShowRestoreConfirmDialog(false)}>
              <div slot="headline">恢复预设语言</div>
              <div slot="content">确定要将目标语言列表恢复为默认预设吗？这将重置您所有的自定义语言。</div>
              <div slot="actions">
                <md-text-button onClick={() => setShowRestoreConfirmDialog(false)}>取消</md-text-button>
                <md-filled-button onClick={confirmRestoreLanguages}>恢复</md-filled-button>
              </div>
            </md-dialog>
          )}
        </>,
        document.body
      )}
    </div>
  );
}
