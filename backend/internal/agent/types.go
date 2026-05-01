package agent

import (
	"github.com/firebase/genkit/go/ai"
)

type PlanItemStatus string

const (
	PlanStatusPending   PlanItemStatus = "pending"
	PlanStatusRunning   PlanItemStatus = "running"
	PlanStatusCompleted PlanItemStatus = "completed"
	PlanStatusFailed    PlanItemStatus = "failed"
)

type AgentPlanItem struct {
	ID          int            `json:"id"`
	Description string         `json:"description"`
	ToolName    string         `json:"tool_name"`
	Status      PlanItemStatus `json:"status"`
}

type PlanResponse struct {
	Items []AgentPlanItem `json:"items"`
}

type AgentStep struct {
	Index      int
	ToolName   string
	ToolInput  map[string]any
	ToolOutput string
	Err        string
	Plan       *PlanResponse
	PlanIndex  *int
}

type AgentEvent struct {
	Type   string      `json:"type"`
	Data   interface{} `json:"data"`
	Status string      `json:"status,omitempty"`
}

type ToolDef struct {
	Name        string
	Description string
	Fn          func(ctx *ai.ToolContext, input map[string]any) (map[string]any, error)
}
