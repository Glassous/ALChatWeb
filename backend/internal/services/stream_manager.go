package services

import (
	"alchat-backend/internal/models"
	"sync"
	"time"
)

const streamReplayRetention = 30 * time.Second

type conversationStream struct {
	events      []models.ChatStreamResponse
	subscribers map[chan models.ChatStreamResponse]struct{}
	closed      bool
}

// StreamManager handles live chat events and retains a short replay buffer.
type StreamManager struct {
	mu            sync.Mutex
	conversations map[string]*conversationStream
}

func NewStreamManager() *StreamManager {
	return &StreamManager{conversations: make(map[string]*conversationStream)}
}

// StartConversation resets transient state before generation begins.
func (sm *StreamManager) StartConversation(conversationID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if previous := sm.conversations[conversationID]; previous != nil {
		for ch := range previous.subscribers {
			close(ch)
		}
	}
	sm.conversations[conversationID] = &conversationStream{subscribers: make(map[chan models.ChatStreamResponse]struct{})}
}

func (sm *StreamManager) Subscribe(conversationID string) chan models.ChatStreamResponse {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	state := sm.conversations[conversationID]
	if state == nil {
		state = &conversationStream{subscribers: make(map[chan models.ChatStreamResponse]struct{})}
		sm.conversations[conversationID] = state
	}
	ch := make(chan models.ChatStreamResponse, len(state.events)+100)
	for _, event := range state.events {
		ch <- event
	}
	if state.closed {
		close(ch)
	} else {
		state.subscribers[ch] = struct{}{}
	}
	return ch
}

// Unsubscribe removes a subscriber for a conversation
func (sm *StreamManager) Unsubscribe(conversationID string, ch chan models.ChatStreamResponse) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	state := sm.conversations[conversationID]
	if state == nil {
		return
	}
	if _, ok := state.subscribers[ch]; ok {
		delete(state.subscribers, ch)
		close(ch)
	}
}

// Publish sends a message to all subscribers of a conversation
func (sm *StreamManager) Publish(conversationID string, resp models.ChatStreamResponse) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	state := sm.conversations[conversationID]
	if state == nil {
		state = &conversationStream{subscribers: make(map[chan models.ChatStreamResponse]struct{})}
		sm.conversations[conversationID] = state
	}
	if state.closed {
		return
	}
	state.events = append(state.events, resp)
	for ch := range state.subscribers {
		select {
		case ch <- resp:
		default:
		}
	}
}

// CloseConversation closes live subscribers but briefly keeps replayable events.
func (sm *StreamManager) CloseConversation(conversationID string) {
	sm.mu.Lock()
	state := sm.conversations[conversationID]
	if state == nil || state.closed {
		sm.mu.Unlock()
		return
	}
	state.closed = true
	for ch := range state.subscribers {
		delete(state.subscribers, ch)
		close(ch)
	}
	sm.mu.Unlock()
	time.AfterFunc(streamReplayRetention, func() {
		sm.mu.Lock()
		defer sm.mu.Unlock()
		if sm.conversations[conversationID] == state {
			delete(sm.conversations, conversationID)
		}
	})
}
