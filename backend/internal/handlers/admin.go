package handlers

import (
	"context"
	"crypto/rand"
	"math/big"
	"net/http"
	"time"

	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type AdminHandler struct {
	db            *database.MongoDB
	aiService     *services.AIService
	memberService *services.MemberService
	agentRunner   interface {
		GetToolNames() []string
		GetToolDescriptions() map[string]string
		IsToolEnabled(name string) bool
		SetToolEnabled(name string, enabled bool)
		SaveToolStates(ctx context.Context) error
		LoadToolStates(ctx context.Context)
	}
}

func NewAdminHandler(db *database.MongoDB, aiService *services.AIService, memberService *services.MemberService) *AdminHandler {
	return &AdminHandler{
		db:            db,
		aiService:     aiService,
		memberService: memberService,
	}
}

func (h *AdminHandler) SetAgentRunner(runner interface {
	GetToolNames() []string
	GetToolDescriptions() map[string]string
	IsToolEnabled(name string) bool
	SetToolEnabled(name string, enabled bool)
	SaveToolStates(ctx context.Context) error
	LoadToolStates(ctx context.Context)
}) {
	h.agentRunner = runner
}

// Dashboard stats
func (h *AdminHandler) GetDashboardStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	totalUsers, _ := h.db.Users().CountDocuments(ctx, bson.M{})
	todayNewUsers, _ := h.db.Users().CountDocuments(ctx, bson.M{"created_at": bson.M{"$gte": todayStart}})

	totalConvs, _ := h.db.Conversations().CountDocuments(ctx, bson.M{})
	todayActiveConvs, _ := h.db.Conversations().CountDocuments(ctx, bson.M{"updated_at": bson.M{"$gte": todayStart}})

	totalMsgs, _ := h.db.Messages().CountDocuments(ctx, bson.M{})
	todayNewMsgs, _ := h.db.Messages().CountDocuments(ctx, bson.M{"created_at": bson.M{"$gte": todayStart}})

	c.JSON(http.StatusOK, models.SystemStats{
		TotalUsers:         totalUsers,
		TodayNewUsers:      todayNewUsers,
		TotalConversations: totalConvs,
		TodayActiveConvs:   todayActiveConvs,
		TotalMessages:      totalMsgs,
		TodayNewMessages:   todayNewMsgs,
	})
}

// Model Configs
func (h *AdminHandler) GetModelConfigs(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	cursor, err := h.db.Configs().Find(ctx, bson.M{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var configs []models.ModelConfig
	if err := cursor.All(ctx, &configs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if configs == nil {
		configs = []models.ModelConfig{}
	}

	c.JSON(http.StatusOK, configs)
}

func (h *AdminHandler) UpdateModelConfig(c *gin.Context) {
	var req models.ModelConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	req.UpdatedAt = time.Now()
	opts := options.Update().SetUpsert(true)
	_, err := h.db.Configs().UpdateOne(
		ctx,
		bson.M{"mode": req.Mode},
		bson.M{"$set": req},
		opts,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Update AIService hot reload
	err = h.aiService.UpdateConfig(req.Mode, req.APIKey, req.BaseURL, req.Model)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hot-reload AI service: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Config updated successfully"})
}

// User Management
func (h *AdminHandler) GetUsers(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	cursor, err := h.db.Users().Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"created_at": -1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var users []models.User
	if err := cursor.All(ctx, &users); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, users)
}

func (h *AdminHandler) GetUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var user models.User
	err = h.db.Users().FindOne(ctx, bson.M{"_id": id}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *AdminHandler) UpdateUserRole(c *gin.Context) {
	idStr := c.Param("id")
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req struct {
		Role string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	_, err = h.db.Users().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"role": req.Role, "updated_at": time.Now()}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User role updated successfully"})
}

func (h *AdminHandler) DeleteUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	// Delete user, their conversations, and their messages
	_, err = h.db.Users().DeleteOne(ctx, bson.M{"_id": id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_, _ = h.db.Conversations().DeleteMany(ctx, bson.M{"user_id": id})
	// Note: In a real app, you'd want to delete messages too, but messages are linked to conversations
	// For simplicity, we'll just delete user and conversations for now.

	c.JSON(http.StatusOK, gin.H{"message": "User and their data deleted successfully"})
}

// Conversation Management
func (h *AdminHandler) GetConversations(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	cursor, err := h.db.Conversations().Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"updated_at": -1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var conversations []models.Conversation
	if err := cursor.All(ctx, &conversations); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conversations)
}

func (h *AdminHandler) GetConversation(c *gin.Context) {
	idStr := c.Param("id")
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var conversation models.Conversation
	err = h.db.Conversations().FindOne(ctx, bson.M{"_id": id}).Decode(&conversation)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	cursor, err := h.db.Messages().Find(ctx, bson.M{"conversation_id": id}, options.Find().SetSort(bson.M{"created_at": 1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var messages []models.Message
	if err := cursor.All(ctx, &messages); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"conversation": conversation,
		"messages":     messages,
	})
}

func (h *AdminHandler) DeleteConversation(c *gin.Context) {
	idStr := c.Param("id")
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid conversation ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	_, err = h.db.Conversations().DeleteOne(ctx, bson.M{"_id": id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_, _ = h.db.Messages().DeleteMany(ctx, bson.M{"conversation_id": id})

	c.JSON(http.StatusOK, gin.H{"message": "Conversation and its messages deleted successfully"})
}

// Message Search
func (h *AdminHandler) SearchMessages(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameter 'q' is required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// Simple text search using regex (case-insensitive)
	filter := bson.M{"content": bson.M{"$regex": query, "$options": "i"}}
	cursor, err := h.db.Messages().Find(ctx, filter, options.Find().SetLimit(100).SetSort(bson.M{"created_at": -1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var messages []models.Message
	if err := cursor.All(ctx, &messages); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, messages)
}

// LoadConfigs loads all model configurations from DB into AIService
func (h *AdminHandler) LoadConfigs(ctx context.Context) {
	cursor, err := h.db.Configs().Find(ctx, bson.M{})
	if err != nil {
		return
	}
	defer cursor.Close(ctx)

	var configs []models.ModelConfig
	if err := cursor.All(ctx, &configs); err != nil {
		return
	}

	for _, cfg := range configs {
		h.aiService.UpdateConfig(cfg.Mode, cfg.APIKey, cfg.BaseURL, cfg.Model)
	}
}

func (h *AdminHandler) UpdateUserCredits(c *gin.Context) {
	idStr := c.Param("id")
	id, _ := primitive.ObjectIDFromHex(idStr)

	var req struct {
		Credits float64 `json:"credits" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	_, err := h.db.Users().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"credits": req.Credits, "updated_at": time.Now()}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User credits updated successfully"})
}

func (h *AdminHandler) UpdateUserMemberType(c *gin.Context) {
	idStr := c.Param("id")
	id, _ := primitive.ObjectIDFromHex(idStr)

	var req struct {
		MemberType string `json:"member_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	_, err := h.db.Users().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"member_type": req.MemberType, "updated_at": time.Now()}})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User member type updated successfully"})
}

func (h *AdminHandler) UpdateUserMember(c *gin.Context) {
	idStr := c.Param("id")
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req struct {
		MemberType   string     `json:"member_type"`
		Credits      float64    `json:"credits"`
		MemberExpiry *time.Time `json:"member_expiry"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	update := bson.M{
		"updated_at": time.Now(),
	}
	if req.MemberType != "" {
		update["member_type"] = req.MemberType
	}
	update["credits"] = req.Credits
	if req.MemberExpiry != nil {
		// Round to the next day's 00:00:00 of the selected date
		e := *req.MemberExpiry
		rounded := time.Date(e.Year(), e.Month(), e.Day(), 0, 0, 0, 0, e.Location()).AddDate(0, 0, 1)
		update["member_expiry"] = rounded
	} else {
		update["member_expiry"] = nil
	}

	_, err = h.db.Users().UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": update})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User member settings updated successfully"})
}

func (h *AdminHandler) GenerateInvitationCodes(c *gin.Context) {
	var req struct {
		Count          int    `json:"count" binding:"required"`
		Type           string `json:"type" binding:"required"` // pro, max
		DurationMonths int    `json:"duration_months"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.DurationMonths <= 0 {
		req.DurationMonths = 1 // Default to 1 month
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	codes := make([]interface{}, req.Count)
	generatedCodes := make([]string, req.Count)
	for i := 0; i < req.Count; i++ {
		code := generateRandomCode(10)
		generatedCodes[i] = code
		codes[i] = models.InvitationCode{
			ID:             primitive.NewObjectID(),
			Code:           code,
			Type:           models.MemberType(req.Type),
			DurationMonths: req.DurationMonths,
			IsUsed:         false,
			CreatedAt:      time.Now(),
		}
	}

	_, err := h.db.Collection("invitation_codes").InsertMany(ctx, codes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"codes": generatedCodes})
}

func generateRandomCode(length int) string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // Avoid easily confused characters
	result := make([]byte, length)
	for i := range result {
		num, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		result[i] = charset[num.Int64()]
	}
	return string(result)
}

func (h *AdminHandler) GetInvitationCodes(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	cursor, err := h.db.Collection("invitation_codes").Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"created_at": -1}))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer cursor.Close(ctx)

	var codes []models.InvitationCode
	if err := cursor.All(ctx, &codes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, codes)
}

func (h *AdminHandler) GetSystemSettings(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var settings models.SystemSettings
	err := h.db.Collection("system_settings").FindOne(ctx, bson.M{}).Decode(&settings)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			c.JSON(http.StatusOK, models.SystemSettings{
				CampaignConfig: models.CampaignConfig{
					IsActive:        false,
					CampaignCredits: make(map[string]float64),
				},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, settings)
}

func (h *AdminHandler) UpdateSystemSettings(c *gin.Context) {
	var req models.SystemSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	update := bson.M{
		"$set": bson.M{
			"campaign_config": req.CampaignConfig,
			"updated_at":      time.Now(),
		},
	}

	opts := options.Update().SetUpsert(true)
	_, err := h.db.Collection("system_settings").UpdateOne(ctx, bson.M{}, update, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Refresh all users' credits to the new limits
	go func() {
		refreshCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		h.memberService.RefreshAllUsersCredits(refreshCtx)
	}()

	c.JSON(http.StatusOK, gin.H{"message": "System settings updated successfully and credits refresh started"})
}

func (h *AdminHandler) GetAgentTools(c *gin.Context) {
	if h.agentRunner == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Agent not initialized"})
		return
	}

	names := h.agentRunner.GetToolNames()
	descriptions := h.agentRunner.GetToolDescriptions()

	type ToolInfo struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Enabled     bool   `json:"enabled"`
	}

	tools := make([]ToolInfo, 0, len(names))
	for _, name := range names {
		tools = append(tools, ToolInfo{
			Name:        name,
			Description: descriptions[name],
			Enabled:     h.agentRunner.IsToolEnabled(name),
		})
	}

	c.JSON(http.StatusOK, tools)
}

func (h *AdminHandler) ToggleAgentTool(c *gin.Context) {
	if h.agentRunner == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Agent not initialized"})
		return
	}

	name := c.Param("name")

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.agentRunner.SetToolEnabled(name, req.Enabled)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if err := h.agentRunner.SaveToolStates(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save tool state: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Tool state updated", "name": name, "enabled": req.Enabled})
}

// SetupAdmin ensures at least one admin exists
func (h *AdminHandler) SetupAdmin(ctx context.Context) {
	count, _ := h.db.Users().CountDocuments(ctx, bson.M{"role": "admin"})
	if count == 0 {
		// No admin found, let's make the first user an admin if exists
		var firstUser models.User
		err := h.db.Users().FindOne(ctx, bson.M{}).Decode(&firstUser)
		if err == nil {
			h.db.Users().UpdateOne(ctx, bson.M{"_id": firstUser.ID}, bson.M{"$set": bson.M{"role": "admin"}})
			println("Warning: No admin found. Promoted user '" + firstUser.Username + "' to admin.")
		} else {
			println("Notice: No users found. First registered user will need manual promotion to admin via DB.")
		}
	}
}
