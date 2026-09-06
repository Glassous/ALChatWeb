import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar/TopBar';
import { useToast } from '../components/LayerSystem/LayerSystem';
import { apiClient } from '../services/api';
import { formatCoordsAsString, getCurrentPosition } from '../utils/location';
import './UserSettings.css';

export function SystemPromptSettings() {
  const navigate = useNavigate(); const showToast = useToast();
  const [memberType, setMemberType] = useState('free'); const [prompt, setPrompt] = useState('');
  const [datetime, setDatetime] = useState(false); const [location, setLocation] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => { void apiClient.getProfile().then(u => setMemberType(u.member_type || 'free')); void apiClient.getSystemPrompt().then(data => { setPrompt(data.system_prompt || ''); setDatetime(data.include_datetime || false); setLocation(data.include_location || false); }).catch(console.error).finally(() => setLoading(false)); }, []);
  // Location preview is synchronized with the persisted option.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!location) return; let cancelled = false; setLocating(true); void (async () => { const pos = await getCurrentPosition(); if (cancelled) return; if (!pos) { setPreview('无法获取位置'); setLocating(false); return; } const address = await apiClient.resolveLocation(pos.lat, pos.lng); if (!cancelled) { setPreview(address || formatCoordsAsString(pos.lat, pos.lng)); setLocating(false); } })(); return () => { cancelled = true; }; }, [location]);
  const save = async () => { setSaving(true); try { await apiClient.updateSystemPrompt({ system_prompt: prompt, include_datetime: datetime, include_location: location }); showToast({ tone: 'success', message: '系统提示词已保存' }); } catch { showToast({ tone: 'error', message: '保存失败，请重试' }); } finally { setSaving(false); } };
  return <div className="app-container"><div className="main-content"><TopBar conversationTitle="前置提示词" showBackButton onBack={() => navigate('/settings')} userMemberType={memberType} showBrand={false} /><div className="settings-page-container"><div className="settings-sections"><section className="settings-section"><h3 className="section-title">前置提示词</h3><div className="prompt-config-card">{loading ? <div className="section-loading"><md-circular-progress indeterminate /></div> : <><md-outlined-text-field type="textarea" label="自定义前置提示词" rows={8} value={prompt} onInput={(e: React.FormEvent<HTMLElement>) => setPrompt((e.target as HTMLInputElement).value)} style={{ width: '100%' }} /><div className="prompt-options-row"><button type="button" className={`prompt-option-chip ${datetime ? 'active' : ''}`} onClick={() => setDatetime(!datetime)}>包含日期和时间</button><button type="button" className={`prompt-option-chip ${location ? 'active' : ''}`} onClick={() => setLocation(!location)}>包含地理位置</button></div>{location && <div className="location-preview">{locating ? '获取位置中...' : preview || '无法获取位置'}</div>}<div className="prompt-save-actions"><md-filled-button onClick={save} disabled={saving}>{saving ? '保存中...' : '保存配置'}</md-filled-button></div></>}</div></section></div></div></div></div>;
}
