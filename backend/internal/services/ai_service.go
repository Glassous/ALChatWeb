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
	g          *genkit.Genkit
	model      string
	titleG     *genkit.Genkit
	titleModel string
}

func NewAIService(apiKey, baseURL, model, titleAPIKey, titleBaseURL, titleModel string) (*AIService, error) {
	ctx := context.Background()

	// Initialize Genkit with OpenAI-compatible plugin for main chat
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

	// Initialize Genkit for title generation
	titleG := genkit.Init(ctx,
		genkit.WithPlugins(&compat_oai.OpenAICompatible{
			Provider: "openai-title",
			APIKey:   titleAPIKey,
			BaseURL:  titleBaseURL,
			Opts: []option.RequestOption{
				option.WithHeader("Content-Type", "application/json"),
			},
		}),
	)

	return &AIService{
		g:          g,
		model:      model,
		titleG:     titleG,
		titleModel: titleModel,
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

// GenerateTitle generates a title for the conversation based on messages
func (s *AIService) GenerateTitle(ctx context.Context, messages []*ai.Message) (string, error) {
	// Add a system message to instruct the AI to generate a title
	titlePrompt := &ai.Message{
		Role:    ai.RoleUser,
		Content: []*ai.Part{ai.NewTextPart("Please generate a short, concise title for this conversation based on the above messages. The title should be in the same language as the conversation and should not exceed 10 words. Only output the title itself, no quotes or extra text.")},
	}

	allMessages := append(messages, titlePrompt)

	resp, err := genkit.Generate(ctx, s.titleG,
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
