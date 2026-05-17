import { apiClient } from './api';

export interface OutlineItem {
  index: number;
  title: string;
  type: 'cover' | 'toc' | 'section' | 'content' | 'ending';
  key_points: string[];
  image_hint?: string;
  layout?: string;
}

export interface SlideHTML {
  index: number;
  title: string;
  html: string;
}

export interface ALingTask {
  id: string;
  user_id: string;
  title: string;
  topic: string;
  enable_search: boolean;
  status: 'pending' | 'outline_generating' | 'outline_ready' | 'generating' | 'completed' | 'failed';
  outline?: OutlineItem[];
  html_content?: string;
  slide_htmls?: SlideHTML[];
  slide_count: number;
  current_slide: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface ALingToolItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  enabled: boolean;
  badge?: string;
}

export interface ALingStreamEvent {
  type: 'outline_start' | 'outline_token' | 'outline_done' | 'slide_start' | 'slide_token' | 'slide_done' | 'reasoning' | 'search' | 'all_slides_done' | 'done' | 'error';
  data?: any;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

function getHeaders(): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function handleResponse(response: Response) {
  const newToken = response.headers.get('X-New-Token');
  if (newToken) localStorage.setItem('token', newToken);
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/welcome';
      return;
    }
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'API request failed');
  }
  return response.json();
}

const alingApi = {
  async getTools(): Promise<{ tools: ALingToolItem[] }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/tools`, { headers: getHeaders() });
    return handleResponse(r);
  },

  async createDemo(topic: string, enableSearch: boolean): Promise<ALingTask> {
    const r = await fetch(`${API_BASE_URL}/api/aling/demo`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ topic, enable_search: enableSearch }),
    });
    return handleResponse(r);
  },

  async listDemTasks(): Promise<{ tasks: ALingTask[] }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/demo/tasks`, { headers: getHeaders() });
    return handleResponse(r);
  },

  async getDemoTask(taskId: string): Promise<ALingTask> {
    const r = await fetch(`${API_BASE_URL}/api/aling/demo/${taskId}`, { headers: getHeaders() });
    return handleResponse(r);
  },

  async generateOutline(taskId: string): Promise<{ status: string }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/demo/${taskId}/outline`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(r);
  },

  async updateOutline(taskId: string, outline: OutlineItem[]): Promise<{ status: string }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/demo/${taskId}/outline`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ outline }),
    });
    return handleResponse(r);
  },

  async generateHTML(taskId: string): Promise<{ status: string }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/demo/${taskId}/generate`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(r);
  },

  streamTask(taskId: string, onEvent: (event: ALingStreamEvent) => void, onError?: (err: Error) => void): AbortController {
    const controller = new AbortController();
    const token = localStorage.getItem('token');
    fetch(`${API_BASE_URL}/api/aling/demo/${taskId}/stream`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        onError?.(new Error(`Stream error: ${response.status}`));
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent(data as ALingStreamEvent);
            } catch { }
          }
        }
      }
    }).catch((err) => {
      if (err.name !== 'AbortError') onError?.(err);
    });
    return controller;
  },

  async getOutput(taskId: string): Promise<string> {
    const token = localStorage.getItem('token');
    const r = await fetch(`${API_BASE_URL}/api/aling/demo/${taskId}/output`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    return r.text();
  },

  async deleteDemoTask(taskId: string): Promise<{ status: string }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/demo/${taskId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse(r);
  },
};

export default alingApi;
