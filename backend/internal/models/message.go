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
	AgentSteps     []AgentStepData     `bson:"agent_steps,omitempty" json:"agent_steps,omitempty"`
	AgentPlan      []AgentPlanItemData `bson:"agent_plan,omitempty" json:"agent_plan,omitempty"`
	CreatedAt      time.Time           `bson:"created_at" json:"created_at"`
}

type AgentStepData struct {
	Index      int    `bson:"index" json:"index"`
	ToolName   string `bson:"tool_name" json:"tool_name"`
	ToolInput  string `bson:"tool_input" json:"tool_input"`
	ToolOutput string `bson:"tool_output" json:"tool_output"`
	Err        string `bson:"err,omitempty" json:"err,omitempty"`
	PlanIndex  *int   `bson:"plan_index,omitempty" json:"plan_index,omitempty"`
}

type AgentPlanItemData struct {
	ID          int    `bson:"id" json:"id"`
	Description string `bson:"description" json:"description"`
	ToolName    string `bson:"tool_name" json:"tool_name"`
	Status      string `bson:"status" json:"status"`
}

type ChatRequest struct {
	ConversationID  string `json:"conversation_id"`
	ParentMessageID string `json:"parent_message_id"`
	Message         string `json:"message"`
	Mode            string `json:"mode"` // "daily", "expert", or "search"
	Location        string `json:"location,omitempty"`
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
