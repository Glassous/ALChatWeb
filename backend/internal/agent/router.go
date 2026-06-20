package agent

import (
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
)

type ImageGenerator interface {
	GenerateAndUploadImage(ctx context.Context, prompt, resolution, refImg string) (string, error)
}

type DailyRouterConfig struct {
	// First Step: Daily Model (Routing + Direct Answer)
	DailyAPIKey  string
	DailyBaseURL string
	DailyModel   string
	// Second Step: Agent Model (ReAct Loop)
	AgentAPIKey  string
	AgentBaseURL string
	AgentModel   string
	// Image Generation Service
	ImageSvc        ImageGenerator
	ImageGenStartCb func(resolution string)
}

func (r *Runner) RunDailyRouter(
	ctx context.Context,
	messages []models.AIMessage,
	cfg DailyRouterConfig,
	stepCb StepCallback,
	tokenCb func(string),
	reasoningCb func(string),
	searchCb func(query string, source string) (string, error),
) (*AgentResult, error) {
	// 1. Gather enabled tools - Daily mode is restricted ONLY to "web_search" for physical isolation
	enabledTools := []string{"web_search"}

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
		SystemPrompt: "", // Optional system prompt
		Tools:        enabledTools,
		ModelConfig: pythonModelConfig{
			Model:        cfg.DailyModel, // Use the Daily Model config
			Temperature:  0.7,
			APIKey:       cfg.DailyAPIKey,
			BaseURL:      cfg.DailyBaseURL,
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

	// 4. Stream SSE response and inject tags dynamically
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

		switch ev.Type {
		case "start":
			// Handled
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

				// Invoke callback so step info is logged
				stepCb(AgentStep{
					Index:      step.Index,
					ToolName:   step.ToolName,
					ToolInput:  inputMap,
					ToolOutput: step.ToolOutput,
					Err:        step.Err,
					PlanIndex:  step.PlanIndex,
				})

				if step.Err == "" {
					// Catch Weather tool to stream <weather> XML tag
					if step.ToolName == "weather" {
						var wRes map[string]any
						if json.Unmarshal([]byte(step.ToolOutput), &wRes) == nil {
							if weatherJSON, ok := wRes["weather_data"].(string); ok {
								weatherTag := fmt.Sprintf("<weather>%s</weather>\n", weatherJSON)
								tokenCb(weatherTag)
							}
						}
					}

					// Catch Web Search tool to stream <search> XML tag
					if step.ToolName == "web_search" {
						var sRes map[string]any
						if json.Unmarshal([]byte(step.ToolOutput), &sRes) == nil {
							sourceVal, _ := sRes["source"].(string)
							if sourceVal == "" {
								sourceVal = "bocha"
							}
							searchJSON, _ := json.Marshal(map[string]any{
								"query":   sRes["query"],
								"results": sRes["results"],
								"source":  sourceVal,
							})
							searchTag := fmt.Sprintf("\n<search>%s</search>\n", string(searchJSON))
							tokenCb(searchTag)
						}
					}

					// Catch Generate Image tool to generate actual image via Go Volcengine Svc
					if step.ToolName == "generate_image" && cfg.ImageSvc != nil {
						prompt, _ := inputMap["prompt"].(string)
						resolution, _ := inputMap["resolution"].(string)
						if resolution == "" {
							resolution = "2048x2048"
						}

						if cfg.ImageGenStartCb != nil {
							cfg.ImageGenStartCb(resolution)
						}

						ossURL, err := cfg.ImageSvc.GenerateAndUploadImage(ctx, prompt, resolution, "")
						if err == nil {
							imgToken := fmt.Sprintf("<image src=%q>", ossURL)
							tokenCb(imgToken)
							finalAnswer.WriteString(imgToken)
						} else {
							log.Printf("[AgentClient] Image generation failed: %v", err)
						}
					}
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
			return nil, fmt.Errorf("Python Daily Router Agent error: %s", ev.Content)
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
