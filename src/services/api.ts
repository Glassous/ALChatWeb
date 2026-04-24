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
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ChatStreamResponse {
  type: 'token' | 'done' | 'error';
  content?: string;
}

class APIClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  // Conversation APIs
  async getConversations(): Promise<Conversation[]> {
    try {
      const response = await fetch(`${this.baseURL}/api/conversations`);
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  }

  async getConversation(id: string): Promise<ConversationWithMessages> {
    try {
      const response = await fetch(`${this.baseURL}/api/conversations/${id}`);
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
    });
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
  }

  async updateConversationTitle(id: string, title: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/conversations/${id}/title`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error('Failed to update conversation title');
    }
  }

  // Chat API with SSE streaming
  async sendMessage(
    conversationId: string,
    message: string,
    onToken: (token: string) => void,
    onDone: () => void,
    onError: (error: string) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        message,
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
