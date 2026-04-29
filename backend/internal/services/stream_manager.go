package services

import (
	"alchat-backend/internal/models"
	"sync"
)

// StreamManager handles Pub/Sub for chat streams
type StreamManager struct {
	// Map of conversation_id -> list of channels
	subscribers sync.Map
}

func NewStreamManager() *StreamManager {
	return &StreamManager{}
}

// Subscribe adds a new subscriber for a conversation
func (sm *StreamManager) Subscribe(conversationID string) chan models.ChatStreamResponse {
	ch := make(chan models.ChatStreamResponse, 100)
	
	actual, _ := sm.subscribers.LoadOrStore(conversationID, &sync.Map{})
	channels := actual.(*sync.Map)
	channels.Store(ch, struct{}{})
	
	return ch
}

// Unsubscribe removes a subscriber for a conversation
func (sm *StreamManager) Unsubscribe(conversationID string, ch chan models.ChatStreamResponse) {
	if actual, ok := sm.subscribers.Load(conversationID); ok {
		channels := actual.(*sync.Map)
		channels.Delete(ch)
		close(ch)
		
		// Check if no more subscribers, but we might want to keep the conversation entry 
		// until the generation is complete. The Publish method or a cleanup method will handle that.
	}
}

// Publish sends a message to all subscribers of a conversation
func (sm *StreamManager) Publish(conversationID string, resp models.ChatStreamResponse) {
	if actual, ok := sm.subscribers.Load(conversationID); ok {
		channels := actual.(*sync.Map)
		channels.Range(func(key, value interface{}) bool {
			ch := key.(chan models.ChatStreamResponse)
			// Non-blocking send
			select {
			case ch <- resp:
			default:
				// Buffer full, skip or handle as needed
			}
			return true
		})
	}
}

// CloseConversation cleans up all resources for a conversation
func (sm *StreamManager) CloseConversation(conversationID string) {
	if actual, ok := sm.subscribers.LoadAndDelete(conversationID); ok {
		channels := actual.(*sync.Map)
		channels.Range(func(key, value interface{}) bool {
			ch := key.(chan models.ChatStreamResponse)
			close(ch)
			return true
		})
	}
}
