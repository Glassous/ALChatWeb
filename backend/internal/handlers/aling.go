package handlers

import (
	"alchat-backend/internal/services"
	"net/http"

	"github.com/gin-gonic/gin"
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
	tools := []map[string]any{}
	c.JSON(http.StatusOK, gin.H{"tools": tools})
}
