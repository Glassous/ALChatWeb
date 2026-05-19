export interface ALingToolItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  enabled: boolean;
  badge?: string;
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
};

export default alingApi;
