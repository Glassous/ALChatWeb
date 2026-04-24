package handlers

import (
	"alchat-backend/internal/services"
	"net/http"

	"github.com/gin-gonic/gin"
)

type ConversationHandler struct {
	service *services.ConversationService
}

func NewConversationHandler(service *services.ConversationService) *ConversationHandler {
	return &ConversationHandler{service: service}
}

func (h *ConversationHandler) CreateConversation(c *gin.Context) {
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

	conversation, err := h.service.CreateConversation(c.Request.Context(), req.Title)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, conversation)
}

func (h *ConversationHandler) GetAllConversations(c *gin.Context) {
	conversations, err := h.service.GetAllConversations(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conversations)
}

func (h *ConversationHandler) GetConversation(c *gin.Context) {
	conversationID := c.Param("id")

	conversation, err := h.service.GetConversationWithMessages(c.Request.Context(), conversationID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conversation)
}

func (h *ConversationHandler) DeleteConversation(c *gin.Context) {
	conversationID := c.Param("id")

	err := h.service.DeleteConversation(c.Request.Context(), conversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Conversation deleted successfully"})
}

func (h *ConversationHandler) UpdateConversationTitle(c *gin.Context) {
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

	err := h.service.UpdateConversationTitle(c.Request.Context(), conversationID, req.Title)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Title updated successfully"})
}
