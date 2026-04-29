package handlers

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"context"
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
	streamManager       *services.StreamManager
}

func NewChatHandler(aiService *services.AIService, conversationService *services.ConversationService, db *database.MongoDB, streamManager *services.StreamManager) *ChatHandler {
	return &ChatHandler{
		aiService:           aiService,
		conversationService: conversationService,
		db:                  db,
		streamManager:       streamManager,
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

	// Create a belong to assistant empty message
	assistantMsg, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "assistant", "", userID, userMsg.ID.Hex())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create assistant message placeholder"})
		return
	}

	// Detached context for background processing
	bgCtx := context.WithoutCancel(c.Request.Context())

	// Start background generation
	go func() {
		// Get conversation history (branch)
		messages, err := h.conversationService.GetMessageBranch(bgCtx, req.ConversationID, userMsg.ID.Hex())
		if err != nil {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "error",
				Content: "Failed to fetch conversation history",
			})
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

		// Get user settings for system prompt
		userIDObj, _ := primitive.ObjectIDFromHex(userID)
		var user models.User
		h.db.Users().FindOne(bgCtx, bson.M{"_id": userIDObj}).Decode(&user)

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
			bgCtx,
			services.ConvertToGenkitMessages(genkitMessages),
			req.Mode,
			systemPromptBuilder.String(),
			func(token string, reasoning string) error {
				if reasoning != "" {
					fullReasoning.WriteString(reasoning)
					h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
						Type:    "reasoning",
						Content: reasoning,
					})
				}

				if token != "" {
					fullResponse.WriteString(token)
					h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
						Type:    "token",
						Content: token,
					})
				}

				return nil
			},
			func(searchData models.SearchData) error {
				lastSearchData = &searchData
				h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
					Type: "search",
					Data: searchData,
				})
				return nil
			},
		)

		if err != nil {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "error",
				Content: err.Error(),
			})
			return
		}

		// Update assistant message with final content
		assistantMsg.Content = fullResponse.String()
		assistantMsg.Reasoning = fullReasoning.String()
		assistantMsg.Search = lastSearchData
		err = h.conversationService.UpdateMessage(bgCtx, assistantMsg)
		if err != nil {
			log.Printf("Failed to update assistant message: %v", err)
		}

		// Send done signal
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type: "done",
			Data: gin.H{
				"user_message_id":      userMsg.ID.Hex(),
				"assistant_message_id": assistantMsg.ID.Hex(),
			},
		})

		// Check if title needs auto-generation
		title, err := h.conversationService.AutoGenerateTitle(bgCtx, req.ConversationID, userID, h.aiService)
		if err == nil && title != "" {
			// Notify subscribers about the new title if it was generated
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "title",
				Content: title,
			})
		}

		// Optional: delay cleanup to allow last message to reach subscribers
		time.AfterFunc(10*time.Second, func() {

			h.streamManager.CloseConversation(req.ConversationID)
		})
	}()

	// Respond immediately
	c.JSON(http.StatusOK, gin.H{
		"user_message_id":      userMsg.ID.Hex(),
		"assistant_message_id": assistantMsg.ID.Hex(),
	})
}

func (h *ChatHandler) Stream(c *gin.Context) {
	conversationID := c.Query("conversation_id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	// Set up SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	// Subscribe to the stream
	ch := h.streamManager.Subscribe(conversationID)
	defer h.streamManager.Unsubscribe(conversationID, ch)

	// Stream events
	c.Stream(func(w io.Writer) bool {
		select {
		case <-c.Request.Context().Done():
			return false
		case resp, ok := <-ch:
			if !ok {
				return false
			}
			data, _ := json.Marshal(resp)
			fmt.Fprintf(w, "data: %s\n\n", data)
			return true
		}
	})
}
