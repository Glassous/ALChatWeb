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
	CreatedAt      time.Time          `bson:"created_at" json:"created_at"`
}

type ChatRequest struct {
	ConversationID string `json:"conversation_id"`
	Message        string `json:"message"`
}

type ChatStreamResponse struct {
	Type    string `json:"type"` // "token" or "done"
	Content string `json:"content,omitempty"`
}
