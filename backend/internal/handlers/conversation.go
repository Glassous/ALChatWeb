package handlers

import (
	"alchat-backend/internal/services"
	"net/http"

	"github.com/gin-gonic/gin"
)

type ConversationHandler struct {
	service   *services.ConversationService
	aiService *services.AIService
}

func NewConversationHandler(service *services.ConversationService, aiService *services.AIService) *ConversationHandler {
	return &ConversationHandler{
		service:   service,
		aiService: aiService,
	}
}

func (h *ConversationHandler) GenerateTitle(c *gin.Context) {
	userID := c.GetString("user_id")
	conversationID := c.Param("id")

	// Get conversation history
	messages, err := h.service.GetMessages(c.Request.Context(), conversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch messages"})
		return
	}

	if len(messages) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No messages in conversation"})
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

	// Generate title
	title, err := h.aiService.GenerateTitle(c.Request.Context(), services.ConvertToGenkitMessages(genkitMessages))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate title: " + err.Error()})
		return
	}

	// Update conversation title
	err = h.service.UpdateConversationTitle(c.Request.Context(), conversationID, title, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update title: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"title": title})
}

func (h *ConversationHandler) CreateConversation(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		Title string `json:"title"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if req.Title == "" {
		req.Title = "New Conversation"
	}

	conversation, err := h.service.CreateConversation(c.Request.Context(), req.Title, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, conversation)
}

func (h *ConversationHandler) GetAllConversations(c *gin.Context) {
	userID := c.GetString("user_id")
	conversations, err := h.service.GetAllConversations(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conversations)
}

func (h *ConversationHandler) GetConversation(c *gin.Context) {
	userID := c.GetString("user_id")
	conversationID := c.Param("id")

	conversation, err := h.service.GetConversationWithMessages(c.Request.Context(), conversationID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conversation)
}

func (h *ConversationHandler) DeleteConversation(c *gin.Context) {
	userID := c.GetString("user_id")
	conversationID := c.Param("id")

	err := h.service.DeleteConversation(c.Request.Context(), conversationID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Conversation deleted successfully"})
}

func (h *ConversationHandler) UpdateConversationTitle(c *gin.Context) {
	userID := c.GetString("user_id")
	conversationID := c.Param("id")

	var req struct {
		Title string `json:"title"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if req.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
		return
	}

	err := h.service.UpdateConversationTitle(c.Request.Context(), conversationID, req.Title, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Title updated successfully"})
}
