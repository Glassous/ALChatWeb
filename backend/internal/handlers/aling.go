package handlers

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"alchat-backend/internal/utils"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ALingHandler struct {
	alingService  *services.ALingService
	streamMgr     *services.StreamManager
	memberService *services.MemberService
	db            *database.MongoDB
	mysqlDB       *database.MySQL
}

func NewALingHandler(alingService *services.ALingService, streamMgr *services.StreamManager, memberService *services.MemberService, db *database.MongoDB, mysqlDB *database.MySQL) *ALingHandler {
	return &ALingHandler{alingService: alingService, streamMgr: streamMgr, memberService: memberService, db: db, mysqlDB: mysqlDB}
}

// GET /api/aling/tools
func (h *ALingHandler) GetTools(c *gin.Context) {
	tools := []map[string]any{
		{
			"id":          "translator",
			"name":        "AL翻译",
			"description": "多语言翻译",
			"icon":        "translate",
			"route":       "/aling/translator",
			"enabled":     true,
		},
	}
	c.JSON(http.StatusOK, gin.H{"tools": tools})
}

// GET /api/aling/translator/languages
func (h *ALingHandler) GetTranslatorLanguages(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	langs, err := h.alingService.GetTranslatorLanguages(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"languages": langs})
}

// POST /api/aling/translator/languages
func (h *ALingHandler) AddTranslatorLanguage(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	var req struct {
		Language string `json:"language" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Language name is required"})
		return
	}
	err = h.alingService.AddTranslatorLanguage(c.Request.Context(), userID, req.Language)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Language added successfully"})
}

// DELETE /api/aling/translator/languages
func (h *ALingHandler) DeleteTranslatorLanguage(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	var req struct {
		Language string `json:"language" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Language name is required"})
		return
	}
	err = h.alingService.DeleteTranslatorLanguage(c.Request.Context(), userID, req.Language)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Language deleted successfully"})
}

// POST /api/aling/translator/languages/reset
func (h *ALingHandler) ResetTranslatorLanguages(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	langs, err := h.alingService.ResetTranslatorLanguages(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"languages": langs})
}

// GET /api/aling/translator/history
func (h *ALingHandler) GetTranslationHistory(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	history, err := h.alingService.GetTranslationHistory(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"history": history})
}

// DELETE /api/aling/translator/history/:id
func (h *ALingHandler) DeleteTranslationHistory(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	idStr := c.Param("id")
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid history ID"})
		return
	}
	err = h.alingService.DeleteTranslationHistory(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "History deleted successfully"})
}

// POST /api/aling/translator/translate
func (h *ALingHandler) TranslateText(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req struct {
		Text       string `json:"text" binding:"required"`
		TargetLang string `json:"target_lang" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Text and target_lang are required"})
		return
	}

	// 1. Check user credits and reset if needed
	var user models.User
	err = h.mysqlDB.DB.WithContext(c.Request.Context()).Where("id = ?", userID.Hex()).First(&user).Error
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

	// Set up SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	c.Stream(func(w io.Writer) bool {
		translatedText, err := h.alingService.TranslateStream(c.Request.Context(), userID, req.Text, req.TargetLang, func(token string) error {
			data, _ := json.Marshal(gin.H{
				"type":    "token",
				"content": token,
			})
			fmt.Fprintf(w, "data: %s\n\n", data)
			w.(http.Flusher).Flush()
			return nil
		})

		if err != nil {
			data, _ := json.Marshal(gin.H{
				"type":    "error",
				"content": err.Error(),
			})
			fmt.Fprintf(w, "data: %s\n\n", data)
			w.(http.Flusher).Flush()
			return false
		}

		// Save the translation record to MongoDB
		record, saveErr := h.alingService.SaveTranslationHistory(context.Background(), userID, req.Text, translatedText, req.TargetLang)
		if saveErr != nil {
			data, _ := json.Marshal(gin.H{
				"type":    "error",
				"content": "Failed to save history: " + saveErr.Error(),
			})
			fmt.Fprintf(w, "data: %s\n\n", data)
			w.(http.Flusher).Flush()
			return false
		}

		// Deduct credits based on token count
		costInput := utils.CountTokens(req.Text)
		costOutput := utils.CountTokens(translatedText)
		newCredits, deductErr := h.memberService.DeductCredits(context.Background(), userID, costInput, costOutput)
		if deductErr != nil {
			log.Printf("Failed to deduct credits for user %s: %v", userID.Hex(), deductErr)
		}

		// Stream the final "done" event containing the record details and new credits
		data, _ := json.Marshal(gin.H{
			"type":        "done",
			"history_id":  record.ID.Hex(),
			"target_text": translatedText,
			"credits":     newCredits,
		})
		fmt.Fprintf(w, "data: %s\n\n", data)
		w.(http.Flusher).Flush()
		return false // end stream
	})
}

