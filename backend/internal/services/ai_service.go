package services

import (
	"alchat-backend/internal/models"
	"alchat-backend/internal/utils"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
)

type AIService struct {
	mu                sync.RWMutex
	apiKey            string
	baseURL           string
	model             string
	expertAPIKey      string
	expertBaseURL     string
	expertModel       string
	titleAPIKey       string
	titleBaseURL      string
	titleModel        string
	searchAPIKey      string
	searchBaseURL     string
	searchModel       string
	multimodalAPIKey  string
	multimodalBaseURL string
	multimodalModel   string
	bochaAPIKey       string
	searchService     *SearchService
	agentAPIKey       string
	agentBaseURL      string
	agentModel        string
	alingAPIKey       string
	alingBaseURL      string
	alingModel        string
}

func NewAIService(apiKey, baseURL, model, expertAPIKey, expertBaseURL, expertModel, titleAPIKey, titleBaseURL, titleModel, searchAPIKey, searchBaseURL, searchModel, bochaAPIKey, multimodalAPIKey, multimodalBaseURL, multimodalModel, agentAPIKey, agentBaseURL, agentModel, alingAPIKey, alingBaseURL, alingModel string) (*AIService, error) {
	s := &AIService{
		apiKey:            apiKey,
		baseURL:           baseURL,
		model:             model,
		expertAPIKey:      expertAPIKey,
		expertBaseURL:     expertBaseURL,
		expertModel:       expertModel,
		titleAPIKey:       titleAPIKey,
		titleBaseURL:      titleBaseURL,
		titleModel:        titleModel,
		searchAPIKey:      searchAPIKey,
		searchBaseURL:     searchBaseURL,
		searchModel:       searchModel,
		multimodalAPIKey:  multimodalAPIKey,
		multimodalBaseURL: multimodalBaseURL,
		multimodalModel:   multimodalModel,
		bochaAPIKey:       bochaAPIKey,
		searchService:     NewSearchService(bochaAPIKey),
		agentAPIKey:       agentAPIKey,
		agentBaseURL:      agentBaseURL,
		agentModel:        agentModel,
		alingAPIKey:       alingAPIKey,
		alingBaseURL:      alingBaseURL,
		alingModel:        alingModel,
	}
	return s, nil
}

func (s *AIService) UpdateConfig(mode, apiKey, baseURL, model string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	log.Printf("[AIService] Updating config for mode: %s, model: %s, baseURL: %s, key length: %d", mode, model, baseURL, len(apiKey))
	switch mode {
	case "daily":
		if baseURL != "" {
			s.baseURL = baseURL
		}
		if apiKey != "" {
			s.apiKey = apiKey
		}
		if model != "" {
			s.model = model
		}
	case "expert":
		if baseURL != "" {
			s.expertBaseURL = baseURL
		}
		if apiKey != "" {
			s.expertAPIKey = apiKey
		}
		if model != "" {
			s.expertModel = model
		}
	case "title":
		if baseURL != "" {
			s.titleBaseURL = baseURL
		}
		if apiKey != "" {
			s.titleAPIKey = apiKey
		}
		if model != "" {
			s.titleModel = model
		}
	case "search":
		if baseURL != "" {
			s.searchBaseURL = baseURL
		}
		if apiKey != "" {
			s.searchAPIKey = apiKey
		}
		if model != "" {
			s.searchModel = model
		}
	case "multimodal":
		if baseURL != "" {
			s.multimodalBaseURL = baseURL
		}
		if apiKey != "" {
			s.multimodalAPIKey = apiKey
		}
		if model != "" {
			s.multimodalModel = model
		}
	case "agent":
		if baseURL != "" {
			s.agentBaseURL = baseURL
		}
		if apiKey != "" {
			s.agentAPIKey = apiKey
		}
		if model != "" {
			s.agentModel = model
		}
	case "aling":
		if baseURL != "" {
			s.alingBaseURL = baseURL
		}
		if apiKey != "" {
			s.alingAPIKey = apiKey
		}
		if model != "" {
			s.alingModel = model
		}
	}
	return nil
}

type SearchCallback func(data models.SearchData) error

// GenerateKeywords generates search keywords based on conversation history
func (s *AIService) GenerateKeywords(ctx context.Context, messages []models.AIMessage) (string, int, int, error) {
	s.mu.RLock()
	apiKey := s.searchAPIKey
	baseURL := s.searchBaseURL
	model := s.searchModel
	s.mu.RUnlock()

	// 1. Prepare messages for keyword generation
	keywordPrompt := "你是一个搜索专家。根据提供的对话历史，总结出 1-3 个最适合用于联网搜索的联网搜索关键词或短语。要求：1. 关键词应简洁、准确；2. 只输出关键词，用空格分隔；3. 不要包含任何解释或标点符号。"

	keywordMessages := []models.AIMessage{
		{
			Role:    "system",
			Content: keywordPrompt,
		},
	}
	// Only use the last few messages for keyword generation to keep it focused and save tokens
	historyLimit := 5
	start := 0
	if len(messages) > historyLimit {
		start = len(messages) - historyLimit
	}
	keywordMessages = append(keywordMessages, messages[start:]...)

	// 2. Call AI (non-streaming)
	var keywords strings.Builder
	err := s.generateCustomStream(ctx, keywordMessages, apiKey, baseURL, model, false, func(token string, reasoning string) error {
		keywords.WriteString(token)
		return nil
	})

	if err != nil {
		return "", 0, 0, err
	}

	result := strings.TrimSpace(keywords.String())
	if result == "" {
		// Fallback to the last message content if keyword generation fails
		if len(messages) > 0 {
			result = messages[len(messages)-1].Content
		}
	}

	// Calculate tokens
	var inputBuilder strings.Builder
	inputBuilder.WriteString(keywordPrompt)
	for _, m := range messages[start:] {
		inputBuilder.WriteString(m.Content)
	}

	inputTokens := utils.CountTokens(inputBuilder.String())
	outputTokens := utils.CountTokens(result)

	return result, inputTokens, outputTokens, nil
}

// GenerateStream generates AI response with streaming
func (s *AIService) GenerateStream(ctx context.Context, messages []models.AIMessage, mode string, userSystemPrompt string, callback func(token string, reasoning string) error, searchCallback SearchCallback) (int, int, error) {
	// Prepend user system prompt if provided
	if userSystemPrompt != "" {
		messages = append([]models.AIMessage{
			{
				Role:    "system",
				Content: userSystemPrompt,
			},
		}, messages...)
	}

	// Check if any message contains multimodal content (<file> or <image> tags)
	hasMultimodal := false
	for _, m := range messages {
		if strings.Contains(m.Content, "<file") || strings.Contains(m.Content, "<image") {
			hasMultimodal = true
			break
		}
	}

	s.mu.RLock()
	multimodalAPIKey := s.multimodalAPIKey
	dailyModel := s.model
	dailyAPIKey := s.apiKey
	dailyBaseURL := s.baseURL
	s.mu.RUnlock()

	if hasMultimodal && multimodalAPIKey != "" {
		err := s.generateMultimodalStream(ctx, messages, callback)
		return 0, 0, err
	}

	if mode == "expert" {
		err := s.generateExpertStream(ctx, messages, callback)
		return 0, 0, err
	}

	if mode == "search" {
		return s.generateSearchStream(ctx, messages, callback, searchCallback)
	}

	// Daily mode: direct HTTP stream with thinking disabled
	err := s.generateCustomStream(ctx, messages, dailyAPIKey, dailyBaseURL, dailyModel, false, callback)
	return 0, 0, err
}

// GeneratePlainStream bypasses Genkit and calls the model directly via HTTP
func (s *AIService) GeneratePlainStream(ctx context.Context, messages []models.AIMessage, callback func(token string, reasoning string) error) error {
	s.mu.RLock()
	apiKey := s.apiKey
	baseURL := s.baseURL
	model := s.model
	s.mu.RUnlock()

	return s.generateCustomStream(ctx, messages, apiKey, baseURL, model, false, callback)
}

func (s *AIService) GenerateALingStream(ctx context.Context, messages []models.AIMessage, callback func(token string, reasoning string) error) error {
	s.mu.RLock()
	apiKey := s.alingAPIKey
	baseURL := s.alingBaseURL
	model := s.alingModel
	s.mu.RUnlock()

	return s.generateCustomStream(ctx, messages, apiKey, baseURL, model, false, callback)
}

func (s *AIService) generateExpertStream(ctx context.Context, messages []models.AIMessage, callback func(token string, reasoning string) error) error {
	s.mu.RLock()
	apiKey := s.expertAPIKey
	baseURL := s.expertBaseURL
	model := s.expertModel
	s.mu.RUnlock()
	return s.generateCustomStream(ctx, messages, apiKey, baseURL, model, true, callback)
}

func (s *AIService) generateMultimodalStream(ctx context.Context, messages []models.AIMessage, callback func(token string, reasoning string) error) error {
	s.mu.RLock()
	apiKey := s.multimodalAPIKey
	baseURL := s.multimodalBaseURL
	model := s.multimodalModel
	s.mu.RUnlock()

	type oaiContent struct {
		Type     string         `json:"type"`
		Text     string         `json:"text,omitempty"`
		ImageURL map[string]any `json:"image_url,omitempty"`
	}

	type oaiMessage struct {
		Role    string       `json:"role"`
		Content []oaiContent `json:"content"`
	}

	var oaiMessages []oaiMessage
	for _, m := range messages {
		role := "user"
		switch m.Role {
		case "assistant":
			role = "assistant"
		case "system":
			role = "system"
		}

		var contents []oaiContent
		text := m.Content
		imageRe := regexp.MustCompile(`<(image|file) src="([^"]+)">`)
		matches := imageRe.FindAllStringSubmatch(text, -1)

		lastIdx := 0
		for _, match := range matches {
			fullMatch := match[0]
			url := match[2]
			idx := strings.Index(text[lastIdx:], fullMatch)

			if idx > 0 {
				contents = append(contents, oaiContent{
					Type: "text",
					Text: text[lastIdx : lastIdx+idx],
				})
			}

			contents = append(contents, oaiContent{
				Type: "image_url",
				ImageURL: map[string]any{
					"url": url,
				},
			})

			lastIdx += idx + len(fullMatch)
		}

		if lastIdx < len(text) {
			remaining := text[lastIdx:]
			if remaining != "" {
				contents = append(contents, oaiContent{
					Type: "text",
					Text: remaining,
				})
			}
		}

		oaiMessages = append(oaiMessages, oaiMessage{
			Role:    role,
			Content: contents,
		})
	}

	requestBody, err := json.Marshal(map[string]any{
		"model":    model,
		"messages": oaiMessages,
		"stream":   true,
		"thinking": map[string]any{
			"type": "disabled",
		},
	})
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/chat/completions", baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(requestBody)))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Multimodal AI API error (status %d): %s", resp.StatusCode, string(body))
	}

	reader := io.Reader(resp.Body)
	buf := make([]byte, 4096)
	var remainder string

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			chunk := remainder + string(buf[:n])
			lines := strings.Split(chunk, "\n")
			remainder = lines[len(lines)-1]

			for i := 0; i < len(lines)-1; i++ {
				line := strings.TrimSpace(lines[i])
				if line == "" || !strings.HasPrefix(line, "data: ") {
					continue
				}

				data := strings.TrimPrefix(line, "data: ")
				if data == "[DONE]" {
					return nil
				}

				var streamResp struct {
					Choices []struct {
						Delta struct {
							Content          string `json:"content"`
							ReasoningContent string `json:"reasoning_content"`
						} `json:"delta"`
					} `json:"choices"`
				}

				if unmarshalErr := json.Unmarshal([]byte(data), &streamResp); unmarshalErr == nil {
					if len(streamResp.Choices) > 0 {
						content := streamResp.Choices[0].Delta.Content
						reasoning := streamResp.Choices[0].Delta.ReasoningContent
						if content != "" || reasoning != "" {
							if callbackErr := callback(content, reasoning); callbackErr != nil {
								return callbackErr
							}
						}
					}
				}
			}
		}

		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
	}

	return nil
}

// PerformSearch handles the full search flow: keyword generation and web search
func (s *AIService) PerformSearch(ctx context.Context, messages []models.AIMessage, searchCallback SearchCallback) ([]models.SearchResult, string, error) {
	// 1. Generate search keywords
	query, _, _, err := s.GenerateKeywords(ctx, messages)
	if err != nil {
		log.Printf("[AIService] Keyword generation error: %v", err)
		if len(messages) > 0 {
			query = messages[len(messages)-1].Content
		}
	}

	// 2. Notify searching status
	if searchCallback != nil {
		searchCallback(models.SearchData{
			Query:  query,
			Status: "searching",
		})
	}

	// 3. Perform search
	s.mu.RLock()
	searchService := s.searchService
	s.mu.RUnlock()

	results, err := searchService.Search(ctx, query, 10)
	if err != nil {
		log.Printf("[AIService] Search error: %v", err)
		results = []models.SearchResult{}
	}

	// 4. Notify completion
	if searchCallback != nil {
		searchCallback(models.SearchData{
			Query:   query,
			Status:  "completed",
			Results: results,
		})
	}

	return results, query, nil
}

func (s *AIService) generateSearchStream(ctx context.Context, messages []models.AIMessage, callback func(token string, reasoning string) error, searchCallback SearchCallback) (int, int, error) {
	s.mu.RLock()
	apiKey := s.searchAPIKey
	baseURL := s.searchBaseURL
	model := s.searchModel
	s.mu.RUnlock()

	results, query, err := s.PerformSearch(ctx, messages, searchCallback)
	if err != nil {
		return 0, 0, err
	}

	// 5. Format search results into <search> tag for the stream
	var searchTag strings.Builder
	searchTag.WriteString("\n<search>\n")
	searchData := map[string]any{
		"query":   query,
		"results": results,
	}
	searchJSON, _ := json.Marshal(searchData)
	searchTag.Write(searchJSON)
	searchTag.WriteString("\n</search>\n")

	// Send the search tag to the frontend as a token
	if err := callback(searchTag.String(), ""); err != nil {
		return 0, 0, err
	}

	// 6. Generate final response using search results as context
	var searchContextBuilder strings.Builder
	searchContextBuilder.WriteString("以下是联网搜索到的相关信息：\n")
	if len(results) > 0 {
		for i, r := range results {
			fmt.Fprintf(&searchContextBuilder, "[%d] 标题: %s\n    链接: %s\n    内容: %s\n\n", i+1, r.Title, r.URL, r.Snippet)
		}
	} else {
		searchContextBuilder.WriteString("未找到相关搜索结果。\n")
	}
	searchContext := searchContextBuilder.String()

	augmentedMessages := make([]models.AIMessage, 0, len(messages)+2)
	systemPrompt := "你是一个具备联网搜索能力的助手。请根据提供的搜索结果回答用户的问题。\n\n" +
		"**引用要求**：\n" +
		"1. 当你引用搜索结果中的信息时，必须在对应的语句末尾使用 `ref(n)` 格式进行标注，其中 n 是搜索结果的序号（从 1 开始）。\n" +
		"2. 例如：根据某项研究表明，地球是圆的 ref(1)。\n" +
		"3. 如果一条语句引用了多个来源，请使用多个标注，如：ref(1) ref(2)。\n" +
		"4. 如果搜索结果不相关，请根据你的知识储备回答，并告知用户搜索结果可能不完全匹配。"

	augmentedMessages = append(augmentedMessages, models.AIMessage{
		Role:    "system",
		Content: systemPrompt,
	})
	augmentedMessages = append(augmentedMessages, models.AIMessage{
		Role:    "system",
		Content: searchContext,
	})
	augmentedMessages = append(augmentedMessages, messages...)

	err = s.generateCustomStream(ctx, augmentedMessages, apiKey, baseURL, model, false, callback)
	return 0, 0, err
}

func (s *AIService) generateCustomStream(ctx context.Context, messages []models.AIMessage, apiKey, baseURL, model string, enableThinking bool, callback func(token string, reasoning string) error) error {
	type oaiMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}

	var oaiMessages []oaiMessage
	for _, m := range messages {
		role := "user"
		switch m.Role {
		case "assistant":
			role = "assistant"
		case "system":
			role = "system"
		}

		oaiMessages = append(oaiMessages, oaiMessage{
			Role:    role,
			Content: m.Content,
		})
	}

	requestBodyMap := map[string]any{
		"model":    model,
		"messages": oaiMessages,
		"stream":   true,
	}
	if !enableThinking {
		requestBodyMap["thinking"] = map[string]any{
			"type": "disabled",
		}
	}
	requestBody, err := json.Marshal(requestBodyMap)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/chat/completions", baseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(requestBody)))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("AI API error (status %d): %s", resp.StatusCode, string(body))
	}

	reader := io.Reader(resp.Body)
	buf := make([]byte, 4096)
	var remainder string

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			chunk := remainder + string(buf[:n])
			lines := strings.Split(chunk, "\n")
			remainder = lines[len(lines)-1]

			for i := 0; i < len(lines)-1; i++ {
				line := strings.TrimSpace(lines[i])
				if line == "" || !strings.HasPrefix(line, "data: ") {
					continue
				}

				data := strings.TrimPrefix(line, "data: ")
				if data == "[DONE]" {
					return nil
				}

				var streamResp struct {
					Choices []struct {
						Delta struct {
							Content          string `json:"content"`
							ReasoningContent string `json:"reasoning_content"`
						} `json:"delta"`
					} `json:"choices"`
				}

				if unmarshalErr := json.Unmarshal([]byte(data), &streamResp); unmarshalErr == nil {
					if len(streamResp.Choices) > 0 {
						content := streamResp.Choices[0].Delta.Content
						reasoning := streamResp.Choices[0].Delta.ReasoningContent
						if content != "" || reasoning != "" {
							if callbackErr := callback(content, reasoning); callbackErr != nil {
								return callbackErr
							}
						}
					}
				}
			}
		}

		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
	}

	return nil
}

// GenerateTitle generates a title for the conversation based on messages
func (s *AIService) GenerateTitle(ctx context.Context, messages []models.AIMessage) (string, error) {
	s.mu.RLock()
	apiKey := s.titleAPIKey
	baseURL := s.titleBaseURL
	model := s.titleModel
	s.mu.RUnlock()

	titlePrompt := models.AIMessage{
		Role:    "user",
		Content: "Please generate a short, concise title for this conversation based on the above messages. The title should be in the same language as the conversation and should not exceed 10 words. Only output the title itself, no quotes or extra text.",
	}

	allMessages := append(messages, titlePrompt)

	var title strings.Builder
	err := s.generateCustomStream(ctx, allMessages, apiKey, baseURL, model, false, func(token string, reasoning string) error {
		title.WriteString(token)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("title generation failed: %w", err)
	}

	return strings.TrimSpace(title.String()), nil
}

func (s *AIService) GetAgentConfig() (apiKey, baseURL, model string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.agentAPIKey, s.agentBaseURL, s.agentModel
}

func (s *AIService) GetDailyConfig() (apiKey, baseURL, model string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.apiKey, s.baseURL, s.model
}
