import { useState, useEffect, useRef } from 'react';
import '@material/web/dialog/dialog.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/text-button.js';
import '@material/web/switch/switch.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/textfield/outlined-text-field.js';
import { apiClient, type ThemeConfig, type ThemePreset } from '../../services/api';
import './ThemeSettingsDialog.css';

interface ThemeSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialConfig?: ThemeConfig;
  onConfigUpdated: (config: ThemeConfig) => void;
}

const SYSTEM_PRESETS: ThemePreset[] = [
  { id: 'pink', name: '粉红', value: 'linear-gradient(90deg, #ff7eb3 0%, #ff758c 100%)', type: 'gradient' },
  { id: 'neon', name: '霓虹', value: 'linear-gradient(90deg, #00f2fe 0%, #4facfe 100%)', type: 'gradient' },
];

type ViewState = 'main' | 'divider' | 'color-editor';

export function ThemeSettingsDialog({ open, onClose, initialConfig, onConfigUpdated }: ThemeSettingsDialogProps) {
  const [config, setConfig] = useState<ThemeConfig>(initialConfig || {
    enabled: false,
    custom_presets: [],
    divider: {
      type: 'color',
      value: 'var(--border-color)',
      preset: 'none'
    }
  });
  
  const [view, setView] = useState<ViewState>('main');
  const [isSaving, setIsSaving] = useState(false);
  const dialogRef = useRef<any>(null);
  
  // Color Editor State
  const [color1, setColor1] = useState('#ff7eb3');
  const [color2, setColor2] = useState('#ff758c');
  const [isGradient, setIsGradient] = useState(true);
  const [presetName, setPresetName] = useState('');

  const getNextDefaultName = (presets: ThemePreset[]) => {
    let maxN = 0;
    const regex = /^自定义(\d+)$/;
    presets.forEach(p => {
      const match = p.name.match(regex);
      if (match) {
        const n = parseInt(match[1]);
        if (n > maxN) maxN = n;
      }
    });
    return `自定义${maxN + 1}`;
  };

  useEffect(() => {
    if (initialConfig) {
      setConfig({
        ...initialConfig,
        custom_presets: initialConfig.custom_presets || []
      });
    }
  }, [initialConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiClient.updateTheme(config);
      onConfigUpdated(config);
      onClose();
    } catch (error) {
      console.error('Failed to save theme settings:', error);
      alert('保存主题设置失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = (e: any) => {
    setConfig(prev => ({ ...prev, enabled: e.target.selected }));
  };

  const selectPreset = (preset: ThemePreset) => {
    setConfig(prev => ({
      ...prev,
      divider: {
        preset: preset.id,
        value: preset.value,
        type: preset.type
      }
    }));
  };

  const deleteCustomPreset = (e: React.MouseEvent, presetId: string) => {
    e.stopPropagation();
    setConfig(prev => {
      const newPresets = (prev.custom_presets || []).filter(p => p.id !== presetId);
      let newDivider = { ...prev.divider };
      
      if (prev.divider.preset === presetId) {
        newDivider = {
          type: 'color',
          value: 'var(--border-color)',
          preset: 'none'
        };
      }
      
      return {
        ...prev,
        custom_presets: newPresets,
        divider: newDivider
      };
    });
  };

  const confirmAddColor = () => {
    const value = isGradient ? `linear-gradient(90deg, ${color1} 0%, ${color2} 100%)` : color1;
    const newId = `custom-${Date.now()}`;
    const newPreset: ThemePreset = {
      id: newId,
      name: presetName || (isGradient ? '自定义渐变' : '自定义颜色'),
      value: value,
      type: isGradient ? 'gradient' : 'color'
    };

    setConfig(prev => ({
      ...prev,
      custom_presets: [...(prev.custom_presets || []), newPreset],
      divider: {
        preset: newId,
        value: value,
        type: isGradient ? 'gradient' : 'color'
      }
    }));
    setView('divider');
  };

  const allPresets = [...SYSTEM_PRESETS, ...(config.custom_presets || [])];

  const handleHexChange = (val: string, setter: (v: string) => void) => {
    if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
      setter(val);
    }
  };

  // Sync open state with native dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      if (open && !dialog.open) {
        if (typeof dialog.show === 'function') {
          dialog.show();
        } else {
          dialog.open = true;
        }
      } else if (!open && dialog.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.open = false;
        }
      }
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClosed = () => {
      setView('main');
      onClose();
    };

    dialog.addEventListener('closed', handleClosed);
    return () => dialog.removeEventListener('closed', handleClosed);
  }, [onClose]);

  return (
    <md-dialog 
      ref={dialogRef}
      className="theme-settings-dialog"
    >
      <div slot="headline" className="dialog-headline">
        {view !== 'main' && (
          <md-icon-button onClick={() => setView(view === 'color-editor' ? 'divider' : 'main')} className="back-button">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </md-icon-button>
        )}
        <span>
          {view === 'main' && '个性装扮'}
          {view === 'divider' && '分割线主题'}
          {view === 'color-editor' && '新增颜色'}
        </span>
      </div>
      
      <div slot="content" className="theme-settings-content">
        {view === 'main' && (
          <div className="view-container main-view">
            <div className="theme-setting-item">
              <div className="setting-label-container">
                <span className="setting-label">开启个性装扮</span>
                <span className="setting-description">开启后应用自定义分割线等装饰</span>
              </div>
              <md-switch 
                selected={config.enabled} 
                onInput={handleToggleEnabled}
              ></md-switch>
            </div>

            {config.enabled && (
              <div className="menu-list">
                <div className="menu-item" onClick={() => setView('divider')}>
                  <div className="menu-item-info">
                    <span className="menu-item-label">分割线装饰</span>
                    <span className="menu-item-value">
                      {allPresets.find(p => p.id === config.divider.preset)?.name || '未设置'}
                    </span>
                  </div>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'divider' && (
          <div className="view-container divider-view">
            <div className="theme-section">
              <div className="preset-grid">
                {allPresets.map(preset => (
                  <div 
                    key={preset.id}
                    className={`preset-item ${config.divider.preset === preset.id ? 'active' : ''}`}
                    onClick={() => selectPreset(preset)}
                  >
                    <div className="preset-preview" style={{ background: preset.value }}>
                      {preset.id.startsWith('custom-') && (
                        <div className="delete-preset-btn" onClick={(e) => deleteCustomPreset(e, preset.id)}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <span className="preset-name">{preset.name}</span>
                  </div>
                ))}
                <div className="preset-item add-preset" onClick={() => {
                  setPresetName(getNextDefaultName(config.custom_presets || []));
                  setView('color-editor');
                }}>
                  <div className="preset-preview add-preview">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                  </div>
                  <span className="preset-name">新增颜色</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'color-editor' && (
          <div className="view-container color-editor-view">
            <div className="preview-card" style={{ background: isGradient ? `linear-gradient(90deg, ${color1} 0%, ${color2} 100%)` : color1 }}>
              <span className="preview-label">效果预览</span>
            </div>

            <div className="editor-controls">
              <div className="name-input-section">
                <md-outlined-text-field
                  label="装扮名称"
                  value={presetName}
                  onInput={(e: any) => setPresetName(e.target.value)}
                  className="preset-name-field"
                ></md-outlined-text-field>
              </div>

              <div className="type-toggle">
                <span className="setting-label">渐变模式</span>
                <md-switch selected={isGradient} onInput={(e: any) => setIsGradient(e.target.selected)}></md-switch>
              </div>

              <div className="color-inputs-grid">
                <div className="color-input-group">
                  <label className="input-label">颜色 {isGradient ? '1' : ''}</label>
                  <div className="custom-color-picker-row">
                    <div className="color-swatch" style={{ background: color1 }}>
                      <input type="color" value={color1} onChange={(e) => setColor1(e.target.value)} />
                    </div>
                    <md-outlined-text-field 
                      value={color1} 
                      onInput={(e: any) => handleHexChange(e.target.value, setColor1)}
                      className="hex-input"
                    ></md-outlined-text-field>
                  </div>
                </div>

                {isGradient && (
                  <div className="color-input-group">
                    <label className="input-label">颜色 2</label>
                    <div className="custom-color-picker-row">
                      <div className="color-swatch" style={{ background: color2 }}>
                        <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} />
                      </div>
                      <md-outlined-text-field 
                        value={color2} 
                        onInput={(e: any) => handleHexChange(e.target.value, setColor2)}
                        className="hex-input"
                      ></md-outlined-text-field>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div slot="actions">
        <md-text-button onClick={() => { setView('main'); onClose(); }}>取消</md-text-button>
        <md-filled-button 
          onClick={view === 'color-editor' ? confirmAddColor : handleSave} 
          disabled={isSaving}
        >
          {view === 'color-editor' ? '添加' : (isSaving ? '保存中...' : '保存')}
        </md-filled-button>
      </div>
    </md-dialog>
  );
}
