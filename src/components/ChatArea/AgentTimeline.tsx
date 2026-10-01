import { type AgentBudget, type AgentStatus, type AgentStep } from '../../services/agentApi';
import './AgentTimeline.css';
import { useEffect, useState } from 'react';

const labels: Record<AgentStatus | 'skipped', string> = {
  running: '运行中', cancelling: '停止中', completed: '已完成', cancelled: '已取消', failed: '失败', interrupted: '中断',
  skipped: '未执行',
};

function Preview({ title, text, truncated }: { title: string; text: string; truncated?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  return <section className="agent-preview"><div><strong>{title}{truncated ? '（已截断）' : ''}</strong><button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button></div><pre>{text}</pre>{copyError && <small role="status">复制失败，请选择文本复制</small>}</section>;
}

export function AgentTimeline({ steps, status, error, budget, notice, onStop }: { steps: AgentStep[]; status?: AgentStatus; error?: string; budget?: AgentBudget; notice?: string; onStop?: () => void }) {
  const active = status === 'running' || status === 'cancelling';
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  const starts = steps.flatMap(step => step.started_at ? [Date.parse(step.started_at)] : []).filter(Number.isFinite);
  const ends = steps.flatMap(step => step.ended_at ? [Date.parse(step.ended_at)] : []).filter(Number.isFinite);
  const duration = starts.length ? Math.max(0, ((active ? clock : Math.max(...ends, ...starts)) - Math.min(...starts)) / 1000) : undefined;
  const icons = { discovery: '◈', model: '✦', search: '⌕', plugin: '◇' };
  return <div className="agent-result"><details className="agent-timeline" open={active}>
    <summary><span className="agent-badge">✦ Agent</span><span>{steps.length} 个步骤{duration !== undefined ? ` · ${Math.floor(duration)} 秒` : ''}</span><strong aria-live="polite">{status === 'running' && budget?.phase === 'summarizing' ? '正在整理' : labels[status || 'completed']}</strong></summary>
    {budget?.search_limit !== undefined && <div className="agent-budget"><span>模型 {budget.model_used}/{budget.model_limit}</span><span>搜索 {budget.search_used}/{budget.search_limit}</span>{budget.plugin_limit !== undefined && <span>插件 {budget.plugin_used || 0}/{budget.plugin_limit}</span>}</div>}
    {active && onStop && <div className="agent-controls"><button type="button" onClick={onStop} disabled={status === 'cancelling'}>{status === 'cancelling' ? '停止中…' : '停止任务'}</button></div>}
    <div className="agent-steps">{steps.map(step => <details className={`agent-step ${step.status}`} key={step.id} open={step.status === 'running'}>
      <summary><span className="agent-step-icon" aria-hidden="true">{step.status === 'completed' ? '✓' : step.status === 'failed' ? '!' : icons[step.type] || '◇'}</span><span className="agent-step-heading"><span>{step.title}<span className="agent-provider">{step.provider}</span></span>{step.summary && <span className="agent-step-brief">{step.summary.split('\n')[0]}</span>}</span><small>{step.status === 'completed' ? '成功' : labels[step.status]}{step.duration_ms !== undefined ? ` · ${(step.duration_ms / 1000).toFixed(1)}s` : ''}</small></summary>
      {step.query && <p className="agent-query">{step.query}</p>}
      {step.discovery && <div className="agent-discovery"><p>Superbox {step.discovery.version || ''} · {step.discovery.available?.length || 0} 个可用操作</p>{step.discovery.available?.map(operation => <p key={operation.name}>{operation.title} <small>{operation.method} {operation.path}</small></p>)}{step.discovery.unsupported?.map((operation, i) => <p key={i}>{operation.title}：{operation.reason}</p>)}{step.discovery.warnings?.map(warning => <p key={warning}>{warning}</p>)}</div>}
      {step.operation && <p className="agent-operation">{step.operation.method} {step.operation.path}</p>}
      {step.input_preview && <Preview title="参数" text={step.input_preview} truncated={step.input_truncated} />}
      {step.output_preview && <Preview title="结果" text={step.output_preview} truncated={step.output_truncated} />}
      {step.summary && !step.output_preview && <Preview title={step.type === 'model' ? '模型处理' : '执行说明'} text={step.summary} />}
      {step.error_code && <p className="agent-error-code">{step.error_code}</p>}
      {step.results?.map(result => <article key={`${result.number}-${result.url}`}>
        <a href={/^https?:\/\//.test(result.url) ? result.url : undefined} target="_blank" rel="noopener noreferrer">[{result.number}] {result.title || result.url}</a><p>{result.snippet}</p>
      </article>)}
    </details>)}</div>
    {error && <p className="agent-error" role="status">{error}</p>}
  </details>{notice && <p className="agent-notice" role="status">{notice}</p>}</div>;
}
