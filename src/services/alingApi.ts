export interface ALingToolItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  enabled: boolean;
  badge?: string;
}

export interface ALingTranslationHistory {
  id: string;
  user_id: string;
  source_text: string;
  target_text: string;
  target_lang: string;
  created_at: string;
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

  async getTranslatorLanguages(): Promise<{ languages: string[] }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/translator/languages`, { headers: getHeaders() });
    return handleResponse(r);
  },

  async addTranslatorLanguage(language: string): Promise<{ message: string }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/translator/languages`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ language }),
    });
    return handleResponse(r);
  },

  async deleteTranslatorLanguage(language: string): Promise<{ message: string }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/translator/languages`, {
      method: 'DELETE',
      headers: getHeaders(),
      body: JSON.stringify({ language }),
    });
    return handleResponse(r);
  },

  async resetTranslatorLanguages(): Promise<{ languages: string[] }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/translator/languages/reset`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(r);
  },

  async getTranslationHistory(): Promise<{ history: ALingTranslationHistory[] }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/translator/history`, { headers: getHeaders() });
    return handleResponse(r);
  },

  async deleteTranslationHistory(id: string): Promise<{ message: string }> {
    const r = await fetch(`${API_BASE_URL}/api/aling/translator/history/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse(r);
  },

  async translateText(text: string, targetLang: string): Promise<Response> {
    const r = await fetch(`${API_BASE_URL}/api/aling/translator/translate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text, target_lang: targetLang }),
    });
    if (!r.ok) {
      const error = await r.json().catch(() => ({ error: 'Translation failed' }));
      throw new Error(error.error || 'Translation failed');
    }
    return r;
  },
};

export default alingApi;
