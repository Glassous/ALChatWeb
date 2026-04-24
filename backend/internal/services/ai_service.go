package services

import (
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
}

func NewAIService(apiKey, baseURL, model, expertAPIKey, expertBaseURL, expertModel, titleAPIKey, titleBaseURL, titleModel string) (*AIService, error) {
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
	}, nil
}

// GenerateStream generates AI response with streaming
func (s *AIService) GenerateStream(ctx context.Context, messages []*ai.Message, mode string, callback func(token string, reasoning string) error) error {
	if mode == "expert" {
		return s.generateExpertStream(ctx, messages, callback)
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
	// For expert mode, we use a direct HTTP request to handle reasoning_content
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
		"model":    s.expertModel,
		"messages": oaiMessages,
		"stream":   true,
	})
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/chat/completions", s.expertBaseURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(requestBody)))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.expertAPIKey))

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
