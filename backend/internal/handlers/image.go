package handlers

import (
	"alchat-backend/internal/services"
	"fmt"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
)

type ImageHandler struct {
	imageService        *services.ImageService
	conversationService *services.ConversationService
}

func NewImageHandler(imageService *services.ImageService, conversationService *services.ConversationService) *ImageHandler {
	return &ImageHandler{
		imageService:        imageService,
		conversationService: conversationService,
	}
}

type GenerateImageRequest struct {
	ConversationID string `json:"conversation_id" binding:"required"`
	Prompt         string `json:"prompt" binding:"required"`
	Resolution     string `json:"resolution"`
}

func (h *ImageHandler) GenerateImage(c *gin.Context) {
	userID := c.GetString("user_id")
	var req GenerateImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get conversation history to check for previous image
	messages, err := h.conversationService.GetMessages(c.Request.Context(), req.ConversationID)
	var refImageURL string
	if err == nil && len(messages) > 0 {
		lastMsg := messages[len(messages)-1]
		if lastMsg.Role == "assistant" {
			// Extract image URL from <image src="..."> tag
			re := regexp.MustCompile(`<image src="([^"]+)">`)
			matches := re.FindStringSubmatch(lastMsg.Content)
			if len(matches) > 1 {
				refImageURL = matches[1]
			}
		}
	}

	// Save user prompt message
	_, err = h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "user", req.Prompt, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save user message"})
		return
	}

	url, err := h.imageService.GenerateAndUploadImage(c.Request.Context(), req.Prompt, req.Resolution, refImageURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Save assistant message with image tag
	imageTag := fmt.Sprintf(`<image src="%s">`, url)
	_, err = h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "assistant", imageTag, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save assistant message"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": url,
	})
}
