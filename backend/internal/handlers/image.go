package handlers

import (
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"context"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
)

type ImageHandler struct {
	imageService        *services.ImageService
	conversationService *services.ConversationService
	ossService          *services.OSSService
	aiService           *services.AIService
	streamManager       *services.StreamManager
}

func NewImageHandler(imageService *services.ImageService, conversationService *services.ConversationService, ossService *services.OSSService, aiService *services.AIService, streamManager *services.StreamManager) *ImageHandler {
	return &ImageHandler{
		imageService:        imageService,
		conversationService: conversationService,
		ossService:          ossService,
		aiService:           aiService,
		streamManager:       streamManager,
	}
}

type GenerateImageRequest struct {
	ConversationID  string `json:"conversation_id" binding:"required"`
	ParentMessageID string `json:"parent_message_id"`
	Prompt          string `json:"prompt" binding:"required"`
	Resolution      string `json:"resolution"`
	RefImageURL     string `json:"ref_image_url"`
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
		var messages []models.Message
		var err error
		if req.ParentMessageID != "" {
			messages, err = h.conversationService.GetMessageBranch(c.Request.Context(), req.ConversationID, req.ParentMessageID)
		} else {
			messages, err = h.conversationService.GetMessages(c.Request.Context(), req.ConversationID)
		}

		if err == nil && len(messages) > 0 {
			lastMsg := messages[len(messages)-1]
			if lastMsg.Role == "assistant" {
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
	userMsg, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "user", userMsgContent, userID, req.ParentMessageID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save user message"})
		return
	}

	// Create assistant placeholder message
	assistantMsg, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "assistant", "", userID, userMsg.ID.Hex())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create assistant message placeholder"})
		return
	}

	// Detached context for background processing
	bgCtx := context.WithoutCancel(c.Request.Context())

	// Start background generation
	go func() {
		url, err := h.imageService.GenerateAndUploadImage(bgCtx, req.Prompt, req.Resolution, refImageURL)
		if err != nil {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "error",
				Content: err.Error(),
			})
			return
		}

		// Save assistant message with image tag
		imageTag := fmt.Sprintf(`<image src="%s">`, url)
		assistantMsg.Content = imageTag
		err = h.conversationService.UpdateMessage(bgCtx, assistantMsg)
		if err != nil {
			log.Printf("Failed to update assistant message: %v", err)
		}

		// Publish result to stream
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type:    "token",
			Content: imageTag,
		})

		// Check if title needs auto-generation
		title, err := h.conversationService.AutoGenerateTitle(bgCtx, req.ConversationID, userID, h.aiService)
		if err == nil && title != "" {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "title",
				Content: title,
			})
		}

		// Send done signal
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type: "done",
			Data: gin.H{
				"user_message_id":      userMsg.ID.Hex(),
				"assistant_message_id": assistantMsg.ID.Hex(),
			},
		})

		// Optional: delay cleanup
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

func (h *ImageHandler) DeleteReferenceImage(c *gin.Context) {
	var req struct {
		URL string `json:"url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Extract object key from URL
	// URL format: http(s)://bucket.endpoint/objectKey
	re := regexp.MustCompile(`https?://[^/]+/(.+)`)
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
	file, err := c.FormFile("file")
	if err != nil {
		// Fallback to "image" for backward compatibility
		file, err = c.FormFile("image")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided"})
			return
		}
	}

	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer f.Close()

	url, err := h.ossService.UploadFile(f, file.Filename, "reference_files")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to upload file to OSS: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": url,
	})
}
