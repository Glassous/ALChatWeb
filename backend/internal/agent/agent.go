package agent

import (
	"alchat-backend/internal/agent/tools"
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

type StepCallback func(step AgentStep)

type Runner struct {
	g        *genkit.Genkit
	registry *tools.Registry
	db       *database.MongoDB
	model    string
}

func NewRunner(g *genkit.Genkit, registry *tools.Registry, db *database.MongoDB, model string) *Runner {
	return &Runner{
		g:        g,
		registry: registry,
		db:       db,
		model:    model,
	}
}

func (r *Runner) Run(ctx context.Context, messages []*ai.Message, callbackI interface{}) (string, error) {
	callback, ok := callbackI.(StepCallback)
	if !ok {
		return "", fmt.Errorf("invalid callback type")
	}

	if r.model == "" {
		return "", fmt.Errorf("agent model not configured")
	}

	enabledTools := r.registry.GetEnabledTools()
	if len(enabledTools) == 0 {
		return "", fmt.Errorf("no tools available")
	}

	var allMessages []*ai.Message
	allMessages = append(allMessages, messages...)

	plan, err := r.generatePlan(ctx, allMessages, enabledTools)
	if err != nil {
		log.Printf("[Agent] Plan generation failed, falling back to no-plan mode: %v", err)
	}

	if plan != nil && len(plan.Items) > 0 {
		callback(AgentStep{Plan: plan})
		return r.runWithPlan(ctx, allMessages, plan, enabledTools, callback)
	}

	return r.runLoop(ctx, allMessages, enabledTools, callback, nil)
}

func (r *Runner) runWithPlan(ctx context.Context, messages []*ai.Message, plan *PlanResponse, enabledTools []ai.ToolRef, callback StepCallback) (string, error) {
	return r.runLoop(ctx, messages, enabledTools, callback, plan)
}

func (r *Runner) runLoop(ctx context.Context, messages []*ai.Message, enabledTools []ai.ToolRef, callback StepCallback, plan *PlanResponse) (string, error) {
	maxIterations := 10
	iteration := 0
	planIndex := 0

	for iteration < maxIterations {
		iteration++

		resp, err := genkit.Generate(ctx, r.g,
			ai.WithModelName("openai-agent/"+r.model),
			ai.WithMessages(messages...),
			ai.WithTools(enabledTools...),
			ai.WithReturnToolRequests(true),
		)
		if err != nil {
			return "", fmt.Errorf("generation error: %w", err)
		}

		toolRequests := resp.ToolRequests()
		if len(toolRequests) == 0 {
			return resp.Text(), nil
		}

		if plan != nil && planIndex < len(plan.Items) {
			callback(AgentStep{
				Index:     iteration,
				ToolName:  "plan_progress",
				PlanIndex: &planIndex,
			})
		}

		for _, tr := range toolRequests {
			step := AgentStep{
				Index:     iteration,
				ToolName:  tr.Name,
				ToolInput: nil,
			}
			if plan != nil && planIndex < len(plan.Items) {
				step.PlanIndex = &planIndex
			}

			if inputMap, ok := tr.Input.(map[string]any); ok {
				step.ToolInput = inputMap
			} else {
				inputBytes, _ := json.Marshal(tr.Input)
				var inputMap map[string]any
				json.Unmarshal(inputBytes, &inputMap)
				step.ToolInput = inputMap
			}

			callback(step)
		}

		var toolResponseParts []*ai.Part
		for _, tr := range toolRequests {
			tool := genkit.LookupTool(r.g, tr.Name)
			if tool == nil {
				errOutput := map[string]any{"error": fmt.Sprintf("tool %s not found", tr.Name)}
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tr.Name,
					ToolOutput: fmt.Sprintf("%v", errOutput),
					Err:        fmt.Sprintf("tool %s not found", tr.Name),
				})
				toolResponseParts = append(toolResponseParts, ai.NewToolResponsePart(&ai.ToolResponse{
					Name:   tr.Name,
					Ref:    tr.Ref,
					Output: errOutput,
				}))
				continue
			}

			var toolInput map[string]any
			if inputMap, ok := tr.Input.(map[string]any); ok {
				toolInput = inputMap
			} else {
				inputBytes, _ := json.Marshal(tr.Input)
				json.Unmarshal(inputBytes, &toolInput)
			}

			output, err := tool.RunRaw(ctx, toolInput)
			if err != nil {
				errOutput := map[string]any{"error": err.Error()}
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tr.Name,
					ToolOutput: fmt.Sprintf("%v", errOutput),
					Err:        err.Error(),
				})
				toolResponseParts = append(toolResponseParts, ai.NewToolResponsePart(&ai.ToolResponse{
					Name:   tr.Name,
					Ref:    tr.Ref,
					Output: errOutput,
				}))
			} else {
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tr.Name,
					ToolOutput: fmt.Sprintf("%v", output),
				})
				toolResponseParts = append(toolResponseParts, ai.NewToolResponsePart(&ai.ToolResponse{
					Name:   tr.Name,
					Ref:    tr.Ref,
					Output: output,
				}))
			}
		}

		if plan != nil {
			if planIndex < len(plan.Items) {
				plan.Items[planIndex].Status = PlanStatusCompleted
				callback(AgentStep{
					Index:     iteration,
					ToolName:  "plan_item",
					PlanIndex: &planIndex,
				})
			}
			planIndex++
		}

		toolMsg := &ai.Message{Role: ai.RoleTool, Content: toolResponseParts}
		messages = append(messages, resp.Message, toolMsg)
	}

	return "", fmt.Errorf("agent exceeded maximum iterations (%d)", maxIterations)
}

func (r *Runner) generatePlan(ctx context.Context, messages []*ai.Message, enabledTools []ai.ToolRef) (*PlanResponse, error) {
	var toolDescs []map[string]string
	for _, t := range r.registry.GetAllTools() {
		if t.Enabled {
			toolDescs = append(toolDescs, map[string]string{
				"name":        t.Name,
				"description": t.Description,
			})
		}
	}

	toolDescJSON, _ := json.Marshal(toolDescs)

	planPrompt := fmt.Sprintf(`你是一个任务规划助手。根据用户的问题和可用工具，制定一个执行计划。

可用工具：
%s

请以JSON格式返回执行计划，格式如下：
{"items": [{"id": 1, "description": "步骤描述", "tool_name": "工具名"}, ...]}

如果不需要任何工具，返回空数组：{"items": []}
只返回JSON，不要包含其他内容。`, string(toolDescJSON))

	planMessages := []*ai.Message{
		{Role: ai.RoleSystem, Content: []*ai.Part{ai.NewTextPart(planPrompt)}},
	}
	planMessages = append(planMessages, messages...)

	resp, err := genkit.Generate(ctx, r.g,
		ai.WithModelName("openai-agent/"+r.model),
		ai.WithMessages(planMessages...),
	)
	if err != nil {
		return nil, err
	}

	var plan PlanResponse
	text := resp.Text()
	if err := json.Unmarshal([]byte(text), &plan); err != nil {
		return nil, fmt.Errorf("failed to parse plan: %w", err)
	}

	if len(plan.Items) > 10 {
		plan.Items = plan.Items[:10]
	}

	for i := range plan.Items {
		plan.Items[i].ID = i + 1
		plan.Items[i].Status = PlanStatusPending
	}

	return &plan, nil
}

func (r *Runner) GetToolNames() []string {
	var names []string
	for _, t := range r.registry.GetAllTools() {
		names = append(names, t.Name)
	}
	return names
}

func (r *Runner) GetToolDescriptions() map[string]string {
	descs := make(map[string]string)
	for _, t := range r.registry.GetAllTools() {
		descs[t.Name] = t.Description
	}
	return descs
}

func (r *Runner) IsToolEnabled(name string) bool {
	t, ok := r.registry.GetToolMeta(name)
	if !ok {
		return false
	}
	return t.Enabled
}

func (r *Runner) SetToolEnabled(name string, enabled bool) {
	r.registry.SetEnabled(name, enabled)
}

func (r *Runner) SaveToolStates(ctx context.Context) error {
	if r.db == nil {
		return nil
	}

	states := make(map[string]bool)
	for _, t := range r.registry.GetAllTools() {
		states[t.Name] = t.Enabled
	}

	settings := models.SystemSettings{
		AgentToolConfig: models.AgentToolConfig{Tools: states},
	}

	opts := bson.M{"$set": bson.M{"agent_tool_config": settings.AgentToolConfig}}
	_, err := r.db.Collection("system_settings").UpdateOne(ctx, bson.M{}, opts)
	if err == mongo.ErrNoDocuments {
		_, err = r.db.Collection("system_settings").InsertOne(ctx, settings)
	}
	return err
}

func (r *Runner) LoadToolStates(ctx context.Context) {
	if r.db == nil {
		return
	}

	var settings models.SystemSettings
	err := r.db.Collection("system_settings").FindOne(ctx, bson.M{}).Decode(&settings)
	if err != nil {
		return
	}

	if settings.AgentToolConfig.Tools != nil {
		r.registry.ApplyEnabledStates(settings.AgentToolConfig.Tools)
	}
}

func (r *Runner) GetRegistry() *tools.Registry {
	return r.registry
}
