package handlers

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ChatHandler struct {
	aiService           *services.AIService
	conversationService *services.ConversationService
	db                  *database.MongoDB
}

func NewChatHandler(aiService *services.AIService, conversationService *services.ConversationService, db *database.MongoDB) *ChatHandler {
	return &ChatHandler{
		aiService:           aiService,
		conversationService: conversationService,
		db:                  db,
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
	userMsg, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "user", req.Message, userID, req.ParentMessageID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save user message"})
		return
	}

	// Get conversation history (branch)
	messages, err := h.conversationService.GetMessageBranch(c.Request.Context(), req.ConversationID, userMsg.ID.Hex())
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

	// Get user settings for system prompt
	userIDObj, _ := primitive.ObjectIDFromHex(userID)
	var user models.User
	h.db.Users().FindOne(c.Request.Context(), bson.M{"_id": userIDObj}).Decode(&user)

	// Construct system prompt
	var systemPromptBuilder strings.Builder
	if user.SystemPrompt != "" {
		systemPromptBuilder.WriteString(user.SystemPrompt)
	}

	if user.IncludeDateTime {
		currentTime := time.Now().Format("2006-01-02 15:04:05")
		if systemPromptBuilder.Len() > 0 {
			systemPromptBuilder.WriteString("\n\n")
		}
		fmt.Fprintf(&systemPromptBuilder, "当前时间: %s", currentTime)
	}

	if user.IncludeLocation && req.Location != "" {
		if systemPromptBuilder.Len() > 0 {
			systemPromptBuilder.WriteString("\n\n")
		}
		fmt.Fprintf(&systemPromptBuilder, "当前位置: %s", req.Location)
	}

	// Stream AI response
	var fullResponse strings.Builder
	var fullReasoning strings.Builder
	var lastSearchData *models.SearchData

	err = h.aiService.GenerateStream(
		c.Request.Context(),
		services.ConvertToGenkitMessages(genkitMessages),
		req.Mode,
		systemPromptBuilder.String(),
		func(token string, reasoning string) error {
			if reasoning != "" {
				fullReasoning.WriteString(reasoning)
				// Send reasoning token as SSE
				response := models.ChatStreamResponse{
					Type:    "reasoning",
					Content: reasoning,
				}
				data, _ := json.Marshal(response)
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				c.Writer.Flush()
			}

			if token != "" {
				fullResponse.WriteString(token)
				// Send token as SSE
				response := models.ChatStreamResponse{
					Type:    "token",
					Content: token,
				}
				data, _ := json.Marshal(response)
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				c.Writer.Flush()
			}

			return nil
		},
		func(searchData models.SearchData) error {
			lastSearchData = &searchData
			// Send search progress as SSE
			response := models.ChatStreamResponse{
				Type: "search",
				Data: searchData,
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
	assistantMsg, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "assistant", fullResponse.String(), userID, userMsg.ID.Hex())
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

	// Update assistant message with reasoning and search if present
	if fullReasoning.Len() > 0 || lastSearchData != nil {
		if fullReasoning.Len() > 0 {
			assistantMsg.Reasoning = fullReasoning.String()
		}
		if lastSearchData != nil {
			assistantMsg.Search = lastSearchData
		}
		err = h.conversationService.UpdateMessage(c.Request.Context(), assistantMsg)
		if err != nil {
			log.Printf("Failed to update message with extra fields: %v", err)
		}
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
