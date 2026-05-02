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

type AgentResult struct {
	Answer    string
	Reasoning string
}

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

func (r *Runner) Run(ctx context.Context, messages []*ai.Message, callbackI interface{}) (*AgentResult, error) {
	callback, ok := callbackI.(StepCallback)
	if !ok {
		return nil, fmt.Errorf("invalid callback type")
	}

	if r.model == "" {
		return nil, fmt.Errorf("agent model not configured")
	}

	enabledTools := r.registry.GetEnabledTools()
	if len(enabledTools) == 0 {
		return nil, fmt.Errorf("no tools available")
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

	return r.runLoop(ctx, allMessages, enabledTools, callback, nil, nil, nil)
}

func (r *Runner) RunWithStreaming(ctx context.Context, messages []*ai.Message, stepCb StepCallback, tokenCb func(string), reasoningCb func(string)) (*AgentResult, error) {
	if r.model == "" {
		return nil, fmt.Errorf("agent model not configured")
	}

	enabledTools := r.registry.GetEnabledTools()
	if len(enabledTools) == 0 {
		return nil, fmt.Errorf("no tools available")
	}

	var allMessages []*ai.Message
	allMessages = append(allMessages, messages...)

	plan, err := r.generatePlan(ctx, allMessages, enabledTools)
	if err != nil {
		log.Printf("[Agent] Plan generation failed, falling back to no-plan mode: %v", err)
	}

	if plan != nil && len(plan.Items) > 0 {
		stepCb(AgentStep{Plan: plan})
		return r.runWithPlanStreaming(ctx, allMessages, plan, enabledTools, stepCb, tokenCb, reasoningCb)
	}

	return r.runLoop(ctx, allMessages, enabledTools, stepCb, nil, tokenCb, reasoningCb)
}

func (r *Runner) runWithPlan(ctx context.Context, messages []*ai.Message, plan *PlanResponse, enabledTools []ai.ToolRef, callback StepCallback) (*AgentResult, error) {
	return r.runLoop(ctx, messages, enabledTools, callback, plan, nil, nil)
}

func (r *Runner) runWithPlanStreaming(ctx context.Context, messages []*ai.Message, plan *PlanResponse, enabledTools []ai.ToolRef, stepCb StepCallback, tokenCb func(string), reasoningCb func(string)) (*AgentResult, error) {
	return r.runLoop(ctx, messages, enabledTools, stepCb, plan, tokenCb, reasoningCb)
}

func (r *Runner) runLoop(ctx context.Context, messages []*ai.Message, enabledTools []ai.ToolRef, callback StepCallback, plan *PlanResponse, tokenCb func(string), reasoningCb func(string)) (*AgentResult, error) {
	maxIterations := 10
	iteration := 0
	planIndex := 0
	var allReasoning string

	for iteration < maxIterations {
		iteration++

		var resp *ai.ModelResponse
		var streamErr error

		if reasoningCb != nil || tokenCb != nil {
			resp, streamErr = r.generateStreaming(ctx, messages, enabledTools, reasoningCb, tokenCb, &allReasoning)
		} else {
			resp, streamErr = r.generateSync(ctx, messages, enabledTools)
		}
		if streamErr != nil {
			return nil, fmt.Errorf("generation error: %w", streamErr)
		}

		toolRequests := resp.ToolRequests()
		if len(toolRequests) == 0 {
			finalText := resp.Text()
			return &AgentResult{
				Answer:    finalText,
				Reasoning: allReasoning,
			}, nil
		}

		if plan != nil && planIndex < len(plan.Items) {
			callback(AgentStep{
				Index:     iteration,
				ToolName:  "plan_progress",
				PlanIndex: &planIndex,
			})
		}

		var toolResponseParts []*ai.Part
		for _, tr := range toolRequests {
			inputMap := parseToolInput(tr.Input)

			tool := genkit.LookupTool(r.g, tr.Name)
			if tool == nil {
				errOutput := map[string]any{"error": fmt.Sprintf("tool %s not found", tr.Name)}
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tr.Name,
					ToolInput:  inputMap,
					ToolOutput: formatOutput(errOutput),
					Err:        fmt.Sprintf("tool %s not found", tr.Name),
					PlanIndex:  getPlanIndex(plan, planIndex),
				})
				toolResponseParts = append(toolResponseParts, ai.NewToolResponsePart(&ai.ToolResponse{
					Name:   tr.Name,
					Ref:    tr.Ref,
					Output: errOutput,
				}))
				continue
			}

			output, err := tool.RunRaw(ctx, inputMap)
			if err != nil {
				errOutput := map[string]any{"error": err.Error()}
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tr.Name,
					ToolInput:  inputMap,
					ToolOutput: formatOutput(errOutput),
					Err:        err.Error(),
					PlanIndex:  getPlanIndex(plan, planIndex),
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
					ToolInput:  inputMap,
					ToolOutput: formatOutput(output),
					PlanIndex:  getPlanIndex(plan, planIndex),
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

	return nil, fmt.Errorf("agent exceeded maximum iterations (%d)", maxIterations)
}

func (r *Runner) generateSync(ctx context.Context, messages []*ai.Message, enabledTools []ai.ToolRef) (*ai.ModelResponse, error) {
	return genkit.Generate(ctx, r.g,
		ai.WithModelName("openai-agent/"+r.model),
		ai.WithMessages(messages...),
		ai.WithTools(enabledTools...),
		ai.WithReturnToolRequests(true),
	)
}

func (r *Runner) generateStreaming(ctx context.Context, messages []*ai.Message, enabledTools []ai.ToolRef, reasoningCb func(string), tokenCb func(string), allReasoning *string) (*ai.ModelResponse, error) {
	var finalResp *ai.ModelResponse

	for sv, err := range genkit.GenerateStream(ctx, r.g,
		ai.WithModelName("openai-agent/"+r.model),
		ai.WithMessages(messages...),
		ai.WithTools(enabledTools...),
		ai.WithReturnToolRequests(true),
	) {
		if err != nil {
			return nil, err
		}

		if sv.Done {
			finalResp = sv.Response
			break
		}

		if sv.Chunk != nil {
			if reasoningCb != nil {
				if r := sv.Chunk.Reasoning(); r != "" {
					*allReasoning += r
					reasoningCb(r)
				}
			}
			if tokenCb != nil {
				if t := sv.Chunk.Text(); t != "" {
					tokenCb(t)
				}
			}
		}
	}

	if finalResp == nil {
		return nil, fmt.Errorf("streaming completed without final response")
	}

	return finalResp, nil
}

func parseToolInput(input any) map[string]any {
	if input == nil {
		return nil
	}
	if inputMap, ok := input.(map[string]any); ok {
		return inputMap
	}
	inputBytes, _ := json.Marshal(input)
	var inputMap map[string]any
	json.Unmarshal(inputBytes, &inputMap)
	return inputMap
}

func formatOutput(output any) string {
	if output == nil {
		return ""
	}
	if s, ok := output.(string); ok {
		return s
	}
	b, _ := json.Marshal(output)
	return string(b)
}

func getPlanIndex(plan *PlanResponse, planIndex int) *int {
	if plan != nil && planIndex < len(plan.Items) {
		return &planIndex
	}
	return nil
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
