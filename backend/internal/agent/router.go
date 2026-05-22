package agent

import (
	"alchat-backend/internal/models"
	"context"
	"fmt"
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
	searchCb func(query string) (string, error),
) (*AgentResult, error) {
	enabledTools := r.registry.GetEnabledTools()

	var oaiMessages []openAIMessage
	for _, m := range messages {
		oaiMessages = append(oaiMessages, openAIMessage{
			Role:    m.Role,
			Content: m.Content,
		})
	}

	var allReasoning strings.Builder
	tCb := func(token string) {
		if tokenCb != nil {
			tokenCb(token)
		}
	}
	rCb := func(reasoning string) {
		allReasoning.WriteString(reasoning)
		if reasoningCb != nil {
			reasoningCb(reasoning)
		}
	}

	// Step 1: Run with Daily Model
	toolCalls, finalContent, err := r.callChatCompletionsStreamWith(
		ctx,
		cfg.DailyAPIKey,
		cfg.DailyBaseURL,
		cfg.DailyModel,
		oaiMessages,
		enabledTools,
		tCb,
		rCb,
	)
	if err != nil {
		return nil, fmt.Errorf("daily router step 1 completion error: %w", err)
	}

	if len(toolCalls) == 0 {
		return &AgentResult{
			Answer:    finalContent,
			Reasoning: allReasoning.String(),
		}, nil
	}

	// Check if generate_image or web_search is in the tool calls
	var hasImageGen bool
	var imageGenCall openAIToolCall
	var hasWebSearch bool
	var webSearchCall openAIToolCall
	var otherCalls []openAIToolCall

	for _, tc := range toolCalls {
		if tc.Function.Name == "generate_image" {
			hasImageGen = true
			imageGenCall = tc
			break // Priority to image generation
		} else if tc.Function.Name == "web_search" {
			hasWebSearch = true
			webSearchCall = tc
		} else {
			otherCalls = append(otherCalls, tc)
		}
	}

	// Case 1: Image Generation Tool
	if hasImageGen {
		inputMap := parseToolInput(imageGenCall.Function.Arguments)
		prompt, _ := inputMap["prompt"].(string)
		resolution, _ := inputMap["resolution"].(string)
		if resolution == "" {
			resolution = "2048x2048"
		}

		if cfg.ImageSvc == nil {
			return nil, fmt.Errorf("image generation service not configured")
		}

		if cfg.ImageGenStartCb != nil {
			cfg.ImageGenStartCb(resolution)
		}

		ossURL, err := cfg.ImageSvc.GenerateAndUploadImage(ctx, prompt, resolution, "")
		if err != nil {
			return nil, fmt.Errorf("failed to generate image: %w", err)
		}

		// Send image markdown/tag token
		imgToken := fmt.Sprintf("<image src=%q>", ossURL)
		tCb(imgToken)

		return &AgentResult{
			Answer:    imgToken,
			Reasoning: allReasoning.String(),
		}, nil
	}

	// Case 2: Web Search Tool (Context Injection Pattern)
	if hasWebSearch {
		inputMap := parseToolInput(webSearchCall.Function.Arguments)
		query, _ := inputMap["query"].(string)

		searchContext, err := searchCb(query)
		if err != nil {
			return nil, fmt.Errorf("failed to perform search: %w", err)
		}

		// Inject searchContext into the last User message in oaiMessages
		lastMsgIdx := -1
		for i := len(oaiMessages) - 1; i >= 0; i-- {
			if oaiMessages[i].Role == "user" {
				lastMsgIdx = i
				break
			}
		}
		if lastMsgIdx == -1 {
			// Fallback: if no user message exists (should not happen), use the last message
			lastMsgIdx = len(oaiMessages) - 1
		}

		originalUserQuery, _ := oaiMessages[lastMsgIdx].Content.(string)

		var injectedBuilder strings.Builder
		injectedBuilder.WriteString("【联网检索背景参考资料】\n")
		injectedBuilder.WriteString(searchContext)
		injectedBuilder.WriteString("\n\n请结合上述最新的联网搜索信息，用通俗易懂的语言详细回答用户的问题。如果搜索结果不相关，请基于您的知识库作答。\n")
		injectedBuilder.WriteString("用户提问：")
		injectedBuilder.WriteString(originalUserQuery)

		oaiMessages[lastMsgIdx].Content = injectedBuilder.String()

		// Append standard system prompt instructing the model on citations
		systemPrompt := "你是一个具备联网搜索能力的助手。请根据提供的搜索结果回答用户的问题。\n\n" +
			"**引用要求**：\n" +
			"1. 当你引用搜索结果中的信息时，必须在对应的语句末尾使用 `ref(n)` 格式进行标注，其中 n 是引用来源序号 (从 1 开始).\n" +
			"2. 例如：根据某项研究表明，地球是圆的 ref(1)。\n" +
			"3. 如果一条语句引用了多个来源，请使用多个标注，如：ref(1) ref(2)。\n" +
			"4. 如果搜索结果不相关，请根据你的知识储备回答，并告知用户搜索结果可能不完全匹配。"

		oaiMessages = append(oaiMessages, openAIMessage{
			Role:    "system",
			Content: systemPrompt,
		})

		// Stream the final answer using daily model with enabledTools = nil
		_, finalContent, err := r.callChatCompletionsStreamWith(
			ctx,
			cfg.DailyAPIKey,
			cfg.DailyBaseURL,
			cfg.DailyModel,
			oaiMessages,
			nil, // Setting enabledTools to nil disables the tools parameter in the API payload
			tCb,
			rCb,
		)
		if err != nil {
			return nil, fmt.Errorf("daily router step 2 search response completion error: %w", err)
		}

		return &AgentResult{
			Answer:    finalContent,
			Reasoning: allReasoning.String(),
		}, nil
	}

	// Case 3: Other ReAct Tools (weather, calculator, get_time, etc.)
	// 1. Append assistant message containing the tool calls
	assistantMsg := openAIMessage{
		Role:      "assistant",
		ToolCalls: toolCalls,
	}
	oaiMessages = append(oaiMessages, assistantMsg)

	// 2. Execute each tool call
	for _, tc := range otherCalls {
		inputMap := parseToolInput(tc.Function.Arguments)
		toolMeta, exists := r.registry.GetToolMeta(tc.Function.Name)
		if !exists {
			errOutput := map[string]any{"error": fmt.Sprintf("tool %s not found", tc.Function.Name)}
			stepCb(AgentStep{
				Index:      1,
				ToolName:   tc.Function.Name,
				ToolInput:  inputMap,
				ToolOutput: formatOutput(errOutput),
				Err:        fmt.Sprintf("tool %s not found", tc.Function.Name),
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
			stepCb(AgentStep{
				Index:      1,
				ToolName:   tc.Function.Name,
				ToolInput:  inputMap,
				ToolOutput: formatOutput(errOutput),
				Err:        err.Error(),
			})
			oaiMessages = append(oaiMessages, openAIMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Name:       tc.Function.Name,
				Content:    formatOutput(errOutput),
			})
		} else {
			stepCb(AgentStep{
				Index:      1,
				ToolName:   tc.Function.Name,
				ToolInput:  inputMap,
				ToolOutput: formatOutput(output),
			})
			oaiMessages = append(oaiMessages, openAIMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Name:       tc.Function.Name,
				Content:    formatOutput(output),
			})
		}
	}

	// 3. Transition to Agent Model for subsequent ReAct loop turns
	return r.runLoopInternal(
		ctx,
		cfg.AgentAPIKey,
		cfg.AgentBaseURL,
		cfg.AgentModel,
		oaiMessages,
		enabledTools,
		stepCb,
		nil, // No plan for auto-routed steps
		tokenCb,
		reasoningCb,
	)
}
