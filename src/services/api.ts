export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AgentStepData {
  index: number;
  tool_name: string;
  tool_input: string;
  tool_output: string;
  err?: string;
  plan_index?: number;
}

export interface AgentPlanItemData {
  id: number;
  description: string;
  tool_name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
}

export interface Message {
  id: string;
  conversation_id: string;
  parent_id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
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
  agent_steps?: AgentStepData[];
  agent_plan?: AgentPlanItemData[];
  created_at: string;
  clientId?: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ChatStreamResponse {
  type: 'token' | 'reasoning' | 'done' | 'error' | 'search' | 'title' | 'agent_start' | 'agent_plan' | 'plan_item' | 'agent_step' | 'agent_done' | 'image_gen_start';
  content?: string;
  data?: any;
}


interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface ThemePreset {
  id: string;
  name: string;
  value: string;
  type: 'color' | 'gradient';
}

export interface ThemeConfig {
  enabled: boolean;
  custom_presets?: ThemePreset[];
  divider: {
    type: 'color' | 'gradient';
    value: string;
    preset: string;
  };
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

  async register(data: any) {
    const response = await fetch(`${this.baseURL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
  }

  async login(data: any) {
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

  async resetPassword(data: any) {
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

  async updateTheme(data: ThemeConfig) {
    const response = await fetch(`${this.baseURL}/api/auth/theme`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse(response);
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
    onDone: (data: any) => void,
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
                onDone(parsed.data);
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
    mode: 'daily' | 'expert' | 'search' | 'agent',
    onToken: (token: string) => void,
    onReasoning: (reasoning: string) => void,
    onSearch: (data: any) => void,
    onDone: (data: any) => void,
    onTitle: (title: string) => void,
    onError: (error: string) => void,
    location?: string,
    parentMessageId?: string | null,
    onAgentPlan?: (items: any[]) => void,
    onPlanItem?: (index: number) => void,
    onAgentStep?: (step: any) => void,
    onImageGenStart?: (resolution: string) => void,
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
              } else if (parsed.type === 'token' && parsed.content) {
                onToken(parsed.content);
              } else if (parsed.type === 'reasoning' && parsed.content) {
                onReasoning(parsed.content);
              } else if (parsed.type === 'search' && parsed.data) {
                onSearch(parsed.data);
              } else if (parsed.type === 'done') {
                onDone(parsed.data);
              } else if (parsed.type === 'title' && parsed.content) {
                onTitle(parsed.content);
              } else if (parsed.type === 'error') {
                onError(parsed.content || 'Unknown error');
              } else if (parsed.type === 'agent_plan' && parsed.data) {
                onAgentPlan?.(parsed.data);
              } else if (parsed.type === 'plan_item' && parsed.data !== undefined) {
                onPlanItem?.(parsed.data);
              } else if (parsed.type === 'agent_step' && parsed.data) {
                onAgentStep?.(parsed.data);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e, 'Data:', data);
            }
          }
        }
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
