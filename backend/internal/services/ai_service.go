package services

import (
	"alchat-backend/internal/models"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"github.com/firebase/genkit/go/plugins/compat_oai"
	"github.com/openai/openai-go/option"
)

type AIService struct {
	mu                sync.RWMutex
	g                 *genkit.Genkit
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
}

func NewAIService(apiKey, baseURL, model, expertAPIKey, expertBaseURL, expertModel, titleAPIKey, titleBaseURL, titleModel, searchAPIKey, searchBaseURL, searchModel, bochaAPIKey, multimodalAPIKey, multimodalBaseURL, multimodalModel string) (*AIService, error) {
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
	}
	s.reinitGenkit()
	return s, nil
}

func (s *AIService) reinitGenkit() {
	s.mu.Lock()
	defer s.mu.Unlock()

	ctx := context.Background()
	s.g = genkit.Init(ctx,
		genkit.WithPlugins(
			&compat_oai.OpenAICompatible{
				Provider: "openai",
				APIKey:   s.apiKey,
				BaseURL:  s.baseURL,
				Opts: []option.RequestOption{
					option.WithHeader("Content-Type", "application/json"),
				},
			},
			&compat_oai.OpenAICompatible{
				Provider: "openai-title",
				APIKey:   s.titleAPIKey,
				BaseURL:  s.titleBaseURL,
				Opts: []option.RequestOption{
					option.WithHeader("Content-Type", "application/json"),
				},
			},
			&compat_oai.OpenAICompatible{
				Provider: "openai-multimodal",
				APIKey:   s.multimodalAPIKey,
				BaseURL:  s.multimodalBaseURL,
				Opts: []option.RequestOption{
					option.WithHeader("Content-Type", "application/json"),
				},
			},
		),
	)
}

func (s *AIService) UpdateConfig(mode, apiKey, baseURL, model string) error {
	s.mu.Lock()
	needReinit := false
	log.Printf("[AIService] Updating config for mode: %s, model: %s, baseURL: %s, key length: %d", mode, model, baseURL, len(apiKey))
	switch mode {
	case "daily":
		s.baseURL = baseURL
		s.apiKey = apiKey
		s.model = model
		needReinit = true
	case "expert":
		s.expertBaseURL = baseURL
		s.expertAPIKey = apiKey
		s.expertModel = model
	case "title":
		s.titleBaseURL = baseURL
		s.titleAPIKey = apiKey
		s.titleModel = model
		needReinit = true
	case "search":
		s.searchBaseURL = baseURL
		s.searchAPIKey = apiKey
		s.searchModel = model
	case "multimodal":
		s.multimodalBaseURL = baseURL
		s.multimodalAPIKey = apiKey
		s.multimodalModel = model
		needReinit = true
	}
	s.mu.Unlock()

	if needReinit {
		s.reinitGenkit()
	}
	return nil
}

type SearchCallback func(data models.SearchData) error

// GenerateStream generates AI response with streaming
func (s *AIService) GenerateStream(ctx context.Context, messages []*ai.Message, mode string, userSystemPrompt string, callback func(token string, reasoning string) error, searchCallback SearchCallback) error {
	s.mu.RLock()
	multimodalAPIKey := s.multimodalAPIKey
	model := s.model
	genkitInstance := s.g
	s.mu.RUnlock()

	// Prepend user system prompt if provided
	if userSystemPrompt != "" {
		messages = append([]*ai.Message{
			{
				Role:    ai.RoleSystem,
				Content: []*ai.Part{ai.NewTextPart(userSystemPrompt)},
			},
		}, messages...)
	}

	// Check if any message contains multimodal content (<file> or <image> tags)
	hasMultimodal := false
	for _, m := range messages {
		for _, p := range m.Content {
			if p.IsText() {
				if strings.Contains(p.Text, "<file") || strings.Contains(p.Text, "<image") {
					hasMultimodal = true
					break
				}
			}
		}
		if hasMultimodal {
			break
		}
	}

	if hasMultimodal && multimodalAPIKey != "" {
		return s.generateMultimodalStream(ctx, messages, callback)
	}

	if mode == "expert" {
		return s.generateExpertStream(ctx, messages, callback)
	}

	if mode == "search" {
		return s.generateSearchStream(ctx, messages, callback, searchCallback)
	}

	// Use GenerateStream from genkit for daily mode
	modelName := fmt.Sprintf("openai/%s", model)
	stream := genkit.GenerateStream(ctx, genkitInstance,
		ai.WithModelName(modelName),
		ai.WithMessages(messages...),
	)

	for result, err := range stream {
		if err != nil {
			return fmt.Errorf("generation failed: %w", err)
		}

		if result.Done {
			break
		}

		// Get text from chunk
		text := result.Chunk.Text()

		if text != "" {
			if err := callback(text, ""); err != nil {
				return err
			}
		}
	}

	return nil
}

func (s *AIService) generateExpertStream(ctx context.Context, messages []*ai.Message, callback func(token string, reasoning string) error) error {
	s.mu.RLock()
	apiKey := s.expertAPIKey
	baseURL := s.expertBaseURL
	model := s.expertModel
	s.mu.RUnlock()
	return s.generateCustomStream(ctx, messages, apiKey, baseURL, model, callback)
}

func (s *AIService) generateMultimodalStream(ctx context.Context, messages []*ai.Message, callback func(token string, reasoning string) error) error {
	s.mu.RLock()
	apiKey := s.multimodalAPIKey
	baseURL := s.multimodalBaseURL
	model := s.multimodalModel
	s.mu.RUnlock()
	// For multimodal models, we need to parse <file> and <image> tags
	// and convert them to the format the API expects (image_url or file_url).

	type oaiContent struct {
		Type     string         `json:"type"`
		Text     string         `json:"text,omitempty"`
		ImageURL map[string]any `json:"image_url,omitempty"`
		// Some providers might support video/file differently, but many use the same structure
		// For now, let's treat both image and file as image_url as most vision models expect that.
	}

	type oaiMessage struct {
		Role    string       `json:"role"`
		Content []oaiContent `json:"content"`
	}

	var oaiMessages []oaiMessage
	for _, m := range messages {
		role := "user"
		switch m.Role {
		case ai.RoleModel:
			role = "assistant"
		case ai.RoleSystem:
			role = "system"
		}

		var contents []oaiContent
		for _, p := range m.Content {
			if p.IsText() {
				text := p.Text
				// Find all <image src="..."> and <file src="..."> tags
				imageRe := regexp.MustCompile(`<(image|file) src="([^"]+)">`)
				matches := imageRe.FindAllStringSubmatch(text, -1)

				// Split text by tags and add parts
				lastIdx := 0
				for _, match := range matches {
					fullMatch := match[0]
					url := match[2]
					idx := strings.Index(text[lastIdx:], fullMatch)

					// Add text before the tag
					if idx > 0 {
						contents = append(contents, oaiContent{
							Type: "text",
							Text: text[lastIdx : lastIdx+idx],
						})
					}

					// Add image/file URL
					contents = append(contents, oaiContent{
						Type: "image_url",
						ImageURL: map[string]any{
							"url": url,
						},
					})

					lastIdx += idx + len(fullMatch)
				}

				// Add remaining text
				if lastIdx < len(text) {
					remaining := text[lastIdx:]
					if remaining != "" {
						contents = append(contents, oaiContent{
							Type: "text",
							Text: remaining,
						})
					}
				}
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

func (s *AIService) generateSearchStream(ctx context.Context, messages []*ai.Message, callback func(token string, reasoning string) error, searchCallback SearchCallback) error {
	s.mu.RLock()
	apiKey := s.searchAPIKey
	baseURL := s.searchBaseURL
	model := s.searchModel
	s.mu.RUnlock()

	// 1. Get search query from the last user message
	lastMsg := messages[len(messages)-1]
	var queryBuilder strings.Builder
	for _, p := range lastMsg.Content {
		if p.IsText() {
			queryBuilder.WriteString(p.Text)
		}
	}
	query := queryBuilder.String()

	// 2. Notify frontend that we are searching
	if searchCallback != nil {
		searchCallback(models.SearchData{
			Query:  query,
			Status: "searching",
		})
	}

	// 3. Perform search
	results, err := s.searchService.Search(ctx, query, 10)
	if err != nil {
		// Log error but continue with empty results
		fmt.Printf("Search error: %v\n", err)
		results = []models.SearchResult{}
	}

	// 4. Notify frontend that search is completed
	if searchCallback != nil {
		searchCallback(models.SearchData{
			Query:   query,
			Status:  "completed",
			Results: results,
		})
	}

	// 5. Format search results into <search> tag
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
		return err
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

	augmentedMessages := make([]*ai.Message, 0, len(messages)+2)
	// Add system prompt for search
	systemPrompt := "你是一个具备联网搜索能力的助手。请根据提供的搜索结果回答用户的问题。\n\n" +
		"**引用要求**：\n" +
		"1. 当你引用搜索结果中的信息时，必须在对应的语句末尾使用 `ref(n)` 格式进行标注，其中 n 是搜索结果的序号（从 1 开始）。\n" +
		"2. 例如：根据某项研究表明，地球是圆的 ref(1)。\n" +
		"3. 如果一条语句引用了多个来源，请使用多个标注，如：ref(1) ref(2)。\n" +
		"4. 如果搜索结果不相关，请根据你的知识储备回答，并告知用户搜索结果可能不完全匹配。"

	augmentedMessages = append(augmentedMessages, &ai.Message{
		Role:    ai.RoleSystem,
		Content: []*ai.Part{ai.NewTextPart(systemPrompt)},
	})
	// Add search context
	augmentedMessages = append(augmentedMessages, &ai.Message{
		Role:    ai.RoleSystem,
		Content: []*ai.Part{ai.NewTextPart(searchContext)},
	})
	// Add original messages
	augmentedMessages = append(augmentedMessages, messages...)

	// Use search model for final response
	return s.generateCustomStream(ctx, augmentedMessages, apiKey, baseURL, model, callback)
}

func (s *AIService) generateCustomStream(ctx context.Context, messages []*ai.Message, apiKey, baseURL, model string, callback func(token string, reasoning string) error) error {
	// For custom modes, we use a direct HTTP request to handle reasoning_content
	// since Genkit and some Go SDKs might not support it yet.

	type oaiMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}

	var oaiMessages []oaiMessage
	for _, m := range messages {
		var contentBuilder strings.Builder
		for _, p := range m.Content {
			if p.IsText() {
				contentBuilder.WriteString(p.Text)
			}
		}
		content := contentBuilder.String()

		role := "user"
		switch m.Role {
		case ai.RoleModel:
			role = "assistant"
		case ai.RoleSystem:
			role = "system"
		}

		oaiMessages = append(oaiMessages, oaiMessage{
			Role:    role,
			Content: content,
		})
	}

	requestBody, err := json.Marshal(map[string]any{
		"model":    model,
		"messages": oaiMessages,
		"stream":   true,
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
		return fmt.Errorf("AI API error (status %d): %s", resp.StatusCode, string(body))
	}

	reader := io.Reader(resp.Body)
	// Simple SSE parser
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
func (s *AIService) GenerateTitle(ctx context.Context, messages []*ai.Message) (string, error) {
	s.mu.RLock()
	titleModel := s.titleModel
	genkitInstance := s.g
	s.mu.RUnlock()

	// Add a system message to instruct the AI to generate a title
	titlePrompt := &ai.Message{
		Role:    ai.RoleUser,
		Content: []*ai.Part{ai.NewTextPart("Please generate a short, concise title for this conversation based on the above messages. The title should be in the same language as the conversation and should not exceed 10 words. Only output the title itself, no quotes or extra text.")},
	}

	allMessages := append(messages, titlePrompt)

	resp, err := genkit.Generate(ctx, genkitInstance,
		ai.WithModelName(fmt.Sprintf("openai-title/%s", titleModel)),
		ai.WithMessages(allMessages...),
	)
	if err != nil {
		return "", fmt.Errorf("title generation failed: %w", err)
	}

	return resp.Text(), nil
}

// ConvertToGenkitMessages converts our message format to Genkit format
func ConvertToGenkitMessages(messages []struct {
	Role    string
	Content string
}) []*ai.Message {
	genkitMessages := make([]*ai.Message, len(messages))
	for i, msg := range messages {
		role := ai.RoleUser
		if msg.Role == "assistant" {
			role = ai.RoleModel
		}
		genkitMessages[i] = &ai.Message{
			Role:    role,
			Content: []*ai.Part{ai.NewTextPart(msg.Content)},
		}
	}
	return genkitMessages
}
