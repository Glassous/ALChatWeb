export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  parent_id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  mode?: 'daily' | 'expert' | 'search' | 'hermes';
  hermes_trace?: HermesStep[];
  hermes_response_id?: string;
  hermes_context_version?: number;
  hermes_response_completed?: boolean;
  search?: {
    query: string;
    status: 'searching' | 'completed';
    source?: string;
    results?: Array<{
      title: string;
      url: string;
      snippet: string;
      site_name?: string;
      site_icon?: string;
      date_published?: string;
    }>;
  };
  created_at: string;
  clientId?: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ChatStreamResponse {
  type: 'generation_mode' | 'token' | 'reasoning' | 'done' | 'error' | 'search' | 'title' | 'image_gen_start' | 'fallback' | 'hermes_event' | 'hermes_context';
  content?: string;
  data?: unknown;
}

export interface HermesStep {
  id: string; type: string; title: string; status: 'running' | 'completed' | 'failed';
  started_at?: string; ended_at?: string; duration_ms?: number; summary?: string; details?: string; raw?: unknown;
}
export interface HermesSettings { base_url: string; model: string; has_api_key: boolean; tested: boolean; context_version: number; last_tested_at?: string }

export interface CustomModelSettings {
  enabled: boolean;
  base_url: string;
  model: string;
  daily_enabled: boolean;
  expert_enabled: boolean;
  search_enabled: boolean;
  has_api_key: boolean;
  api_key_masked?: string;
  response_mode?: 'stream' | 'non_stream' | '';
  last_tested_at?: string;
}

interface AuthCredentials {
  email: string;
  password: string;
}

interface RegistrationData extends AuthCredentials {
  nickname: string;
  confirm_password: string;
  code: string;
}

interface ResetPasswordData {
  email: string;
  code: string;
  new_password: string;
  confirm_password: string;
}

interface AuthResponse {
  token: string;
  user: Record<string, unknown>;
}

export interface StreamSearchData {
  query: string;
  status: 'searching' | 'completed';
  results?: Array<{ title: string; url: string; snippet: string }>;
}

export interface StreamDoneData {
  assistant_message_id?: string;
  user_message_id?: string;
  credits?: number;
}


interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface ShareConversation {
  id: string;
  share_token: string;
  conversation_id: string;
  user_id: string;
  user_nickname: string;
  title: string;
  message_ids: string[];
  leaf_message_id: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  view_count: number;
}

export interface SharedConversationResponse {
  status: 'active' | 'partial' | 'deleted' | 'expired' | 'conversation_deleted' | 'messages_deleted';
  title?: string;
  sharer_nickname?: string;
  sharer_avatar?: string;
  created_at?: string;
  messages?: Message[];
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'warning' | 'critical';
  is_active: boolean;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Feedback {
  id: string;
  user_id?: string;
  user_email: string;
  type: 'bug' | 'feature' | 'other';
  content: string;
  meta?: Record<string, string>;
  status: 'open' | 'replied' | 'closed';
  reply_content?: string;
  replied_at?: string;
  created_at: string;
  updated_at: string;
}

class APIClient {
  private baseURL: string;
  private conversationCache = new Map<string, CacheEntry<ConversationWithMessages>>();
  private readonly CACHE_TTL = 2 * 60 * 1000; // 2 minutes

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  public invalidateCache(id?: string) {
    if (id) {
      this.conversationCache.delete(id);
    } else {
      this.conversationCache.clear();
    }
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private async handleResponse(response: Response) {
    // Check for new token in headers
    const newToken = response.headers.get('X-New-Token');
    if (newToken) {
      localStorage.setItem('token', newToken);
    }

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

  // Auth APIs
  async logout() {
    try {
      const response = await fetch(`${this.baseURL}/api/auth/logout`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
      return this.handleResponse(response);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }

  async register(data: RegistrationData): Promise<AuthResponse> {
    const response = await fetch(`${this.baseURL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
  }

  async login(data: AuthCredentials): Promise<AuthResponse> {
    const response = await fetch(`${this.baseURL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
  }

  async sendCode(email: string, scene: 'register' | 'reset') {
    const response = await fetch(`${this.baseURL}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, scene }),
    });
    return this.handleResponse(response);
  }

  async resetPassword(data: ResetPasswordData) {
    const response = await fetch(`${this.baseURL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
  }

  // Profile APIs
  async getProfile() {
    const response = await fetch(`${this.baseURL}/api/auth/profile`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async upgrade(code: string) {
    const response = await fetch(`${this.baseURL}/api/auth/upgrade`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ code }),
    });
    return this.handleResponse(response);
  }

  async updateProfile(data: { nickname: string }) {
    const response = await fetch(`${this.baseURL}/api/auth/profile`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
  }

  async updateAvatar(file: File) {
    const presignRes = await fetch(`${this.baseURL}/api/cos/presign`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        filename: file.name,
        folder: 'avatars',
        mime_type: file.type || 'image/jpeg',
      }),
    });
    const { upload_url, url } = await this.handleResponse(presignRes);

    const uploadResponse = await fetch(upload_url, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'image/jpeg',
      },
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload avatar to COS');
    }

    const response = await fetch(`${this.baseURL}/api/auth/avatar`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ avatar_url: url }),
    });
    return this.handleResponse(response);
  }

  async getSystemPrompt() {
    const response = await fetch(`${this.baseURL}/api/auth/system-prompt`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async updateSystemPrompt(data: { system_prompt: string; include_datetime: boolean; include_location: boolean }) {
    const response = await fetch(`${this.baseURL}/api/auth/system-prompt`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
  }

  async getCustomModel(): Promise<CustomModelSettings> {
    const response = await fetch(`${this.baseURL}/api/auth/custom-model`, { headers: this.getHeaders() });
    return this.handleResponse(response);
  }

  async updateCustomModel(data: Partial<CustomModelSettings> & { api_key?: string; clear_api_key?: boolean }) {
    const response = await fetch(`${this.baseURL}/api/auth/custom-model`, {
      method: 'PUT', headers: this.getHeaders(), body: JSON.stringify(data),
    });
    return this.handleResponse(response) as Promise<CustomModelSettings>;
  }

  async testCustomModel(data: { base_url: string; api_key?: string; model: string }) {
    const response = await fetch(`${this.baseURL}/api/auth/custom-model/test`, {
      method: 'POST', headers: this.getHeaders(), body: JSON.stringify(data),
    });
    return this.handleResponse(response) as Promise<{ connected: boolean; response_mode: 'stream' | 'non_stream'; last_tested_at: string }>;
  }

  async getHermes(): Promise<HermesSettings> {
    return this.handleResponse(await fetch(`${this.baseURL}/api/auth/hermes`, { headers: this.getHeaders() }));
  }
  async updateHermes(data: Partial<HermesSettings> & { api_key?: string; clear_api_key?: boolean }): Promise<HermesSettings> {
    return this.handleResponse(await fetch(`${this.baseURL}/api/auth/hermes`, { method: 'PUT', headers: this.getHeaders(), body: JSON.stringify(data) }));
  }
  async testHermes(data: { base_url: string; api_key?: string; model: string }): Promise<HermesSettings> {
    return this.handleResponse(await fetch(`${this.baseURL}/api/auth/hermes/test`, { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(data) }));
  }

  async resolveLocation(lat: number, lng: number): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseURL}/api/location/resolve`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ lat, lng }),
      });
      // Still update token even for location resolution
      const newToken = response.headers.get('X-New-Token');
      if (newToken) localStorage.setItem('token', newToken);

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/welcome';
        }
        return null;
      }
      const data = await response.json();
      return data.address || null;
    } catch {
      return null;
    }
  }

  // Conversation APIs
  async getConversations(): Promise<Conversation[]> {
    try {
      const response = await fetch(`${this.baseURL}/api/conversations`, {
        headers: this.getHeaders(),
      });
      const data = await this.handleResponse(response);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching conversations:', error);
      return []; // Return empty array on error
    }
  }

  async createConversation(title: string = 'New Conversation'): Promise<Conversation> {
    const response = await fetch(`${this.baseURL}/api/conversations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
    return this.handleResponse(response);
  }

  async getConversation(id: string): Promise<ConversationWithMessages> {
    const cached = this.conversationCache.get(id);
    const now = Date.now();
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await fetch(`${this.baseURL}/api/conversations/${id}`, {
        headers: this.getHeaders(),
      });
      const data = await this.handleResponse(response);
      // Ensure messages is always an array
      const result = {
        ...data,
        messages: Array.isArray(data.messages) ? data.messages : []
      };
      
      this.conversationCache.set(id, {
        data: result,
        timestamp: now
      });
      
      return result;
    } catch (error) {
      console.error('Error fetching conversation:', error);
      throw error;
    }
  }

  async deleteConversation(id: string): Promise<void> {
    this.invalidateCache(id);
    const response = await fetch(`${this.baseURL}/api/conversations/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    await this.handleResponse(response);
  }

  async truncateMessages(conversationId: string, messageId: string): Promise<void> {
    this.invalidateCache(conversationId);
    const response = await fetch(`${this.baseURL}/api/conversations/${conversationId}/messages/after/${messageId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    await this.handleResponse(response);
  }

  async updateConversationTitle(id: string, title: string): Promise<void> {
    this.invalidateCache(id);
    const response = await fetch(`${this.baseURL}/api/conversations/${id}/title`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
    await this.handleResponse(response);
  }

  async generateTitle(id: string): Promise<string> {
    this.invalidateCache(id);
    const response = await fetch(`${this.baseURL}/api/conversations/${id}/generate-title`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    const data = await this.handleResponse(response);
    return data.title;
  }

  // Temporary Conversation APIs
  async getTempConversation(id: string): Promise<ConversationWithMessages> {
    const response = await fetch(`${this.baseURL}/api/conversations/temp/${id}`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async deleteTempConversation(id: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/conversations/temp/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    await this.handleResponse(response);
  }

  async promoteTempConversation(id: string): Promise<Conversation> {
    const response = await fetch(`${this.baseURL}/api/conversations/temp/${id}/promote`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async generateImage(
    conversationId: string,
    prompt: string,
    resolution: string,
    onToken: (token: string) => void,
    onDone: (data: StreamDoneData) => void,
    onTitle: (title: string) => void,
    onError: (error: string) => void,
    refImageUrl?: string,
    parentMessageId?: string | null,
    onImageGenStart?: (resolution: string) => void
  ): Promise<void> {
    this.invalidateCache(conversationId);
    
    // Step 1: Trigger background generation
    const triggerResponse = await fetch(`${this.baseURL}/api/chat/image`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ 
        conversation_id: conversationId, 
        parent_message_id: parentMessageId,
        prompt, 
        resolution,
        ref_image_url: refImageUrl
      }),
    });

    await this.handleResponse(triggerResponse);

    // Step 2: Connect to the stream
    const streamUrl = `${this.baseURL}/api/chat/stream?conversation_id=${encodeURIComponent(conversationId)}`;
    const response = await fetch(streamUrl, {
      headers: this.getHeaders(),
    });

    const newToken = response.headers.get('X-New-Token');
    if (newToken) localStorage.setItem('token', newToken);

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/welcome';
      }
      throw new Error('Failed to connect to stream');
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (!reader) return;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            try {
              const dataStr = line.trim().substring(6);
              const parsed = JSON.parse(dataStr) as ChatStreamResponse;

              if (parsed.type === 'image_gen_start' && parsed.content) {
                onImageGenStart?.(parsed.content);
              } else if (parsed.type === 'token') {
                onToken(parsed.content || '');
              } else if (parsed.type === 'done') {
                onDone((parsed.data ?? {}) as StreamDoneData);
              } else if (parsed.type === 'title' && parsed.content) {
                onTitle(parsed.content);
              } else if (parsed.type === 'error') {
                onError(parsed.content || 'Unknown error');
              }
            } catch (e) {
              console.error('Failed to parse SSE line:', line, e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async uploadReferenceImage(file: File): Promise<string> {
    const presignRes = await fetch(`${this.baseURL}/api/cos/presign`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        filename: file.name,
        folder: 'reference_files',
        mime_type: file.type || 'application/octet-stream',
      }),
    });
    const { upload_url, url } = await this.handleResponse(presignRes);

    const uploadResponse = await fetch(upload_url, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file to COS');
    }

    return url;
  }

  async deleteReferenceImage(url: string) {
    const response = await fetch(`${this.baseURL}/api/chat/reference-image`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify({ url }),
    });
    return this.handleResponse(response);
  }

  // Chat API with SSE streaming
  async sendMessage(
    conversationId: string,
    message: string,
    mode: 'daily' | 'expert' | 'search' | 'hermes',
    onToken: (token: string) => void,
    onReasoning: (reasoning: string) => void,
    onSearch: (data: StreamSearchData) => void,
    onDone: (data: StreamDoneData) => void,
    onTitle: (title: string) => void,
    onError: (error: string) => void,
    location?: string,
    parentMessageId?: string | null,
    onImageGenStart?: (resolution: string) => void,
		onFallback?: (message: string) => void,
		onGenerationMode?: (mode: 'stream' | 'non_stream') => void,
		onHermesEvent?: (step: HermesStep) => void,
  ): Promise<void> {
    this.invalidateCache(conversationId);
    
    // Step 1: Trigger background generation
    const triggerResponse = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        conversation_id: conversationId,
        parent_message_id: parentMessageId,
        message,
        mode,
        location,
      }),
    });

    await this.handleResponse(triggerResponse);

    // Step 2: Connect to the stream
    const streamUrl = `${this.baseURL}/api/chat/stream?conversation_id=${encodeURIComponent(conversationId)}`;
    const response = await fetch(streamUrl, {
      headers: this.getHeaders(),
    });

    const newToken = response.headers.get('X-New-Token');
    if (newToken) localStorage.setItem('token', newToken);

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/welcome';
      }
      throw new Error('Failed to connect to stream');
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    let buffer = '';
		let receivedTerminalEvent = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        
        // Keep the last partial line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            const data = line.trim().slice(6);
            try {
              const parsed: ChatStreamResponse = JSON.parse(data);
              
              if (parsed.type === 'image_gen_start' && parsed.content) {
                onImageGenStart?.(parsed.content);
							} else if (parsed.type === 'generation_mode' && (parsed.content === 'stream' || parsed.content === 'non_stream')) {
								onGenerationMode?.(parsed.content);
              } else if (parsed.type === 'token' && parsed.content) {
                onToken(parsed.content);
              } else if (parsed.type === 'reasoning' && parsed.content) {
                onReasoning(parsed.content);
              } else if (parsed.type === 'search' && parsed.data) {
                onSearch(parsed.data as StreamSearchData);
              } else if (parsed.type === 'done') {
								receivedTerminalEvent = true;
                onDone((parsed.data ?? {}) as StreamDoneData);
              } else if (parsed.type === 'title' && parsed.content) {
                onTitle(parsed.content);
              } else if (parsed.type === 'error') {
								receivedTerminalEvent = true;
                onError(parsed.content || 'Unknown error');
							} else if (parsed.type === 'fallback') {
								onFallback?.(parsed.content || '已回退到项目模型');
              } else if (parsed.type === 'hermes_event' && parsed.data) {
                onHermesEvent?.(parsed.data as HermesStep);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e, 'Data:', data);
            }
          }
        }
      }
			if (!receivedTerminalEvent) {
				throw new Error('Stream ended before completion');
			}
    } finally {
      reader.releaseLock();
    }
  }

  async createShare(conversationId: string, leafMessageId?: string): Promise<ShareConversation> {
    const response = await fetch(`${this.baseURL}/api/conversations/${conversationId}/share`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(leafMessageId ? { leaf_message_id: leafMessageId } : {}),
    });
    return this.handleResponse(response);
  }

  async getSharedConversation(token: string): Promise<SharedConversationResponse> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const tokenStr = localStorage.getItem('token');
    if (tokenStr) {
      headers['Authorization'] = `Bearer ${tokenStr}`;
    }
    const response = await fetch(`${this.baseURL}/api/shared/${token}`, {
      headers,
    });
    return this.handleResponse(response);
  }

  async deleteShare(token: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/shared/${token}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    await this.handleResponse(response);
  }

  async getMyShares(): Promise<ShareConversation[]> {
    const response = await fetch(`${this.baseURL}/api/my/shared`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async saveSharedConversation(token: string): Promise<{ conversation_id: string }> {
    const response = await fetch(`${this.baseURL}/api/shared/${token}/save`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async getAllSharedConversations(): Promise<ShareConversation[]> {
    const response = await fetch(`${this.baseURL}/api/admin/shared`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  async deleteSharedConversationAdmin(shareId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/admin/shared/${shareId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    await this.handleResponse(response);
  }

  // Public Announcement APIs
  async getPublicAnnouncements(): Promise<Announcement[]> {
    const response = await fetch(`${this.baseURL}/api/announcements`, {
      headers: this.getHeaders(),
    });
    return this.handleResponse(response);
  }

  // Public Feedback APIs
  async submitFeedback(data: { type: string; content: string; user_email: string; meta?: Record<string, string> }) {
    const response = await fetch(`${this.baseURL}/api/feedback`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
  }

}

export const apiClient = new APIClient(API_BASE_URL);
