package handlers

import (
	"net/http"
	"strings"
	"time"

	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
	"github.com/gin-gonic/gin"
)

type HermesHandler struct{ service *services.HermesService }

func NewHermesHandler(s *services.HermesService) *HermesHandler { return &HermesHandler{s} }

type hermesRequest struct {
	BaseURL     string `json:"base_url"`
	APIKey      string `json:"api_key"`
	Model       string `json:"model"`
	ClearAPIKey bool   `json:"clear_api_key"`
}

func hermesView(c *models.HermesConfig) gin.H {
	return gin.H{"base_url": c.BaseURL, "model": c.Model, "has_api_key": c.APIKeyCiphertext != "", "tested": c.Tested, "context_version": c.ContextVersion, "last_tested_at": c.LastTestedAt}
}
func (h *HermesHandler) Get(c *gin.Context) {
	v, e := h.service.Get(c.Request.Context(), c.GetString("user_id"))
	if e != nil {
		c.JSON(500, gin.H{"error": "Failed to load Hermes settings"})
		return
	}
	c.JSON(200, hermesView(v))
}
func (h *HermesHandler) Update(c *gin.Context) {
	var r hermesRequest
	if c.ShouldBindJSON(&r) != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}
	r.BaseURL = strings.TrimSpace(r.BaseURL)
	r.Model = strings.TrimSpace(r.Model)
	r.APIKey = strings.TrimSpace(r.APIKey)
	if r.BaseURL != "" {
		if e := services.ValidateCustomBaseURL(r.BaseURL); e != nil {
			c.JSON(400, gin.H{"error": e.Error()})
			return
		}
	}
	old, e := h.service.Get(c.Request.Context(), c.GetString("user_id"))
	if e != nil {
		c.JSON(500, gin.H{"error": "Failed to load Hermes settings"})
		return
	}
	oldKey := ""
	if old.APIKeyCiphertext != "" {
		oldKey, _ = h.service.Decrypt(old.APIKeyCiphertext)
	}
	keyChanged := (r.ClearAPIKey && old.APIKeyCiphertext != "") || (r.APIKey != "" && r.APIKey != oldKey)
	changed := old.BaseURL != r.BaseURL || old.Model != r.Model || keyChanged
	old.BaseURL = r.BaseURL
	old.Model = r.Model
	if r.ClearAPIKey {
		old.APIKeyCiphertext = ""
	}
	if r.APIKey != "" {
		old.APIKeyCiphertext, e = h.service.Encrypt(r.APIKey)
		if e != nil {
			c.JSON(500, gin.H{"error": "Failed to protect API key"})
			return
		}
	}
	if changed {
		old.ContextVersion++
		if old.ContextVersion == 0 {
			old.ContextVersion = 1
		}
		old.Tested = false
		old.LastTestedAt = nil
	}
	if old.BaseURL == "" || old.Model == "" || old.APIKeyCiphertext == "" {
		old.Tested = false
	}
	if e = h.service.Save(c.Request.Context(), old); e != nil {
		c.JSON(500, gin.H{"error": "Failed to save Hermes settings"})
		return
	}
	c.JSON(200, hermesView(old))
}
func (h *HermesHandler) Test(c *gin.Context) {
	var r hermesRequest
	if c.ShouldBindJSON(&r) != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}
	r.BaseURL = strings.TrimSpace(r.BaseURL)
	r.Model = strings.TrimSpace(r.Model)
	r.APIKey = strings.TrimSpace(r.APIKey)
	if e := services.ValidateCustomBaseURL(r.BaseURL); e != nil {
		c.JSON(400, gin.H{"error": e.Error()})
		return
	}
	old, e := h.service.Get(c.Request.Context(), c.GetString("user_id"))
	if e != nil {
		c.JSON(500, gin.H{"error": "Failed to load settings"})
		return
	}
	key := r.APIKey
	oldKey := ""
	if old.APIKeyCiphertext != "" {
		oldKey, _ = h.service.Decrypt(old.APIKeyCiphertext)
	}
	if key == "" && old.APIKeyCiphertext != "" {
		key, e = h.service.Decrypt(old.APIKeyCiphertext)
	}
	if e != nil || key == "" || r.Model == "" {
		c.JSON(400, gin.H{"error": "Base URL、API Key 和 Model 均为必填项"})
		return
	}
	gotText := false
	_, e = h.service.Stream(c.Request.Context(), &services.HermesRuntime{APIKey: key, BaseURL: r.BaseURL, Model: r.Model}, []models.AIMessage{{Role: "user", Content: "Reply with OK"}}, "", func(string) {}, func(v string) {
		if v != "" {
			gotText = true
		}
	}, func(models.HermesStep) {})
	if e != nil || !gotText {
		if e == nil {
			e = http.ErrBodyNotAllowed
		}
		c.JSON(502, gin.H{"error": "Hermes 连通性检测失败: " + e.Error()})
		return
	}
	if r.APIKey != "" {
		old.APIKeyCiphertext, e = h.service.Encrypt(r.APIKey)
		if e != nil {
			c.JSON(500, gin.H{"error": "Failed to protect API key"})
			return
		}
	}
	now := time.Now()
	credentialsChanged := old.BaseURL != r.BaseURL || old.Model != r.Model || (r.APIKey != "" && r.APIKey != oldKey)
	if old.ContextVersion == 0 {
		old.ContextVersion = 1
	} else if credentialsChanged {
		old.ContextVersion++
	}
	old.BaseURL = r.BaseURL
	old.Model = r.Model
	old.Tested = true
	old.LastTestedAt = &now
	if e = h.service.Save(c.Request.Context(), old); e != nil {
		c.JSON(500, gin.H{"error": "Failed to save test result"})
		return
	}
	c.JSON(200, hermesView(old))
}
