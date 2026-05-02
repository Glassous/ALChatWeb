package handlers

import (
	"alchat-backend/internal/agent"
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
	"strings"
	"time"

	"github.com/firebase/genkit/go/ai"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ChatHandler struct {
	aiService           *services.AIService
	conversationService *services.ConversationService
	memberService       *services.MemberService
	db                  *database.MongoDB
	streamManager       *services.StreamManager
	agentRunner         interface {
		Run(ctx context.Context, messages []*ai.Message, callback interface{}) (*agent.AgentResult, error)
		RunWithStreaming(ctx context.Context, messages []*ai.Message, stepCb agent.StepCallback, tokenCb func(string), reasoningCb func(string)) (*agent.AgentResult, error)
	}
}

func NewChatHandler(aiService *services.AIService, conversationService *services.ConversationService, memberService *services.MemberService, db *database.MongoDB, streamManager *services.StreamManager) *ChatHandler {
	return &ChatHandler{
		aiService:           aiService,
		conversationService: conversationService,
		memberService:       memberService,
		db:                  db,
		streamManager:       streamManager,
	}
}

func (h *ChatHandler) SetAgentRunner(runner interface {
	Run(ctx context.Context, messages []*ai.Message, callback interface{}) (*agent.AgentResult, error)
	RunWithStreaming(ctx context.Context, messages []*ai.Message, stepCb agent.StepCallback, tokenCb func(string), reasoningCb func(string)) (*agent.AgentResult, error)
}) {
	h.agentRunner = runner
}

func (h *ChatHandler) Chat(c *gin.Context) {
	userID := c.GetString("user_id")
	var req models.ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if req.ConversationID == "" || req.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id and message are required"})
		return
	}

	// 1. Check user credits and reset if needed
	userIDObj, _ := primitive.ObjectIDFromHex(userID)
	var user models.User
	err := h.db.Users().FindOne(c.Request.Context(), bson.M{"_id": userIDObj}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}

	// Reset credits if it's a new day
	if err := h.memberService.CheckAndResetCredits(c.Request.Context(), &user); err != nil {
		log.Printf("Failed to reset credits: %v", err)
	}

	// If credits already <= 0, deny request
	if user.Credits <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient credits", "credits": user.Credits})
		return
	}

	// Save user message
	userMsg, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "user", req.Message, userID, req.ParentMessageID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save user message"})
		return
	}

	// Create a belong to assistant empty message
	assistantMsg, err := h.conversationService.SaveMessage(c.Request.Context(), req.ConversationID, "assistant", "", userID, userMsg.ID.Hex())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create assistant message placeholder"})
		return
	}

	// Detached context for background processing
	bgCtx := context.WithoutCancel(c.Request.Context())

	// Start background generation
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Chat] Panic in background generation: %v", r)
				h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
					Type:    "error",
					Content: fmt.Sprintf("Internal error: %v", r),
				})
			}
		}()

		// Get conversation history (branch)
		messages, err := h.conversationService.GetMessageBranch(bgCtx, req.ConversationID, userMsg.ID.Hex())
		if err != nil {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "error",
				Content: "Failed to fetch conversation history",
			})
			return
		}

		// Convert to Genkit format
		genkitMessages := make([]struct {
			Role    string
			Content string
		}, len(messages))
		for i, msg := range messages {
			genkitMessages[i] = struct {
				Role    string
				Content string
			}{
				Role:    msg.Role,
				Content: msg.Content,
			}
		}

		userIDObj, _ := primitive.ObjectIDFromHex(userID)

		if req.Mode == "agent" {
			h.handleAgentMode(bgCtx, req, genkitMessages, assistantMsg, userIDObj, userMsg)
			return
		}

		// Get user settings for system prompt
		var user models.User
		h.db.Users().FindOne(bgCtx, bson.M{"_id": userIDObj}).Decode(&user)

		// Construct system prompt
		var systemPromptBuilder strings.Builder
		if user.SystemPrompt != "" {
			systemPromptBuilder.WriteString(user.SystemPrompt)
		}

		if user.IncludeDateTime {
			currentTime := time.Now().Format("2006-01-02 15:04:05")
			if systemPromptBuilder.Len() > 0 {
				systemPromptBuilder.WriteString("\n\n")
			}
			fmt.Fprintf(&systemPromptBuilder, "当前时间: %s", currentTime)
		}

		if user.IncludeLocation && req.Location != "" {
			locationStr := req.Location
			if IsCoordinateFormat(locationStr) {
				locationStr = ReverseGeocodeFromCoords(locationStr)
			}
			if systemPromptBuilder.Len() > 0 {
				systemPromptBuilder.WriteString("\n\n")
			}
			fmt.Fprintf(&systemPromptBuilder, "当前位置: %s", locationStr)
		}

		// Stream AI response
		var fullResponse strings.Builder
		var fullReasoning strings.Builder
		var lastSearchData *models.SearchData

		extraInput, extraOutput, err := h.aiService.GenerateStream(
			bgCtx,
			services.ConvertToGenkitMessages(genkitMessages),
			req.Mode,
			systemPromptBuilder.String(),
			func(token string, reasoning string) error {
				if reasoning != "" {
					fullReasoning.WriteString(reasoning)
					h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
						Type:    "reasoning",
						Content: reasoning,
					})
				}

				if token != "" {
					fullResponse.WriteString(token)
					h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
						Type:    "token",
						Content: token,
					})
				}

				return nil
			},
			func(searchData models.SearchData) error {
				lastSearchData = &searchData
				h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
					Type: "search",
					Data: searchData,
				})
				return nil
			},
		)

		if err != nil {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "error",
				Content: err.Error(),
			})
			return
		}

		// Update assistant message with final content
		assistantMsg.Content = fullResponse.String()
		assistantMsg.Reasoning = fullReasoning.String()
		assistantMsg.Search = lastSearchData
		err = h.conversationService.UpdateMessage(bgCtx, assistantMsg)
		if err != nil {
			log.Printf("Failed to update assistant message: %v", err)
		}

		// Send done signal
		newCredits, _ := h.memberService.DeductCredits(bgCtx, userIDObj, utils.CountTokens(userMsg.Content)+extraInput, utils.CountTokens(fullResponse.String())+extraOutput)

		// Generate title BEFORE done so it's already saved in DB when frontend reloads
		title, titleErr := h.conversationService.AutoGenerateTitle(bgCtx, req.ConversationID, userID, h.aiService)
		if titleErr == nil && title != "" {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "title",
				Content: title,
			})
		}

		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type: "done",
			Data: gin.H{
				"user_message_id":      userMsg.ID.Hex(),
				"assistant_message_id": assistantMsg.ID.Hex(),
				"credits":              newCredits,
			},
		})

		// Optional: delay cleanup to allow last message to reach subscribers
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

func (h *ChatHandler) handleAgentMode(ctx context.Context, req models.ChatRequest, genkitMessages []struct {
	Role    string
	Content string
}, assistantMsg *models.Message, userIDObj primitive.ObjectID, userMsg *models.Message) {
	if h.agentRunner == nil {
		log.Printf("[Agent] Agent runner not configured")
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type:    "error",
			Content: "Agent not configured. Please set agent model in admin settings.",
		})
		return
	}

	log.Printf("[Agent] Starting agent mode for conversation %s", req.ConversationID)
	h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
		Type: "agent_start",
	})

	aiMessages := services.ConvertToGenkitMessages(genkitMessages)

	var allSteps []models.AgentStepData
	var allPlan []models.AgentPlanItemData
	var accumulatedReasoning string
	var accumulatedAnswer string
	startSent := false
	textSent := false

	agentResult, err := h.agentRunner.RunWithStreaming(ctx, aiMessages, agent.StepCallback(func(step agent.AgentStep) {

		if step.Plan != nil && len(step.Plan.Items) > 0 {
			allPlan = make([]models.AgentPlanItemData, len(step.Plan.Items))
			for i, item := range step.Plan.Items {
				allPlan[i] = models.AgentPlanItemData{
					ID:          item.ID,
					Description: item.Description,
					ToolName:    item.ToolName,
					Status:      string(item.Status),
				}
			}
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "agent_plan",
				Data: step.Plan.Items,
			})
			return
		}

		if step.ToolName == "plan_progress" {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "plan_item",
				Data: map[string]interface{}{"index": step.PlanIndex, "status": "in_progress"},
			})
			return
		}

		if step.ToolName == "plan_item" {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "plan_item",
				Data: map[string]interface{}{"index": step.PlanIndex, "status": "completed"},
			})
			return
		}

		if step.ToolName != "" {
			inputJSON, _ := json.Marshal(step.ToolInput)
			stepData := models.AgentStepData{
				Index:      step.Index,
				ToolName:   step.ToolName,
				ToolInput:  string(inputJSON),
				ToolOutput: step.ToolOutput,
				Err:        step.Err,
				PlanIndex:  step.PlanIndex,
			}
			allSteps = append(allSteps, stepData)

			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "agent_step",
				Data: stepData,
			})

			if textSent {
				accumulatedAnswer = ""
				textSent = false
			}
		}
	}), func(token string) {
		if !startSent {
			startSent = true
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "start",
			})
		}
		textSent = true
		accumulatedAnswer += token
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type:    "token",
			Content: token,
		})
	}, func(reasoningChunk string) {
		if !startSent {
			startSent = true
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "start",
			})
		}
		accumulatedReasoning += reasoningChunk
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type:    "reasoning",
			Content: reasoningChunk,
		})
	})

	if err != nil {
		log.Printf("[Agent] Run failed: %v", err)
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type:    "error",
			Content: err.Error(),
		})
		return
	}

	if agentResult == nil {
		agentResult = &agent.AgentResult{}
	}

	if accumulatedAnswer == "" {
		accumulatedAnswer = agentResult.Answer
	}
	if accumulatedReasoning == "" {
		accumulatedReasoning = agentResult.Reasoning
	}

	log.Printf("[Agent] Run completed, answer length: %d, reasoning length: %d", len(accumulatedAnswer), len(accumulatedReasoning))

	for i, item := range allPlan {
		if item.Status != string(agent.PlanStatusCompleted) {
			allPlan[i].Status = string(agent.PlanStatusCompleted)
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "plan_item",
				Data: map[string]interface{}{"index": i, "status": "completed"},
			})
		}
	}

	assistantMsg.Content = accumulatedAnswer
	assistantMsg.Reasoning = accumulatedReasoning
	assistantMsg.AgentSteps = allSteps
	assistantMsg.AgentPlan = allPlan
	h.conversationService.UpdateMessage(ctx, assistantMsg)

	newCredits, _ := h.memberService.DeductCredits(ctx, userIDObj, utils.CountTokens(userMsg.Content), utils.CountTokens(agentResult.Answer))

	title, titleErr := h.conversationService.AutoGenerateTitle(ctx, req.ConversationID, userIDObj.Hex(), h.aiService)
	if titleErr == nil && title != "" {
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type:    "title",
			Content: title,
		})
	}

	h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
		Type: "done",
		Data: gin.H{
			"user_message_id":      userMsg.ID.Hex(),
			"assistant_message_id": assistantMsg.ID.Hex(),
			"credits":              newCredits,
		},
	})
}

func (h *ChatHandler) Stream(c *gin.Context) {
	conversationID := c.Query("conversation_id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	// Set up SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	// Subscribe to the stream
	ch := h.streamManager.Subscribe(conversationID)
	defer h.streamManager.Unsubscribe(conversationID, ch)

	// Stream events
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
