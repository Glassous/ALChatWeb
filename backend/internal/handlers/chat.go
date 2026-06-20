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
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ChatHandler struct {
	aiService           *services.AIService
	conversationService *services.ConversationService
	memberService       *services.MemberService
	db                  *database.MongoDB
	mysqlDB             *database.MySQL
	streamManager       *services.StreamManager
	tempConvService     *services.TempConversationService
	imageService        *services.ImageService
	agentRunner         interface {
		Run(ctx context.Context, messages []models.AIMessage, callback agent.StepCallback) (*agent.AgentResult, error)
		RunWithStreaming(ctx context.Context, messages []models.AIMessage, stepCb agent.StepCallback, tokenCb func(string), reasoningCb func(string)) (*agent.AgentResult, error)
		RunDailyRouter(ctx context.Context, messages []models.AIMessage, cfg agent.DailyRouterConfig, stepCb agent.StepCallback, tokenCb func(string), reasoningCb func(string), searchCb func(query string, source string) (string, error)) (*agent.AgentResult, error)
	}
}

func NewChatHandler(aiService *services.AIService, conversationService *services.ConversationService, memberService *services.MemberService, db *database.MongoDB, mysqlDB *database.MySQL, streamManager *services.StreamManager, imageService *services.ImageService) *ChatHandler {
	return &ChatHandler{
		aiService:           aiService,
		conversationService: conversationService,
		memberService:       memberService,
		db:                  db,
		mysqlDB:             mysqlDB,
		streamManager:       streamManager,
		imageService:        imageService,
	}
}

func (h *ChatHandler) SetAgentRunner(runner interface {
	Run(ctx context.Context, messages []models.AIMessage, callback agent.StepCallback) (*agent.AgentResult, error)
	RunWithStreaming(ctx context.Context, messages []models.AIMessage, stepCb agent.StepCallback, tokenCb func(string), reasoningCb func(string)) (*agent.AgentResult, error)
	RunDailyRouter(ctx context.Context, messages []models.AIMessage, cfg agent.DailyRouterConfig, stepCb agent.StepCallback, tokenCb func(string), reasoningCb func(string), searchCb func(query string, source string) (string, error)) (*agent.AgentResult, error)
}) {
	h.agentRunner = runner
}

func (h *ChatHandler) SetTempConversationService(service *services.TempConversationService) {
	h.tempConvService = service
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
	err := h.mysqlDB.DB.WithContext(c.Request.Context()).Where("id = ?", userIDObj.Hex()).First(&user).Error
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

	// Temporary conversation routing
	if utils.IsTempID(req.ConversationID) {
		h.handleTempChat(c, req, userIDObj)
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

		// Convert to AIMessage format
		aiMessages := make([]models.AIMessage, len(messages))
		for i, msg := range messages {
			aiMessages[i] = models.AIMessage{
				Role:    msg.Role,
				Content: msg.Content,
			}
		}

		// Clean history context for daily model (to avoid XML/JSON tag interference)
		if req.Mode == "daily" {
			reSearch := regexp.MustCompile(`(?s)\n?<search>.*?</search>\n?`)
			reWeather := regexp.MustCompile(`(?s)\n?<weather>.*?</weather>\n?`)
			reImage := regexp.MustCompile(`(?i)<image src="([^"]+)">`)
			for i, m := range aiMessages {
				if m.Role == "assistant" {
					cleaned := reSearch.ReplaceAllString(m.Content, "")
					cleaned = reWeather.ReplaceAllString(cleaned, "")
					cleaned = reImage.ReplaceAllString(cleaned, "![image]($1)")
					cleaned = strings.TrimSpace(cleaned)
					if cleaned == "" {
						cleaned = "[已为您完成]"
					}
					aiMessages[i].Content = cleaned
				}
			}
		}

		// Check if any message contains multimodal content (<file> or <image> tags)
		hasMultimodal := false
		for _, m := range aiMessages {
			if strings.Contains(m.Content, "<file") || strings.Contains(m.Content, "<image") {
				hasMultimodal = true
				break
			}
		}

		userIDObj, _ := primitive.ObjectIDFromHex(userID)

		effectiveMode := req.Mode
		if !hasMultimodal && req.Mode == "daily" {
			needSearch, source, err := h.determineIfSearchNeeded(bgCtx, aiMessages)
			if err != nil {
				log.Printf("[Router] Failed to determine if search is needed: %v", err)
			}
			if needSearch {
				effectiveMode = "search_" + source
			}
		}

		if effectiveMode == "agent" {
			h.handleAgentMode(bgCtx, req, aiMessages, assistantMsg, userIDObj, userMsg)
			return
		}

		// Get user settings for system prompt
		var user models.User
		h.mysqlDB.DB.WithContext(bgCtx).Where("id = ?", userIDObj.Hex()).First(&user)

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
			aiMessages,
			effectiveMode,
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

func (h *ChatHandler) handleAgentMode(ctx context.Context, req models.ChatRequest, aiMessages []models.AIMessage, assistantMsg *models.Message, userIDObj primitive.ObjectID, userMsg *models.Message) {
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

	time.AfterFunc(10*time.Second, func() {
		h.streamManager.CloseConversation(req.ConversationID)
	})
}

func (h *ChatHandler) handleDailyAutoRoute(ctx context.Context, req models.ChatRequest, aiMessages []models.AIMessage, assistantMsg *models.Message, userIDObj primitive.ObjectID, userMsg *models.Message) {
	log.Printf("[Router] Starting daily auto-route for conversation %s", req.ConversationID)

	dailyAPIKey, dailyBaseURL, dailyModel := h.aiService.GetDailyConfig()
	agentAPIKey, agentBaseURL, agentModel := h.aiService.GetAgentConfig()

	cfg := agent.DailyRouterConfig{
		DailyAPIKey:  dailyAPIKey,
		DailyBaseURL: dailyBaseURL,
		DailyModel:   dailyModel,
		AgentAPIKey:  agentAPIKey,
		AgentBaseURL: agentBaseURL,
		AgentModel:   agentModel,
		ImageSvc:     h.imageService,
		ImageGenStartCb: func(resolution string) {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "image_gen_start",
				Content: resolution,
			})
		},
	}

	var allSteps []models.AgentStepData
	var accumulatedReasoning string
	var accumulatedAnswer string
	startSent := false
	agentStartSent := false
	textSent := false
	var lastSearchData *models.SearchData

	// Get user settings for system prompt
	var user models.User
	h.mysqlDB.DB.WithContext(ctx).Where("id = ?", userIDObj.Hex()).First(&user)

	// Construct system prompt and inject it to the beginning of the context
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

	if systemPromptBuilder.Len() > 0 {
		aiMessages = append([]models.AIMessage{
			{
				Role:    "system",
				Content: systemPromptBuilder.String(),
			},
		}, aiMessages...)
	}

	tCb := func(token string) {
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
	}

	rCb := func(reasoningChunk string) {
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
	}

	stepCb := func(step agent.AgentStep) {
		if !agentStartSent {
			agentStartSent = true
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "agent_start",
			})
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
	}

	searchCb := func(query string, source string) (string, error) {
		results, augmentedQuery, err := h.aiService.PerformSearch(ctx, aiMessages, source, func(searchData models.SearchData) error {
			lastSearchData = &searchData
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type: "search",
				Data: searchData,
			})
			return nil
		})
		if err != nil {
			return "", err
		}

		// Format search results into <search> tag for the stream
		var searchTag strings.Builder
		searchTag.WriteString("\n<search>\n")
		searchData := map[string]any{
			"query":   augmentedQuery,
			"results": results,
			"source":  source,
		}
		searchJSON, _ := json.Marshal(searchData)
		searchTag.Write(searchJSON)
		searchTag.WriteString("\n</search>\n")

		// Send search tag as token to client
		tCb(searchTag.String())

		// Format search results into the searchContext format
		var searchContextBuilder strings.Builder
		searchContextBuilder.WriteString("以下是联网搜索到的相关信息：\n")
		if len(results) > 0 {
			for i, r := range results {
				fmt.Fprintf(&searchContextBuilder, "[%d] 标题: %s\n    链接: %s\n    内容: %s\n\n", i+1, r.Title, r.URL, r.Snippet)
			}
		} else {
			searchContextBuilder.WriteString("未找到相关搜索结果。\n")
		}
		return searchContextBuilder.String(), nil
	}

	agentResult, err := h.agentRunner.RunDailyRouter(
		ctx,
		aiMessages,
		cfg,
		stepCb,
		tCb,
		rCb,
		searchCb,
	)

	if err != nil {
		log.Printf("[Router] RunDailyRouter failed: %v", err)
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

	log.Printf("[Router] Daily routing completed, answer length: %d, reasoning length: %d", len(accumulatedAnswer), len(accumulatedReasoning))

	assistantMsg.Content = cleanTransitionalText(accumulatedAnswer)
	assistantMsg.Reasoning = accumulatedReasoning
	assistantMsg.AgentSteps = allSteps
	assistantMsg.Search = lastSearchData
	h.conversationService.UpdateMessage(ctx, assistantMsg)

	newCredits, _ := h.memberService.DeductCredits(ctx, userIDObj, utils.CountTokens(userMsg.Content), utils.CountTokens(assistantMsg.Content))

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

	time.AfterFunc(10*time.Second, func() {
		h.streamManager.CloseConversation(req.ConversationID)
	})
}

func (h *ChatHandler) handleTempChat(c *gin.Context, req models.ChatRequest, userIDObj primitive.ObjectID) {
	// 1. Ensure temp conversation exists in Redis (metadata)
	_, err := h.tempConvService.GetConversation(c.Request.Context(), req.ConversationID)
	if err != nil {
		// Create it if it doesn't exist
		h.tempConvService.CreateConversation(c.Request.Context(), req.ConversationID, "临时对话")
	}

	// 2. Save user message to Redis
	userMsgID := utils.GenerateTempID("msg_")
	userMsg, err := h.tempConvService.SaveMessage(c.Request.Context(), req.ConversationID, userMsgID, "user", req.Message, req.ParentMessageID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save temporary user message"})
		return
	}

	// 3. Create assistant message placeholder in Redis
	assistantMsgID := utils.GenerateTempID("msg_")
	assistantMsg, err := h.tempConvService.SaveMessage(c.Request.Context(), req.ConversationID, assistantMsgID, "assistant", "", userMsg.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create temporary assistant message placeholder"})
		return
	}

	// Respond immediately
	c.JSON(http.StatusOK, gin.H{
		"user_message_id":      userMsg.ID,
		"assistant_message_id": assistantMsg.ID,
	})

	// Detached context for background processing
	bgCtx := context.WithoutCancel(c.Request.Context())

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[TempChat] Panic in background generation: %v", r)
				h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
					Type:    "error",
					Content: fmt.Sprintf("Internal error: %v", r),
				})
			}
		}()

		// Get conversation history (branch) from Redis
		messages, err := h.tempConvService.GetMessageBranch(bgCtx, req.ConversationID, userMsg.ID)
		if err != nil {
			h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
				Type:    "error",
				Content: "Failed to fetch temporary conversation history",
			})
			return
		}

		// Convert to AIMessage format
		aiMessages := make([]models.AIMessage, len(messages))
		for i, msg := range messages {
			aiMessages[i] = models.AIMessage{
				Role:    msg.Role,
				Content: msg.Content,
			}
		}

		// Clean history context for daily model (to avoid XML/JSON tag interference)
		if req.Mode == "daily" {
			reSearch := regexp.MustCompile(`(?s)\n?<search>.*?</search>\n?`)
			reWeather := regexp.MustCompile(`(?s)\n?<weather>.*?</weather>\n?`)
			reImage := regexp.MustCompile(`(?i)<image src="([^"]+)">`)
			for i, m := range aiMessages {
				if m.Role == "assistant" {
					cleaned := reSearch.ReplaceAllString(m.Content, "")
					cleaned = reWeather.ReplaceAllString(cleaned, "")
					cleaned = reImage.ReplaceAllString(cleaned, "![image]($1)")
					cleaned = strings.TrimSpace(cleaned)
					if cleaned == "" {
						cleaned = "[已为您完成]"
					}
					aiMessages[i].Content = cleaned
				}
			}
		}

		// Re-fetch user to get latest settings (system prompt, etc.)
		var user models.User
		if err := h.mysqlDB.DB.WithContext(bgCtx).Where("id = ?", userIDObj.Hex()).First(&user).Error; err != nil {
			log.Printf("[TempChat] Failed to fetch user: %v", err)
		}

		// Check if any message contains multimodal content (<file> or <image> tags)
		hasMultimodal := false
		for _, m := range aiMessages {
			if strings.Contains(m.Content, "<file") || strings.Contains(m.Content, "<image") {
				hasMultimodal = true
				break
			}
		}

		effectiveMode := req.Mode
		if !hasMultimodal && req.Mode == "daily" {
			needSearch, source, err := h.determineIfSearchNeeded(bgCtx, aiMessages)
			if err != nil {
				log.Printf("[Router] Failed to determine if search is needed for temp chat: %v", err)
			}
			if needSearch {
				effectiveMode = "search_" + source
			}
		}

		// Agent mode not supported for temp chat in this version to keep it simple,
		// but we could easily add it if needed.
		if !hasMultimodal && effectiveMode == "agent" {
			// Converting models.Message for agent mode
			modelAssistantMsg := assistantMsg.ToModel()
			modelUserMsg := userMsg.ToModel()
			h.handleAgentMode(bgCtx, req, aiMessages, &modelAssistantMsg, userIDObj, &modelUserMsg)

			// Update back to TempMessage in Redis
			assistantMsg.Content = modelAssistantMsg.Content
			assistantMsg.Reasoning = modelAssistantMsg.Reasoning
			assistantMsg.AgentSteps = modelAssistantMsg.AgentSteps
			assistantMsg.AgentPlan = modelAssistantMsg.AgentPlan
			h.tempConvService.UpdateMessage(bgCtx, assistantMsg)
			return
		}

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
			aiMessages,
			effectiveMode,
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

		// Update assistant message in Redis
		assistantMsg.Content = fullResponse.String()
		assistantMsg.Reasoning = fullReasoning.String()
		assistantMsg.Search = lastSearchData
		h.tempConvService.UpdateMessage(bgCtx, assistantMsg)

		// Deduct credits
		newCredits, _ := h.memberService.DeductCredits(bgCtx, userIDObj, utils.CountTokens(userMsg.Content)+extraInput, utils.CountTokens(fullResponse.String())+extraOutput)

		// Send done signal
		h.streamManager.Publish(req.ConversationID, models.ChatStreamResponse{
			Type: "done",
			Data: gin.H{
				"user_message_id":      userMsg.ID,
				"assistant_message_id": assistantMsg.ID,
				"credits":              newCredits,
			},
		})

		time.AfterFunc(10*time.Second, func() {
			h.streamManager.CloseConversation(req.ConversationID)
		})
	}()
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

func cleanTransitionalText(content string) string {
	if idx := strings.Index(content, "<image"); idx != -1 {
		return content[idx:]
	}
	if idx := strings.Index(content, "<search>"); idx != -1 {
		return content[idx:]
	}
	if idx := strings.Index(content, "<weather>"); idx != -1 {
		return content[idx:]
	}
	return content
}

func (h *ChatHandler) determineIfSearchNeeded(ctx context.Context, messages []models.AIMessage) (bool, string, error) {
	classifyPrompt := "你是一个极其克制的搜索引擎使用与源选择判断助手。请根据提供的用户对话历史，判断当前用户的问题是否必须通过联网搜索来获取最新实时信息或事实知识。\n" +
		"【判断与选择原则】\n" +
		"1. 尽可能不要搜索！对于常识性问题、技术概念解释、日常闲聊、创意写作、代码编写、翻译、逻辑推理，以及不需要实时新鲜资讯的问题，一律不需要搜索，直接回答。\n" +
		"2. 只有在用户明确查询今天/最近发生的最新实时事件、近期新闻动态、实时天气、极其精确的时效性计算或当前确切系统时间等，且模型已有知识库确实无法覆盖的领域时，才允许搜索。\n" +
		"3. 在必须搜索时，根据语言和内容特征选择搜索源：\n" +
		"   - 如果问题是关于中国国内资讯、中文本土事件或日常中文问答，选择使用 Bocha。输出：'SEARCH_BOCHA'。\n" +
		"   - 如果问题是关于国际新闻、英文资讯、前沿英文技术文档、学术论文或代码相关的全球最新动态，选择使用 Tavily。输出：'SEARCH_TAVILY'。\n" +
		"4. 如果不需要搜索（可以直接回答），输出：'DIRECT'。\n" +
		"请只输出 'SEARCH_BOCHA'、'SEARCH_TAVILY' 或 'DIRECT'，绝对不要包含任何其他字样、标点或 Markdown 格式。"

	var lastMsg string
	if len(messages) > 0 {
		lastMsg = messages[len(messages)-1].Content
	}

	classifyMessages := []models.AIMessage{
		{
			Role:    "system",
			Content: classifyPrompt,
		},
		{
			Role:    "user",
			Content: lastMsg,
		},
	}

	var result strings.Builder
	err := h.aiService.GeneratePlainStream(ctx, classifyMessages, func(token string, reasoning string) error {
		result.WriteString(token)
		return nil
	})
	if err != nil {
		return false, "", err
	}

	trimmed := strings.ToUpper(strings.TrimSpace(result.String()))
	log.Printf("[Router] Search decision result: %s", trimmed)
	if strings.Contains(trimmed, "SEARCH_TAVILY") {
		return true, "tavily", nil
	}
	if strings.Contains(trimmed, "SEARCH_BOCHA") || strings.Contains(trimmed, "SEARCH") {
		return true, "bocha", nil
	}
	return false, "", nil
}
