package handlers

import (
	"net/http"
	"strings"
	"time"

	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"github.com/gin-gonic/gin"
)

type CustomModelHandler struct {
	service *services.CustomModelService
	ai      *services.AIService
}

func NewCustomModelHandler(service *services.CustomModelService, ai *services.AIService) *CustomModelHandler {
	return &CustomModelHandler{service: service, ai: ai}
}

type customModelRequest struct {
	Enabled       bool   `json:"enabled"`
	BaseURL       string `json:"base_url"`
	APIKey        string `json:"api_key"`
	Model         string `json:"model"`
	DailyEnabled  bool   `json:"daily_enabled"`
	ExpertEnabled bool   `json:"expert_enabled"`
	SearchEnabled bool   `json:"search_enabled"`
	ClearAPIKey   bool   `json:"clear_api_key"`
}

func customModelView(cfg *models.CustomModelConfig) gin.H {
	return gin.H{"enabled": cfg.Enabled, "base_url": cfg.BaseURL, "model": cfg.Model,
		"daily_enabled": cfg.DailyEnabled, "expert_enabled": cfg.ExpertEnabled, "search_enabled": cfg.SearchEnabled,
		"has_api_key": cfg.APIKeyCiphertext != "", "api_key_masked": func() string {
			if cfg.APIKeyCiphertext != "" {
				return "••••••••"
			}
			return ""
		}(),
		"response_mode": cfg.ResponseMode, "last_tested_at": cfg.LastTestedAt}
}

func (h *CustomModelHandler) Get(c *gin.Context) {
	cfg, err := h.service.Get(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load custom model settings"})
		return
	}
	c.JSON(http.StatusOK, customModelView(cfg))
}

func (h *CustomModelHandler) Update(c *gin.Context) {
	var req customModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	req.BaseURL, req.Model, req.APIKey = strings.TrimSpace(req.BaseURL), strings.TrimSpace(req.Model), strings.TrimSpace(req.APIKey)
	if len(req.BaseURL) > 512 || len(req.Model) > 255 || len(req.APIKey) > 4096 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Custom model setting is too long"})
		return
	}
	if req.BaseURL != "" {
		if err := services.ValidateCustomBaseURL(req.BaseURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	old, err := h.service.Get(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load custom model settings"})
		return
	}
	keyCipher := old.APIKeyCiphertext
	if req.ClearAPIKey {
		keyCipher = ""
	}
	if req.APIKey != "" {
		keyCipher, err = h.service.Encrypt(req.APIKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to protect API key"})
			return
		}
	}
	credentialsChanged := old.BaseURL != req.BaseURL || old.Model != req.Model || req.APIKey != "" || req.ClearAPIKey
	cfg := models.CustomModelConfig{UserID: c.GetString("user_id"), Enabled: req.Enabled, BaseURL: strings.TrimRight(req.BaseURL, "/"), APIKeyCiphertext: keyCipher, Model: req.Model,
		DailyEnabled: req.DailyEnabled, ExpertEnabled: req.ExpertEnabled, SearchEnabled: req.SearchEnabled,
		ResponseMode: old.ResponseMode, LastTestedAt: old.LastTestedAt}
	if credentialsChanged {
		cfg.ResponseMode = ""
		cfg.LastTestedAt = nil
	}
	if cfg.Enabled && (cfg.BaseURL == "" || cfg.Model == "" || cfg.APIKeyCiphertext == "" || cfg.ResponseMode == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先完整填写配置并通过连通性检测"})
		return
	}
	if err := h.service.Save(c.Request.Context(), &cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save custom model settings"})
		return
	}
	c.JSON(http.StatusOK, customModelView(&cfg))
}

func (h *CustomModelHandler) Test(c *gin.Context) {
	var req customModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	req.BaseURL, req.Model, req.APIKey = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"), strings.TrimSpace(req.Model), strings.TrimSpace(req.APIKey)
	if err := services.ValidateCustomBaseURL(req.BaseURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	old, err := h.service.Get(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to load settings"})
		return
	}
	key := req.APIKey
	if key == "" && old.APIKeyCiphertext != "" {
		key, err = h.service.Decrypt(old.APIKeyCiphertext)
	}
	if err != nil || key == "" || req.Model == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Base URL、API Key 和 Model 均为必填项"})
		return
	}
	mode, err := h.ai.TestCustomModel(c.Request.Context(), &services.CustomModelRuntime{APIKey: key, BaseURL: req.BaseURL, Model: req.Model})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "连通性检测失败: " + err.Error()})
		return
	}
	keyCipher := old.APIKeyCiphertext
	if req.APIKey != "" {
		keyCipher, err = h.service.Encrypt(req.APIKey)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to protect API key"})
			return
		}
	}
	now := time.Now()
	old.BaseURL, old.Model, old.APIKeyCiphertext, old.ResponseMode, old.LastTestedAt = req.BaseURL, req.Model, keyCipher, mode, &now
	if err := h.service.Save(c.Request.Context(), old); err != nil {
		c.JSON(500, gin.H{"error": "Failed to save test result"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"connected": true, "response_mode": mode, "last_tested_at": now})
}
