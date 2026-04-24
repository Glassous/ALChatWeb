package handlers

import (
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type ChatHandler struct {
	aiService           *services.AIService
	conversationService *services.ConversationService
}

func NewChatHandler(aiService *services.AIService, conversationService *services.ConversationService) *ChatHandler {
	return &ChatHandler{
		aiService:           aiService,
		conversationService: conversationService,
	}
}

func (h *ChatHandler) Chat(c *gin.Context) {
	userID := c.GetString("user_id")
	var req models.ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if req.ConversationID == "" || req.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id and message are required"})
		return
	}

	// Save user message
	_, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "user", req.Message, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save user message"})
		return
	}

	// Get conversation history
	// Note: We've already verified ownership in SaveMessage
	messages, err := h.conversationService.GetMessages(c.Request.Context(), req.ConversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch conversation history"})
		return
	}

	// Convert to Genkit format
	genkitMessages := make([]struct {
		Role    string
		Content string
	}, len(messages))
	for i, msg := range messages {
		genkitMessages[i] = struct {
			Role    string
			Content string
		}{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	// Set up SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	// Flush headers
	c.Writer.Flush()

	// Stream AI response
	var fullResponse strings.Builder
	err = h.aiService.GenerateStream(
		c.Request.Context(),
		services.ConvertToGenkitMessages(genkitMessages),
		func(token string) error {
			fullResponse.WriteString(token)

			// Send token as SSE
			response := models.ChatStreamResponse{
				Type:    "token",
				Content: token,
			}
			data, _ := json.Marshal(response)
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()

			return nil
		},
	)

	if err != nil {
		errorResponse := models.ChatStreamResponse{
			Type:    "error",
			Content: err.Error(),
		}
		data, _ := json.Marshal(errorResponse)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		c.Writer.Flush()
		return
	}

	// Save assistant message
	_, err = h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "assistant", fullResponse.String(), userID)
	if err != nil {
		errorResponse := models.ChatStreamResponse{
			Type:    "error",
			Content: "Failed to save assistant message",
		}
		data, _ := json.Marshal(errorResponse)
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		c.Writer.Flush()
		return
	}

	// Send done signal
	doneResponse := models.ChatStreamResponse{
		Type: "done",
	}
	data, _ := json.Marshal(doneResponse)
	fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	c.Writer.Flush()
}

// Helper to check if client disconnected
func clientGone(w http.ResponseWriter) bool {
	if _, err := w.Write([]byte{}); err != nil {
		return err == io.ErrClosedPipe
	}
	return false
}
