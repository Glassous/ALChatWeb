package agent

import (
	"alchat-backend/internal/agent/tools"
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

type StepCallback func(step AgentStep)

type AgentResult struct {
	Answer    string
	Reasoning string
}

type Runner struct {
	apiKey   string
	baseURL  string
	model    string
	registry *tools.Registry
	db       *database.MongoDB
}

func NewRunner(apiKey, baseURL, model string, registry *tools.Registry, db *database.MongoDB) *Runner {
	return &Runner{
		apiKey:   apiKey,
		baseURL:  baseURL,
		model:    model,
		registry: registry,
		db:       db,
	}
}

type openAIToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type openAIToolCall struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`
	Function openAIToolCallFunction `json:"function"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    any              `json:"content"`
	Name       string           `json:"name,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
}

type streamToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type streamToolCall struct {
	Index    *int                   `json:"index,omitempty"`
	ID       string                 `json:"id,omitempty"`
	Type     string                 `json:"type,omitempty"`
	Function streamToolCallFunction `json:"function,omitempty"`
}

var toolParameters = map[string]any{
	"calculator": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"expression": map[string]any{
				"type":        "string",
				"description": "Math expression to evaluate",
			},
		},
		"required": []string{"expression"},
	},
	"get_time": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"timezone": map[string]any{
				"type":        "string",
				"description": "Optional timezone, e.g. Asia/Shanghai, America/New_York",
			},
		},
	},
	"weather": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"location": map[string]any{
				"type":        "string",
				"description": "City name, e.g. 北京, Shanghai",
			},
			"latitude": map[string]any{
				"type":        "number",
				"description": "Latitude coordinate",
			},
			"longitude": map[string]any{
				"type":        "number",
				"description": "Longitude coordinate",
			},
		},
	},
	"web_search": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "Search query keywords",
			},
		},
		"required": []string{"query"},
	},
}

func (r *Runner) Run(ctx context.Context, messages []models.AIMessage, callback StepCallback) (*AgentResult, error) {
	if r.model == "" {
		return nil, fmt.Errorf("agent model not configured")
	}

	enabledTools := r.registry.GetEnabledTools()
	if len(enabledTools) == 0 {
		return nil, fmt.Errorf("no tools available")
	}

	plan, err := r.generatePlan(ctx, messages, enabledTools)
	if err != nil {
		log.Printf("[Agent] Plan generation failed, falling back to no-plan mode: %v", err)
	}

	if plan != nil && len(plan.Items) > 0 {
		callback(AgentStep{Plan: plan})
		return r.runLoop(ctx, messages, enabledTools, callback, plan, nil, nil)
	}

	return r.runLoop(ctx, messages, enabledTools, callback, nil, nil, nil)
}

func (r *Runner) RunWithStreaming(ctx context.Context, messages []models.AIMessage, stepCb StepCallback, tokenCb func(string), reasoningCb func(string)) (*AgentResult, error) {
	if r.model == "" {
		return nil, fmt.Errorf("agent model not configured")
	}

	enabledTools := r.registry.GetEnabledTools()
	if len(enabledTools) == 0 {
		return nil, fmt.Errorf("no tools available")
	}

	plan, err := r.generatePlan(ctx, messages, enabledTools)
	if err != nil {
		log.Printf("[Agent] Plan generation failed, falling back to no-plan mode: %v", err)
	}

	if plan != nil && len(plan.Items) > 0 {
		stepCb(AgentStep{Plan: plan})
		return r.runLoop(ctx, messages, enabledTools, stepCb, plan, tokenCb, reasoningCb)
	}

	return r.runLoop(ctx, messages, enabledTools, stepCb, nil, tokenCb, reasoningCb)
}

func (r *Runner) runLoop(
	ctx context.Context,
	messages []models.AIMessage,
	enabledTools []tools.ToolMeta,
	callback StepCallback,
	plan *PlanResponse,
	tokenCb func(string),
	reasoningCb func(string),
) (*AgentResult, error) {
	maxIterations := 10
	iteration := 0
	planIndex := 0

	var oaiMessages []openAIMessage
	for _, m := range messages {
		oaiMessages = append(oaiMessages, openAIMessage{
			Role:    m.Role,
			Content: m.Content,
		})
	}

	var allReasoning strings.Builder

	for iteration < maxIterations {
		iteration++

		// Define streaming token and reasoning callbacks
		var currentReasoning strings.Builder
		tCb := func(token string) {
			if tokenCb != nil {
				tokenCb(token)
			}
		}
		rCb := func(reasoning string) {
			currentReasoning.WriteString(reasoning)
			allReasoning.WriteString(reasoning)
			if reasoningCb != nil {
				reasoningCb(reasoning)
			}
		}

		toolCalls, finalContent, err := r.callChatCompletionsStream(ctx, oaiMessages, enabledTools, tCb, rCb)
		if err != nil {
			return nil, fmt.Errorf("generation error: %w", err)
		}

		if len(toolCalls) == 0 {
			return &AgentResult{
				Answer:    finalContent,
				Reasoning: allReasoning.String(),
			}, nil
		}

		if plan != nil && planIndex < len(plan.Items) {
			callback(AgentStep{
				Index:     iteration,
				ToolName:  "plan_progress",
				PlanIndex: &planIndex,
			})
		}

		// Save the assistant message with tool calls delta
		assistantMsg := openAIMessage{
			Role:      "assistant",
			ToolCalls: toolCalls,
		}
		if finalContent != "" {
			assistantMsg.Content = finalContent
		}
		oaiMessages = append(oaiMessages, assistantMsg)

		for _, tc := range toolCalls {
			inputMap := parseToolInput(tc.Function.Arguments)

			toolMeta, exists := r.registry.GetToolMeta(tc.Function.Name)
			if !exists {
				errOutput := map[string]any{"error": fmt.Sprintf("tool %s not found", tc.Function.Name)}
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tc.Function.Name,
					ToolInput:  inputMap,
					ToolOutput: formatOutput(errOutput),
					Err:        fmt.Sprintf("tool %s not found", tc.Function.Name),
					PlanIndex:  getPlanIndex(plan, planIndex),
				})
				oaiMessages = append(oaiMessages, openAIMessage{
					Role:       "tool",
					ToolCallID: tc.ID,
					Name:       tc.Function.Name,
					Content:    formatOutput(errOutput),
				})
				continue
			}

			output, err := toolMeta.Fn(ctx, inputMap)
			if err != nil {
				errOutput := map[string]any{"error": err.Error()}
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tc.Function.Name,
					ToolInput:  inputMap,
					ToolOutput: formatOutput(errOutput),
					Err:        err.Error(),
					PlanIndex:  getPlanIndex(plan, planIndex),
				})
				oaiMessages = append(oaiMessages, openAIMessage{
					Role:       "tool",
					ToolCallID: tc.ID,
					Name:       tc.Function.Name,
					Content:    formatOutput(errOutput),
				})
			} else {
				callback(AgentStep{
					Index:      iteration,
					ToolName:   tc.Function.Name,
					ToolInput:  inputMap,
					ToolOutput: formatOutput(output),
					PlanIndex:  getPlanIndex(plan, planIndex),
				})
				oaiMessages = append(oaiMessages, openAIMessage{
					Role:       "tool",
					ToolCallID: tc.ID,
					Name:       tc.Function.Name,
					Content:    formatOutput(output),
				})
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
	}

	return nil, fmt.Errorf("agent exceeded maximum iterations (%d)", maxIterations)
}

func (r *Runner) callChatCompletionsStream(
	ctx context.Context,
	oaiMessages []openAIMessage,
	enabledTools []tools.ToolMeta,
	tokenCb func(string),
	reasoningCb func(string),
) ([]openAIToolCall, string, error) {
	var toolsParam []any
	for _, t := range enabledTools {
		paramSchema, exists := toolParameters[t.Name]
		if !exists {
			paramSchema = map[string]any{
				"type": "object",
			}
		}
		toolsParam = append(toolsParam, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  paramSchema,
			},
		})
	}

	requestBodyMap := map[string]any{
		"model":    r.model,
		"messages": oaiMessages,
		"stream":   true,
		"thinking": map[string]any{
			"type": "disabled",
		},
	}
	if len(toolsParam) > 0 {
		requestBodyMap["tools"] = toolsParam
	}

	requestBodyBytes, err := json.Marshal(requestBodyMap)
	if err != nil {
		return nil, "", err
	}

	url := fmt.Sprintf("%s/chat/completions", r.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(requestBodyBytes))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", r.apiKey))

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, "", fmt.Errorf("Agent model API error (status %d): %s", resp.StatusCode, string(body))
	}

	reader := bufio.NewReader(resp.Body)
	accumulatedTools := make(map[int]*openAIToolCall)
	var finalTextBuilder strings.Builder

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, "", err
		}

		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		type streamResponse struct {
			Choices []struct {
				Delta struct {
					Content          string           `json:"content"`
					ReasoningContent string           `json:"reasoning_content"`
					ToolCalls        []streamToolCall `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
		}

		var chunk streamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta
			if delta.Content != "" {
				finalTextBuilder.WriteString(delta.Content)
				if tokenCb != nil {
					tokenCb(delta.Content)
				}
			}
			if delta.ReasoningContent != "" {
				if reasoningCb != nil {
					reasoningCb(delta.ReasoningContent)
				}
			}
			for _, tc := range delta.ToolCalls {
				idx := 0
				if tc.Index != nil {
					idx = *tc.Index
				}
				acc, exists := accumulatedTools[idx]
				if !exists {
					acc = &openAIToolCall{
						Type: "function",
					}
					accumulatedTools[idx] = acc
				}
				if tc.ID != "" {
					acc.ID = tc.ID
				}
				if tc.Function.Name != "" {
					acc.Function.Name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					acc.Function.Arguments += tc.Function.Arguments
				}
			}
		}
	}

	var toolCalls []openAIToolCall
	for i := 0; i < len(accumulatedTools); i++ {
		if tc, exists := accumulatedTools[i]; exists {
			toolCalls = append(toolCalls, *tc)
		}
	}
	if len(toolCalls) == 0 && len(accumulatedTools) > 0 {
		for _, tc := range accumulatedTools {
			toolCalls = append(toolCalls, *tc)
		}
	}

	return toolCalls, finalTextBuilder.String(), nil
}

func parseToolInput(arguments string) map[string]any {
	if arguments == "" {
		return nil
	}
	var inputMap map[string]any
	if err := json.Unmarshal([]byte(arguments), &inputMap); err != nil {
		return map[string]any{"arguments": arguments}
	}
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

func (r *Runner) generatePlan(ctx context.Context, messages []models.AIMessage, enabledTools []tools.ToolMeta) (*PlanResponse, error) {
	var toolDescs []map[string]string
	for _, t := range enabledTools {
		toolDescs = append(toolDescs, map[string]string{
			"name":        t.Name,
			"description": t.Description,
		})
	}

	toolDescJSON, _ := json.Marshal(toolDescs)

	planPrompt := fmt.Sprintf(`你是一个任务规划助手。根据用户的问题和可用工具，制定一个执行计划。

可用工具：
%s

请以JSON格式返回执行计划，格式如下：
{"items": [{"id": 1, "description": "步骤描述", "tool_name": "工具名"}, ...]}

如果不需要任何工具，返回空数组：{"items": []}
只返回JSON，不要包含其他内容。`, string(toolDescJSON))

	var oaiMessages []openAIMessage
	oaiMessages = append(oaiMessages, openAIMessage{
		Role:    "system",
		Content: planPrompt,
	})
	for _, m := range messages {
		oaiMessages = append(oaiMessages, openAIMessage{
			Role:    m.Role,
			Content: m.Content,
		})
	}

	requestBodyMap := map[string]any{
		"model":    r.model,
		"messages": oaiMessages,
		"thinking": map[string]any{
			"type": "disabled",
		},
	}

	requestBodyBytes, err := json.Marshal(requestBodyMap)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/chat/completions", r.baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(requestBodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", r.apiKey))

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("plan generation model API error (status %d): %s", resp.StatusCode, string(body))
	}

	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, err
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no choices returned in plan generation")
	}

	text := cleanJSONString(response.Choices[0].Message.Content)

	var plan PlanResponse
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

func cleanJSONString(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimPrefix(s, "json")
		s = strings.TrimSuffix(s, "```")
		s = strings.TrimSpace(s)
	}
	return s
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
