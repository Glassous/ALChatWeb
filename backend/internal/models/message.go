package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Message struct {
	ID             primitive.ObjectID  `bson:"_id,omitempty" json:"id"`
	ConversationID primitive.ObjectID  `bson:"conversation_id" json:"conversation_id"`
	ParentID       *primitive.ObjectID `bson:"parent_id,omitempty" json:"parent_id,omitempty"`
	Role           string              `bson:"role" json:"role"` // "user" or "assistant"
	Content        string              `bson:"content" json:"content"`
	Reasoning      string              `bson:"reasoning,omitempty" json:"reasoning,omitempty"`
	Search         *SearchData         `bson:"search,omitempty" json:"search,omitempty"`
	Mode           string              `bson:"mode,omitempty" json:"mode,omitempty"`
	HermesTrace    []HermesStep        `bson:"hermes_trace,omitempty" json:"hermes_trace,omitempty"`
	CreatedAt      time.Time           `bson:"created_at" json:"created_at"`
}

type HermesStep struct {
	ID        string      `bson:"id" json:"id"`
	Type      string      `bson:"type" json:"type"`
	Title     string      `bson:"title" json:"title"`
	Status    string      `bson:"status" json:"status"`
	StartedAt *time.Time  `bson:"started_at,omitempty" json:"started_at,omitempty"`
	EndedAt   *time.Time  `bson:"ended_at,omitempty" json:"ended_at,omitempty"`
	Duration  int64       `bson:"duration_ms,omitempty" json:"duration_ms,omitempty"`
	Summary   string      `bson:"summary,omitempty" json:"summary,omitempty"`
	Details   string      `bson:"details,omitempty" json:"details,omitempty"`
	Raw       interface{} `bson:"raw,omitempty" json:"raw,omitempty"`
}

type ChatRequest struct {
	ConversationID  string `json:"conversation_id"`
	ParentMessageID string `json:"parent_message_id"`
	Message         string `json:"message"`
	Mode            string `json:"mode"` // "daily", "expert", or "search"
	Location        string `json:"location,omitempty"`
}

type SearchResult struct {
	Title         string `bson:"title" json:"title"`
	URL           string `bson:"url" json:"url"`
	Snippet       string `bson:"snippet" json:"snippet"`
	SiteName      string `bson:"site_name,omitempty" json:"site_name,omitempty"`
	SiteIcon      string `bson:"site_icon,omitempty" json:"site_icon,omitempty"`
	DatePublished string `bson:"date_published,omitempty" json:"date_published,omitempty"`
}

type SearchData struct {
	Query   string         `bson:"query" json:"query"`
	Status  string         `bson:"status" json:"status"` // "searching", "completed"
	Source  string         `bson:"source,omitempty" json:"source,omitempty"`
	Results []SearchResult `bson:"results,omitempty" json:"results,omitempty"`
}

type ChatStreamResponse struct {
	Type    string      `json:"type"` // "generation_mode", "token", "reasoning", "error", "done", or "search"
	Content string      `json:"content,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

type AIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
