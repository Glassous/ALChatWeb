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
	ossService          *services.OSSService
}

func NewImageHandler(imageService *services.ImageService, conversationService *services.ConversationService, ossService *services.OSSService) *ImageHandler {
	return &ImageHandler{
		imageService:        imageService,
		conversationService: conversationService,
		ossService:          ossService,
	}
}

type GenerateImageRequest struct {
	ConversationID string `json:"conversation_id" binding:"required"`
	Prompt         string `json:"prompt" binding:"required"`
	Resolution     string `json:"resolution"`
	RefImageURL    string `json:"ref_image_url"`
}

func (h *ImageHandler) GenerateImage(c *gin.Context) {
	userID := c.GetString("user_id")
	var req GenerateImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine refImageURL
	refImageURL := req.RefImageURL
	if refImageURL == "" {
		// Fallback to multi-round dialogue logic if no user-uploaded ref image
		messages, err := h.conversationService.GetMessages(c.Request.Context(), req.ConversationID)
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
	}

	// Save user prompt message
	userMsgContent := req.Prompt
	if req.RefImageURL != "" {
		userMsgContent = fmt.Sprintf(`<image src="%s">
%s`, req.RefImageURL, req.Prompt)
	}
	_, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "user", userMsgContent, userID)
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

func (h *ImageHandler) DeleteReferenceImage(c *gin.Context) {
	var req struct {
		URL string `json:"url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Extract object key from URL
	// URL format: https://bucket.endpoint/objectKey
	re := regexp.MustCompile(`https://[^/]+/(.+)`)
	matches := re.FindStringSubmatch(req.URL)
	if len(matches) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid image URL"})
		return
	}
	objectKey := matches[1]

	err := h.ossService.DeleteFile(objectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to delete image from OSS: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Image deleted successfully"})
}

func (h *ImageHandler) UploadReferenceImage(c *gin.Context) {
	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No image file provided"})
		return
	}

	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open image file"})
		return
	}
	defer f.Close()

	url, err := h.ossService.UploadFile(f, file.Filename, "reference_images")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to upload image to OSS: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": url,
	})
}
