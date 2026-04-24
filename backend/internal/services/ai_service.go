package services

import (
	"alchat-backend/internal/models"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"github.com/firebase/genkit/go/plugins/compat_oai"
	"github.com/openai/openai-go/option"
)

type AIService struct {
	g             *genkit.Genkit
	model         string
	expertAPIKey  string
	expertBaseURL string
	expertModel   string
	titleModel    string
	searchAPIKey  string
	searchBaseURL string
	searchModel   string
	bochaAPIKey   string
	searchService *SearchService
}

func NewAIService(apiKey, baseURL, model, expertAPIKey, expertBaseURL, expertModel, titleAPIKey, titleBaseURL, titleModel, searchAPIKey, searchBaseURL, searchModel, bochaAPIKey string) (*AIService, error) {
	ctx := context.Background()

	// Initialize Genkit with multiple OpenAI-compatible plugins
	g := genkit.Init(ctx,
		genkit.WithPlugins(
			&compat_oai.OpenAICompatible{
				Provider: "openai",
				APIKey:   apiKey,
				BaseURL:  baseURL,
				Opts: []option.RequestOption{
					option.WithHeader("Content-Type", "application/json"),
				},
			},
			&compat_oai.OpenAICompatible{
				Provider: "openai-title",
				APIKey:   titleAPIKey,
				BaseURL:  titleBaseURL,
				Opts: []option.RequestOption{
					option.WithHeader("Content-Type", "application/json"),
				},
			},
		),
	)

	return &AIService{
		g:             g,
		model:         model,
		expertAPIKey:  expertAPIKey,
		expertBaseURL: expertBaseURL,
		expertModel:   expertModel,
		titleModel:    titleModel,
		searchAPIKey:  searchAPIKey,
		searchBaseURL: searchBaseURL,
		searchModel:   searchModel,
		bochaAPIKey:   bochaAPIKey,
		searchService: NewSearchService(bochaAPIKey),
	}, nil
}

type SearchCallback func(data models.SearchData) error

// GenerateStream generates AI response with streaming
func (s *AIService) GenerateStream(ctx context.Context, messages []*ai.Message, mode string, callback func(token string, reasoning string) error, searchCallback SearchCallback) error {
	if mode == "expert" {
		return s.generateExpertStream(ctx, messages, callback)
	}

	if mode == "search" {
		return s.generateSearchStream(ctx, messages, callback, searchCallback)
	}

	// Use GenerateStream from genkit for daily mode
	modelName := fmt.Sprintf("openai/%s", s.model)
	stream := genkit.GenerateStream(ctx, s.g,
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
	return s.generateCustomStream(ctx, messages, s.expertAPIKey, s.expertBaseURL, s.expertModel, callback)
}

func (s *AIService) generateSearchStream(ctx context.Context, messages []*ai.Message, callback func(token string, reasoning string) error, searchCallback SearchCallback) error {
	// 1. Get search query from the last user message
	lastMsg := messages[len(messages)-1]
	query := ""
	for _, p := range lastMsg.Content {
		if p.IsText() {
			query += p.Text
		}
	}

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
	searchData := map[string]interface{}{
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
	searchContext := "以下是联网搜索到的相关信息：\n"
	if len(results) > 0 {
		for i, r := range results {
			searchContext += fmt.Sprintf("[%d] 标题: %s\n    链接: %s\n    内容: %s\n\n", i+1, r.Title, r.URL, r.Snippet)
		}
	} else {
		searchContext += "未找到相关搜索结果。\n"
	}

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
	return s.generateCustomStream(ctx, augmentedMessages, s.searchAPIKey, s.searchBaseURL, s.searchModel, callback)
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
		content := ""
		for _, p := range m.Content {
			if p.IsText() {
				content += p.Text
			}
		}

		role := "user"
		if m.Role == ai.RoleModel {
			role = "assistant"
		} else if m.Role == ai.RoleSystem {
			role = "system"
		}

		oaiMessages = append(oaiMessages, oaiMessage{
			Role:    role,
			Content: content,
		})
	}

	requestBody, err := json.Marshal(map[string]interface{}{
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

				if err := json.Unmarshal([]byte(data), &streamResp); err == nil {
					if len(streamResp.Choices) > 0 {
						content := streamResp.Choices[0].Delta.Content
						reasoning := streamResp.Choices[0].Delta.ReasoningContent
						if content != "" || reasoning != "" {
							if err := callback(content, reasoning); err != nil {
								return err
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
	// Add a system message to instruct the AI to generate a title
	titlePrompt := &ai.Message{
		Role:    ai.RoleUser,
		Content: []*ai.Part{ai.NewTextPart("Please generate a short, concise title for this conversation based on the above messages. The title should be in the same language as the conversation and should not exceed 10 words. Only output the title itself, no quotes or extra text.")},
	}

	allMessages := append(messages, titlePrompt)

	resp, err := genkit.Generate(ctx, s.g,
		ai.WithModelName(fmt.Sprintf("openai-title/%s", s.titleModel)),
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
