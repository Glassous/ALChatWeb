package handlers

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"context"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ImageHandler struct {
	imageService        *services.ImageService
	conversationService *services.ConversationService
	ossService          *services.COSService
	aiService           *services.AIService
	streamManager       *services.StreamManager
	memberService       *services.MemberService
	db                  *database.MongoDB
}

func NewImageHandler(imageService *services.ImageService, conversationService *services.ConversationService, ossService *services.COSService, aiService *services.AIService, streamManager *services.StreamManager, memberService *services.MemberService, db *database.MongoDB) *ImageHandler {
	return &ImageHandler{
		imageService:        imageService,
		conversationService: conversationService,
		ossService:          ossService,
		aiService:           aiService,
		streamManager:       streamManager,
		memberService:       memberService,
		db:                  db,
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

	// Check user credits and reset if needed
	userIDObj, _ := primitive.ObjectIDFromHex(userID)
	var user models.User
	err := h.db.Users().FindOne(c.Request.Context(), bson.M{"_id": userIDObj}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}

	if err := h.memberService.CheckAndResetCredits(c.Request.Context(), &user); err != nil {
		log.Printf("Failed to reset credits: %v", err)
	}

	if user.Credits <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient credits", "credits": user.Credits})
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
		// Publish image_gen_start event with resolution
		resolution := req.Resolution
		if resolution == "" {
			resolution = "2048x2048"
		}
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type:    "image_gen_start",
			Content: resolution,
		})

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

		// Deduct flat 50 credits for image generation
		newCredits, _ := h.memberService.DeductFlatCredits(bgCtx, userIDObj, 50)

		// Send done signal
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type: "done",
			Data: gin.H{
				"user_message_id":      userMsg.ID.Hex(),
				"assistant_message_id": assistantMsg.ID.Hex(),
				"credits":              newCredits,
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
	const maxFileSize = 15 * 1024 * 1024 // 15MB

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse multipart form"})
		return
	}

	// Try both "file" and "image" keys for backward compatibility
	files := form.File["file"]
	if len(files) == 0 {
		files = form.File["image"]
	}

	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided"})
		return
	}

	if len(files) > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Too many files. Maximum 5 files allowed"})
		return
	}

	header := files[0] // Take the first one

	// 1. Check file size
	if header.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File size exceeds 15MB limit"})
		return
	}

	file, err := header.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer file.Close()

	// 2. Check MIME type using Magic Number
	buffer := make([]byte, 512)
	_, err = file.Read(buffer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file header"})
		return
	}
	// Reset file pointer after reading header
	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset file pointer"})
		return
	}

	contentType := http.DetectContentType(buffer)
	validImageTypes := map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/webp": true,
		"image/gif":  true,
		"image/bmp":  true,
	}
	validVideoTypes := map[string]bool{
		"video/mp4":       true,
		"video/mpeg":      true,
		"video/quicktime": true,
		"video/webm":      true,
		"video/x-msvideo": true, // avi
	}

	if !validImageTypes[contentType] && !validVideoTypes[contentType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file type. Only common image and video formats are allowed"})
		return
	}

	url, err := h.ossService.UploadFile(file, header.Filename, "reference_files")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to upload file to OSS: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": url,
	})
}

func (h *ImageHandler) GetPresignedURL(c *gin.Context) {
	var req struct {
		Filename string `json:"filename" binding:"required"`
		Folder   string `json:"folder" binding:"required"`
		MimeType string `json:"mime_type" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	validFolders := map[string]bool{
		"avatars":         true,
		"reference_files": true,
		"images":          true,
	}
	if !validFolders[req.Folder] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid folder name"})
		return
	}

	uploadURL, finalURL, err := h.ossService.GetPresignedPutURL(c.Request.Context(), req.Folder, req.Filename, req.MimeType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"upload_url": uploadURL,
		"url":        finalURL,
	})
}
