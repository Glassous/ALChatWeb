package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Message struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ConversationID primitive.ObjectID `bson:"conversation_id" json:"conversation_id"`
	Role           string             `bson:"role" json:"role"` // "user" or "assistant"
	Content        string             `bson:"content" json:"content"`
	Reasoning      string             `bson:"reasoning,omitempty" json:"reasoning,omitempty"`
	Search         *SearchData        `bson:"search,omitempty" json:"search,omitempty"`
	CreatedAt      time.Time          `bson:"created_at" json:"created_at"`
}

type ChatRequest struct {
	ConversationID string `json:"conversation_id"`
	Message        string `json:"message"`
	Mode           string `json:"mode"` // "daily", "expert", or "search"
	Location       string `json:"location,omitempty"`
}

type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

type SearchData struct {
	Query   string         `json:"query"`
	Status  string         `json:"status"` // "searching", "completed"
	Results []SearchResult `json:"results,omitempty"`
}

type ChatStreamResponse struct {
	Type    string      `json:"type"` // "token", "reasoning", "error", "done", or "search"
	Content string      `json:"content,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}
