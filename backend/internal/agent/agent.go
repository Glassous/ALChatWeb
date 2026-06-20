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
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

type StepCallback func(step AgentStep)

type AgentResult struct {
	Answer    string
	Reasoning string
}

type Runner struct {
	apiKey            string
	baseURL           string
	model             string
	registry          *tools.Registry
	db                *database.MongoDB
	client            *http.Client
	fialangchainURL   string
	fialangchainToken string
	bochaAPIKey       string
	tavilyAPIKey      string
}

func NewRunner(apiKey, baseURL, model string, registry *tools.Registry, db *database.MongoDB) *Runner {
	url := os.Getenv("FIALANGCHAIN_URL")
	if url == "" {
		url = "http://localhost:8086/api/v1/agent"
	}
	token := os.Getenv("FIALANGCHAIN_TOKEN")
	if token == "" {
		token = "your_secure_internal_token_here"
	}

	return &Runner{
		apiKey:            apiKey,
		baseURL:           baseURL,
		model:             model,
		registry:          registry,
		db:                db,
		client:            &http.Client{Timeout: 10 * time.Minute},
		fialangchainURL:   url,
		fialangchainToken: token,
		bochaAPIKey:       os.Getenv("BOCHA_API_KEY"),
		tavilyAPIKey:      os.Getenv("TAVILY_API_KEY"),
	}
}

type pythonSSEEvent struct {
	Type    string          `json:"type"`
	Content string          `json:"content,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type pythonChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type pythonModelConfig struct {
	Model        string  `json:"model"`
	Temperature  float64 `json:"temperature"`
	APIKey       string  `json:"api_key,omitempty"`
	BaseURL      string  `json:"base_url,omitempty"`
	BochaAPIKey  string  `json:"bocha_api_key,omitempty"`
	TavilyAPIKey string  `json:"tavily_api_key,omitempty"`
}

type pythonChatRequest struct {
	Messages     []pythonChatMessage `json:"messages"`
	SystemPrompt string              `json:"system_prompt"`
	Tools        []string            `json:"tools"`
	ModelConfig  pythonModelConfig   `json:"model_config"`
}

func (r *Runner) Run(ctx context.Context, messages []models.AIMessage, callback StepCallback) (*AgentResult, error) {
	var ans strings.Builder
	var reasoning strings.Builder
	
	_, err := r.RunWithStreaming(ctx, messages, callback, func(token string) {
		ans.WriteString(token)
	}, func(reas string) {
		reasoning.WriteString(reas)
	})
	if err != nil {
		return nil, err
	}

	return &AgentResult{
		Answer:    ans.String(),
		Reasoning: reasoning.String(),
	}, nil
}

func (r *Runner) RunWithStreaming(
	ctx context.Context,
	messages []models.AIMessage,
	stepCb StepCallback,
	tokenCb func(string),
	reasoningCb func(string),
) (*AgentResult, error) {
	return r.executePythonAgent(ctx, messages, "", r.model, stepCb, tokenCb, reasoningCb)
}

func (r *Runner) executePythonAgent(
	ctx context.Context,
	messages []models.AIMessage,
	systemPrompt string,
	model string,
	stepCb StepCallback,
	tokenCb func(string),
	reasoningCb func(string),
) (*AgentResult, error) {
	// 1. Gather enabled tools
	var enabledTools []string
	if r.registry != nil {
		for _, t := range r.registry.GetEnabledTools() {
			enabledTools = append(enabledTools, t.Name)
		}
	}

	// 2. Build Python Chat Request payload
	pyMessages := make([]pythonChatMessage, len(messages))
	for i, m := range messages {
		pyMessages[i] = pythonChatMessage{
			Role:    m.Role,
			Content: m.Content,
		}
	}

	pyReq := pythonChatRequest{
		Messages:     pyMessages,
		SystemPrompt: systemPrompt,
		Tools:        enabledTools,
		ModelConfig: pythonModelConfig{
			Model:        model,
			Temperature:  0.7,
			APIKey:       r.apiKey,
			BaseURL:      r.baseURL,
			BochaAPIKey:  r.bochaAPIKey,
			TavilyAPIKey: r.tavilyAPIKey,
		},
	}

	jsonData, err := json.Marshal(pyReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// 3. Make HTTP request to FiaLangChain
	url := fmt.Sprintf("%s/chat", r.fialangchainURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.fialangchainToken)

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request to FiaLangChain failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("FiaLangChain returned error status %d: %s", resp.StatusCode, string(body))
	}

	// 4. Stream SSE response
	reader := bufio.NewReader(resp.Body)
	var finalAnswer strings.Builder
	var finalReasoning strings.Builder

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, err
		}

		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}

		dataStr := strings.TrimPrefix(line, "data: ")
		var ev pythonSSEEvent
		if err := json.Unmarshal([]byte(dataStr), &ev); err != nil {
			log.Printf("[AgentClient] Failed to unmarshal SSE event: %v", err)
			continue
		}

		// Dispatch events to callbacks
		switch ev.Type {
		case "start":
			// Handled, nothing to do
		case "agent_plan":
			var plan PlanResponse
			if err := json.Unmarshal(ev.Data, &plan); err == nil {
				stepCb(AgentStep{Plan: &plan})
			}
		case "plan_item":
			var item struct {
				Index  int    `json:"index"`
				Status string `json:"status"`
			}
			if err := json.Unmarshal(ev.Data, &item); err == nil {
				toolName := "plan_progress"
				if item.Status == "completed" {
					toolName = "plan_item"
				}
				stepCb(AgentStep{
					ToolName:  toolName,
					PlanIndex: &item.Index,
				})
			}
		case "agent_step":
			var step struct {
				Index      int            `json:"index"`
				ToolName   string         `json:"tool_name"`
				ToolInput  string         `json:"tool_input"`
				ToolOutput string         `json:"tool_output"`
				Err        string         `json:"err"`
				PlanIndex  *int           `json:"plan_index,omitempty"`
			}
			if err := json.Unmarshal(ev.Data, &step); err == nil {
				var inputMap map[string]any
				_ = json.Unmarshal([]byte(step.ToolInput), &inputMap)

				stepCb(AgentStep{
					Index:      step.Index,
					ToolName:   step.ToolName,
					ToolInput:  inputMap,
					ToolOutput: step.ToolOutput,
					Err:        step.Err,
					PlanIndex:  step.PlanIndex,
				})

				if step.Err == "" && tokenCb != nil {
					// weather 工具: 将天气数据注入到消息内容流中，用于前端渲染天气卡片
					if step.ToolName == "weather" {
						var wRes map[string]any
						if json.Unmarshal([]byte(step.ToolOutput), &wRes) == nil {
							if weatherJSON, ok := wRes["weather_data"].(string); ok {
								weatherTag := fmt.Sprintf("<weather>%s</weather>\n", weatherJSON)
								tokenCb(weatherTag)
								finalAnswer.WriteString(weatherTag)
							}
						}
					}
					// web_search 不再注入 <search> 标签:
					// agent 模式下搜索结果已通过 agent_step 事件和 AgentSteps 字段完整传递，
					// 额外注入会导致 Android/Web 出现重复的搜索卡片。
				}
			}
		case "reasoning":
			finalReasoning.WriteString(ev.Content)
			if reasoningCb != nil {
				reasoningCb(ev.Content)
			}
		case "token":
			finalAnswer.WriteString(ev.Content)
			if tokenCb != nil {
				tokenCb(ev.Content)
			}
		case "error":
			return nil, fmt.Errorf("Python Agent error: %s", ev.Content)
		case "done":
			return &AgentResult{
				Answer:    finalAnswer.String(),
				Reasoning: finalReasoning.String(),
			}, nil
		}
	}

	return &AgentResult{
		Answer:    finalAnswer.String(),
		Reasoning: finalReasoning.String(),
	}, nil
}

// Registry and Tool Management functions delegated to local MongoDB state

func (r *Runner) GetToolNames() []string {
	var names []string
	if r.registry == nil {
		return names
	}
	for _, t := range r.registry.GetAllTools() {
		names = append(names, t.Name)
	}
	return names
}

func (r *Runner) GetToolDescriptions() map[string]string {
	descs := make(map[string]string)
	if r.registry == nil {
		return descs
	}
	for _, t := range r.registry.GetAllTools() {
		descs[t.Name] = t.Description
	}
	return descs
}

func (r *Runner) IsToolEnabled(name string) bool {
	if r.registry == nil {
		return false
	}
	t, ok := r.registry.GetToolMeta(name)
	if !ok {
		return false
	}
	return t.Enabled
}

func (r *Runner) SetToolEnabled(name string, enabled bool) {
	if r.registry != nil {
		r.registry.SetEnabled(name, enabled)
	}
}

func (r *Runner) SaveToolStates(ctx context.Context) error {
	if r.db == nil || r.registry == nil {
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
	if r.db == nil || r.registry == nil {
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
