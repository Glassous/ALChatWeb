package handlers

import (
	"context"
	"net/http"
	"time"

	"alchat-backend/internal/models"
	"alchat-backend/internal/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ShareHandler struct {
	shareService *services.ShareService
}

func NewShareHandler(shareService *services.ShareService) *ShareHandler {
	return &ShareHandler{shareService: shareService}
}

func (h *ShareHandler) CreateShare(c *gin.Context) {
	idStr := c.Param("id")
	convID, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	var req struct {
		LeafMessageID *string `json:"leaf_message_id"`
	}
	_ = c.ShouldBindJSON(&req)

	var leafMsgID *primitive.ObjectID
	if req.LeafMessageID != nil {
		id, err := primitive.ObjectIDFromHex(*req.LeafMessageID)
		if err == nil {
			leafMsgID = &id
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	share, err := h.shareService.CreateShare(ctx, userID, convID, leafMsgID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, share)
}

func (h *ShareHandler) GetSharedConversation(c *gin.Context) {
	token := c.Param("token")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	result, err := h.shareService.GetSharedConversation(ctx, token)
	if err != nil {
		if err.Error() == "not_found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "分享链接不存在"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ShareHandler) DeleteShare(c *gin.Context) {
	token := c.Param("token")

	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	err = h.shareService.DeleteShareByToken(ctx, userID, token)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "分享已删除"})
}

func (h *ShareHandler) GetMyShares(c *gin.Context) {
	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	shares, err := h.shareService.GetMyShares(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if shares == nil {
		shares = []models.SharedConversation{}
	}

	c.JSON(http.StatusOK, shares)
}

func (h *ShareHandler) SaveSharedConversation(c *gin.Context) {
	token := c.Param("token")

	userIDStr := c.GetString("user_id")
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	newConvID, err := h.shareService.SaveSharedConversation(ctx, userID, token)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"conversation_id": newConvID})
}

func (h *ShareHandler) GetAllShares(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	shares, _, err := h.shareService.GetAllShares(ctx, 1, 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if shares == nil {
		shares = []models.SharedConversation{}
	}

	c.JSON(http.StatusOK, shares)
}

func (h *ShareHandler) AdminDeleteShare(c *gin.Context) {
	idStr := c.Param("id")
	shareID, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid share ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	err = h.shareService.AdminDeleteShare(ctx, shareID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "分享不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "分享已删除"})
}
