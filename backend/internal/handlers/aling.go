package handlers

import (
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"
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
}

func NewALingHandler(alingService *services.ALingService, streamMgr *services.StreamManager, memberService *services.MemberService) *ALingHandler {
	return &ALingHandler{alingService: alingService, streamMgr: streamMgr, memberService: memberService}
}

// GET /api/aling/tools
func (h *ALingHandler) GetTools(c *gin.Context) {
	tools := []map[string]any{
		{
			"id":          "demo",
			"name":        "ALing 演示",
			"description": "AI 驱动的 HTML 演示文稿生成器，输入主题即可生成类 PPT 演示",
			"icon":        "slideshow",
			"route":       "/aling/demo",
			"enabled":     true,
		},
	}
	c.JSON(http.StatusOK, gin.H{"tools": tools})
}

// POST /api/aling/demo
func (h *ALingHandler) CreateDemo(c *gin.Context) {
	userID := c.GetString("user_id")
	userIDObj, err := primitive.ObjectIDFromHex(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req models.CreateDemoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	if req.Topic == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "topic is required"})
		return
	}

	task, err := h.alingService.CreateDemo(c.Request.Context(), userIDObj, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, task)
}

// GET /api/aling/demo/tasks
func (h *ALingHandler) ListDemoTasks(c *gin.Context) {
	userID := c.GetString("user_id")
	userIDObj, err := primitive.ObjectIDFromHex(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	tasks, err := h.alingService.ListDemoTasks(c.Request.Context(), userIDObj)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

// GET /api/aling/demo/:taskId
func (h *ALingHandler) GetDemoTask(c *gin.Context) {
	taskID := c.Param("taskId")

	task, err := h.alingService.GetDemoTask(c.Request.Context(), taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, task)
}

// POST /api/aling/demo/:taskId/outline
func (h *ALingHandler) GenerateOutline(c *gin.Context) {
	userID := c.GetString("user_id")
	userIDObj, err := primitive.ObjectIDFromHex(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	taskID := c.Param("taskId")

	task, err := h.alingService.GetDemoTask(c.Request.Context(), taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if task.Status != "pending" && task.Status != "outline_ready" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Task is not in pending state"})
		return
	}

	bgCtx := context.WithoutCancel(c.Request.Context())
	go func() {
		log.Printf("[ALingHandler] Starting outline generation for task %s, user %s", taskID, userID)
		h.alingService.GenerateOutline(bgCtx, taskID, userIDObj)
	}()

	c.JSON(http.StatusOK, gin.H{"status": "outline_generating"})
}

// PUT /api/aling/demo/:taskId/outline
func (h *ALingHandler) UpdateOutline(c *gin.Context) {
	taskID := c.Param("taskId")

	var req models.UpdateOutlineRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if err := h.alingService.UpdateOutline(c.Request.Context(), taskID, req.Outline); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// POST /api/aling/demo/:taskId/generate
func (h *ALingHandler) GenerateHTML(c *gin.Context) {
	userID := c.GetString("user_id")
	userIDObj, err := primitive.ObjectIDFromHex(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	taskID := c.Param("taskId")

	task, err := h.alingService.GetDemoTask(c.Request.Context(), taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if task.Status != "outline_ready" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Outline not ready"})
		return
	}

	bgCtx := context.WithoutCancel(c.Request.Context())
	go func() {
		log.Printf("[ALingHandler] Starting HTML generation for task %s, user %s", taskID, userID)
		h.alingService.GenerateHTML(bgCtx, taskID, userIDObj)
	}()

	c.JSON(http.StatusOK, gin.H{"status": "generating"})
}

// GET /api/aling/demo/:taskId/stream
func (h *ALingHandler) StreamTask(c *gin.Context) {
	taskID := c.Param("taskId")

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	ch := h.streamMgr.Subscribe(taskID)
	defer h.streamMgr.Unsubscribe(taskID, ch)

	c.Stream(func(w io.Writer) bool {
		select {
		case <-c.Request.Context().Done():
			return false
		case resp, ok := <-ch:
			if !ok {
				return false
			}
			data, _ := json.Marshal(resp)
			fmt.Fprintf(w, "data: %s\n\n", data)
			return true
		}
	})
}

// GET /api/aling/demo/:taskId/output
func (h *ALingHandler) GetOutput(c *gin.Context) {
	taskID := c.Param("taskId")

	task, err := h.alingService.GetDemoTask(c.Request.Context(), taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if task.Status != "completed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Not yet completed"})
		return
	}

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, task.HTMLContent)
}

// DELETE /api/aling/demo/:taskId
func (h *ALingHandler) DeleteDemoTask(c *gin.Context) {
	taskID := c.Param("taskId")

	if err := h.alingService.DeleteDemoTask(c.Request.Context(), taskID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
