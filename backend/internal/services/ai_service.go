package services

import (
	"context"
	"fmt"

	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"github.com/firebase/genkit/go/plugins/compat_oai"
	"github.com/openai/openai-go/option"
)

type AIService struct {
	g     *genkit.Genkit
	model string
}

func NewAIService(apiKey, baseURL, model string) (*AIService, error) {
	ctx := context.Background()

	// Initialize Genkit with OpenAI-compatible plugin
	g := genkit.Init(ctx,
		genkit.WithPlugins(&compat_oai.OpenAICompatible{
			Provider: "openai",
			APIKey:   apiKey,
			BaseURL:  baseURL,
			Opts: []option.RequestOption{
				option.WithHeader("Content-Type", "application/json"),
			},
		}),
	)

	return &AIService{
		g:     g,
		model: model,
	}, nil
}

// GenerateStream generates AI response with streaming
func (s *AIService) GenerateStream(ctx context.Context, messages []*ai.Message, callback func(string) error) error {
	// Use GenerateStream from genkit
	stream := genkit.GenerateStream(ctx, s.g,
		ai.WithModelName(fmt.Sprintf("openai/%s", s.model)),
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
			if err := callback(text); err != nil {
				return err
			}
		}
	}

	return nil
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
