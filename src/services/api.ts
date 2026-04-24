const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ChatStreamResponse {
  type: 'token' | 'reasoning' | 'done' | 'error' | 'search';
  content?: string;
  data?: any;
}


class APIClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
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
    try {
      const response = await fetch(`${this.baseURL}/api/conversations/${id}`, {
        headers: this.getHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch conversation');
      }
      const data = await response.json();
      // Ensure messages is always an array
      return {
        ...data,
        messages: Array.isArray(data.messages) ? data.messages : []
      };
    } catch (error) {
      console.error('Error fetching conversation:', error);
      throw error;
    }
  }

  async deleteConversation(id: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/conversations/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
  }

  async updateConversationTitle(id: string, title: string): Promise<void> {
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

  async generateImage(conversationId: string, prompt: string, resolution: string, refImageUrl?: string): Promise<string> {
    const response = await fetch(`${this.baseURL}/api/chat/image`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ 
        conversation_id: conversationId, 
        prompt, 
        resolution,
        ref_image_url: refImageUrl
      }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate image');
    }
    const data = await response.json();
    return data.url;
  }

  async uploadReferenceImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('image', file);

    const headers = { ...this.getHeaders() } as any;
    delete headers['Content-Type'];

    const response = await fetch(`${this.baseURL}/api/chat/upload-reference`, {
      method: 'POST',
      headers: headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload reference image');
    }
    const data = await response.json();
    return data.url;
  }

  async deleteReferenceImage(url: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/chat/reference-image`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete reference image');
    }
  }

  // Chat API with SSE streaming
  async sendMessage(
    conversationId: string,
    message: string,
    mode: 'daily' | 'expert' | 'search',
    onToken: (token: string) => void,
    onReasoning: (reasoning: string) => void,
    onSearch: (data: any) => void,
    onDone: () => void,
    onError: (error: string) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        conversation_id: conversationId,
        message,
        mode,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed: ChatStreamResponse = JSON.parse(data);
              
              if (parsed.type === 'token' && parsed.content) {
                onToken(parsed.content);
              } else if (parsed.type === 'reasoning' && parsed.content) {
                onReasoning(parsed.content);
              } else if (parsed.type === 'search' && parsed.data) {
                onSearch(parsed.data);
              } else if (parsed.type === 'done') {
                onDone();
              } else if (parsed.type === 'error') {
                onError(parsed.content || 'Unknown error');
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
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
