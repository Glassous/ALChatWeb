import { API_BASE_URL } from './api';

export type AgentStatus = 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export interface AgentBudget {
  search_used: number;
  search_limit: number;
  model_used: number;
  model_limit: number;
  plugin_used?: number;
  plugin_limit?: number;
  phase: 'research' | 'summarizing';
  reason: string;
  exhausted?: string[];
}
export interface AgentDiscovery {
  provider: string;
  version?: string;
  digest?: string;
  available?: Array<{ name: string; title: string; method: string; path: string }>;
  unsupported?: Array<{ title: string; reason: string }>;
  warnings?: string[];
}
export interface AgentStep {
  id: string;
  type: 'discovery' | 'model' | 'search' | 'plugin' | 'media';
  title: string;
  status: AgentStatus | 'skipped';
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  summary?: string;
  query?: string;
  provider?: string;
  phase?: 'research' | 'summarizing';
  discovery?: AgentDiscovery;
  operation?: { name: string; title: string; method: string; path: string };
  input_preview?: string;
  output_preview?: string;
  input_truncated?: boolean;
  output_truncated?: boolean;
  error_code?: string;
  results?: Array<{ title: string; url: string; snippet: string; number: number }>;
}
export interface AgentRun {
  id: string;
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  content: string;
  steps: AgentStep[];
  status: AgentStatus;
  error: string;
  credits: number;
  seq: number;
  budget?: AgentBudget;
  notice?: string;
  finish_reason?: string;
  discovery?: AgentDiscovery;
}
export interface AgentEvent {
  run_id: string;
  seq: number;
  type: 'status' | 'step' | 'terminal' | 'snapshot';
  data: AgentRun | AgentStep | { status?: AgentStatus; budget?: AgentBudget; notice?: string };
}
export const agentActive = (status?: AgentStatus) => status === 'running' || status === 'cancelling';

export class AgentApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}/api/agent/runs${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  });
  const token = response.headers.get('X-New-Token');
  if (token) localStorage.setItem('token', token);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new AgentApiError(data.error || `Agent 请求失败 (${response.status})`, response.status);
  }
  return response;
}

export const agentApi = {
  async start(conversationId: string, message: string, parentMessageId?: string | null, location?: string, requestId = crypto.randomUUID()): Promise<AgentRun> {
    const body = JSON.stringify({ conversation_id: conversationId, message, parent_message_id: parentMessageId, request_id: requestId, location });
    // Reuse the same key for one transport retry; the server owns idempotency.
    try {
      return await (await request('', { method: 'POST', body })).json();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return (await request('', { method: 'POST', body })).json();
    }
  },
  async get(id: string, signal?: AbortSignal): Promise<AgentRun> {
    return (await request(`/${id}`, { signal })).json();
  },
  async cancel(id: string): Promise<AgentRun> {
    return (await request(`/${id}/cancel`, { method: 'POST' })).json();
  },
  async events(id: string, afterSeq: number, signal: AbortSignal, onEvent: (event: AgentEvent) => void) {
    const response = await request(`/${id}/events?after_seq=${afterSeq}`, { signal });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Agent 事件流不可读');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find(item => item.startsWith('data: '));
          if (line) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
        }
        if (done) return;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },
};
