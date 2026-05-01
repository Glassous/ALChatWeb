const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

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
  status: 'pending' | 'running' | 'completed' | 'failed';
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
    results?: Array<{
      title: string;
      url: string;
      snippet: string;
    }>;
  };
  agent_steps?: AgentStepData[];
  agent_plan?: AgentPlanItemData[];
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ChatStreamResponse {
  type: 'token' | 'reasoning' | 'done' | 'error' | 'search' | 'title' | 'agent_start' | 'agent_plan' | 'plan_item' | 'agent_step' | 'agent_done';
  content?: string;
  data?: any;
}


interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class APIClient {
  private baseURL: string;
  private conversationCache = new Map<string, CacheEntry<ConversationWithMessages>>();
  private readonly CACHE_TTL = 2 * 60 * 1000; // 2 minutes

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private invalidateCache(id?: string) {
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

  // Auth APIs
  async register(data: any) {
    const response = await fetch(`${this.baseURL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to register');
    }
    return response.json();
  }

  async login(data: any) {
    const response = await fetch(`${this.baseURL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to login');
    }
    return response.json();
  }

  async getSecurityQuestion(username: string) {
    const response = await fetch(`${this.baseURL}/api/auth/security-question?username=${encodeURIComponent(username)}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch security question');
    }
    return response.json();
  }

  async resetPassword(data: any) {
    const response = await fetch(`${this.baseURL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to reset password');
    }
    return response.json();
  }

  // Profile APIs
  async getProfile() {
    const response = await fetch(`${this.baseURL}/api/auth/profile`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch profile');
    }
    return response.json();
  }

  async upgrade(code: string) {
    const response = await fetch(`${this.baseURL}/api/auth/upgrade`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upgrade');
    }
    return response.json();
  }

  async updateProfile(data: { nickname: string }) {
    const response = await fetch(`${this.baseURL}/api/auth/profile`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update profile');
    }
    return response.json();
  }

  async updateAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);

    const headers = { ...this.getHeaders() } as any;
    delete headers['Content-Type']; // Let browser set it for FormData

    const response = await fetch(`${this.baseURL}/api/auth/avatar`, {
      method: 'POST',
      headers: headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update avatar');
    }
    return response.json();
  }

  async getSystemPrompt() {
    const response = await fetch(`${this.baseURL}/api/auth/system-prompt`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch system prompt');
    }
    return response.json();
  }

  async updateSystemPrompt(data: { system_prompt: string; include_datetime: boolean; include_location: boolean }) {
    const response = await fetch(`${this.baseURL}/api/auth/system-prompt`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update system prompt');
    }
    return response.json();
  }

  async resolveLocation(lat: number, lng: number): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseURL}/api/location/resolve`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ lat, lng }),
      });
      if (!response.ok) return null;
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
      if (!response.ok) {
        throw new Error('Failed to fetch conversations');
      }
      const data = await response.json();
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
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
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
      if (!response.ok) {
        throw new Error('Failed to fetch conversation');
      }
      const data = await response.json();
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
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
  }

  async truncateMessages(conversationId: string, messageId: string): Promise<void> {
    this.invalidateCache(conversationId);
    const response = await fetch(`${this.baseURL}/api/conversations/${conversationId}/messages/after/${messageId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to truncate messages');
    }
  }

  async updateConversationTitle(id: string, title: string): Promise<void> {
    this.invalidateCache(id);
    const response = await fetch(`${this.baseURL}/api/conversations/${id}/title`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error('Failed to update conversation title');
    }
  }

  async generateTitle(id: string): Promise<string> {
    this.invalidateCache(id);
    const response = await fetch(`${this.baseURL}/api/conversations/${id}/generate-title`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to generate title');
    }
    const data = await response.json();
    return data.title;
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
    parentMessageId?: string | null
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

    if (!triggerResponse.ok) {
      const error = await triggerResponse.json();
      throw new Error(error.error || 'Failed to trigger image generation');
    }

    // Step 2: Connect to the stream
    const streamUrl = `${this.baseURL}/api/chat/stream?conversation_id=${encodeURIComponent(conversationId)}`;
    const response = await fetch(streamUrl, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
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

              if (parsed.type === 'token') {
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
    const formData = new FormData();
    formData.append('file', file);

    const headers = { ...this.getHeaders() } as any;
    delete headers['Content-Type'];

    const response = await fetch(`${this.baseURL}/api/chat/upload-reference`, {
      method: 'POST',
      headers: headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload file');
    }
    const data = await response.json();
    return data.url;
  }

  async deleteReferenceImage(url: string) {
    const response = await fetch(`${this.baseURL}/api/chat/reference-image`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete file');
    }
    return response.json();
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

    if (!triggerResponse.ok) {
      const error = await triggerResponse.json();
      throw new Error(error.error || 'Failed to trigger chat');
    }

    // Step 2: Connect to the stream
    const streamUrl = `${this.baseURL}/api/chat/stream?conversation_id=${encodeURIComponent(conversationId)}`;
    const response = await fetch(streamUrl, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
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
              
              if (parsed.type === 'token' && parsed.content) {
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

}

export const apiClient = new APIClient(API_BASE_URL);
