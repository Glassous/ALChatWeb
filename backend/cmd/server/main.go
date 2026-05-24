package main

import (
	"alchat-backend/internal/agent"
	"alchat-backend/internal/agent/tools"
	"alchat-backend/internal/config"
	"alchat-backend/internal/database"
	"alchat-backend/internal/handlers"
	"alchat-backend/internal/middleware"
	"alchat-backend/internal/services"
	"context"
	"log"
	"log/slog"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Set Gin mode
	gin.SetMode(cfg.GinMode)

	// Initialize structured logger
	var handler slog.Handler
	if cfg.GinMode == gin.ReleaseMode {
		handler = slog.NewJSONHandler(os.Stdout, nil)
	} else {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	}
	logger := slog.New(handler)
	slog.SetDefault(logger)

	slog.Info("Starting AL Chat Web Backend", "mode", cfg.GinMode, "port", cfg.Port)

	// Validate configuration
	if cfg.OpenAIAPIKey == "" || cfg.OpenAIAPIKey == "your-api-key-here" {
		slog.Error("OPENAI_API_KEY is not set. Please set it in backend/.env file")
		os.Exit(1)
	}

	// Connect to MongoDB
	db, err := database.NewMongoDB(cfg.MongoDBURI, cfg.MongoDBDatabase)
	if err != nil {
		slog.Error("Failed to connect to MongoDB", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Connect to Redis
	rdb, err := database.NewRedis(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		slog.Error("Failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	// Initialize services
	aiService, err := services.NewAIService(
		cfg.OpenAIAPIKey,
		cfg.OpenAIBaseURL,
		cfg.OpenAIModel,
		cfg.ExpertAPIKey,
		cfg.ExpertBaseURL,
		cfg.ExpertModel,
		cfg.TitleAIAPIKey,
		cfg.TitleAIBaseURL,
		cfg.TitleAIModel,
		cfg.SearchAPIKey,
		cfg.SearchBaseURL,
		cfg.SearchModel,
		cfg.BochaAPIKey,
		cfg.MultimodalAPIKey,
		cfg.MultimodalBaseURL,
		cfg.MultimodalModel,
		cfg.AgentAPIKey,
		cfg.AgentBaseURL,
		cfg.AgentModel,
		cfg.ALingAPIKey,
		cfg.ALingBaseURL,
		cfg.ALingModel,
	)
	if err != nil {
		log.Fatalf("Failed to initialize AI service: %v", err)
	}

	conversationService := services.NewConversationService(db, rdb)
	ossService, err := services.NewOSSService(cfg)
	if err != nil {
		log.Printf("Warning: Failed to initialize OSS service: %v. Avatar upload will be disabled.", err)
	}

	memberService := services.NewMemberService(db)
	memberService.StartExpiryChecker(context.Background())
	tokenService := services.NewTokenService(cfg.JWTSecret)
	emailService := services.NewEmailService(cfg)
	streamManager := services.NewStreamManager()
	tempConvService := services.NewTempConversationService(rdb)

	shareService := services.NewShareService(db)

	imageService, err := services.NewImageService(cfg.VolcengineAPIKey, cfg.VolcengineImageEP, ossService)
	if err != nil {
		log.Printf("Warning: Failed to initialize Image service: %v. Image generation will be disabled.", err)
	}

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(db, rdb, cfg.JWTSecret, ossService, memberService, tokenService, emailService)
	conversationHandler := handlers.NewConversationHandler(conversationService, aiService)
	conversationHandler.SetTempConversationService(tempConvService)
	chatHandler := handlers.NewChatHandler(aiService, conversationService, memberService, db, streamManager, imageService)
	chatHandler.SetTempConversationService(tempConvService)
	imageHandler := handlers.NewImageHandler(imageService, conversationService, ossService, aiService, streamManager, memberService, db)
	adminHandler := handlers.NewAdminHandler(db, rdb, aiService, memberService, tokenService, emailService)
	locationHandler := handlers.NewLocationHandler()
	shareHandler := handlers.NewShareHandler(shareService)

	alingService := services.NewALingService(db, aiService, streamManager, memberService, ossService)
	alingHandler := handlers.NewALingHandler(alingService, streamManager, memberService, db)

	adminHandler.SetupAdmin(context.Background())
	adminHandler.LoadConfigs(context.Background())

	registry := tools.NewRegistry()
	registry.Register("web_search", tools.WebSearchDescription, tools.NewWebSearchFn(cfg.BochaAPIKey))
	registry.Register("weather", tools.WeatherDescription, tools.WeatherFn)
	registry.Register("calculator", tools.CalculatorDescription, tools.CalculatorFn)
	registry.Register("get_time", tools.GetTimeDescription, tools.GetTimeFn)
	registry.Register("generate_image", tools.GenerateImageDescription, tools.GenerateImageDummyFn)

	agentAPIKey, agentBaseURL, agentModel := aiService.GetAgentConfig()
	agentRunner := agent.NewRunner(agentAPIKey, agentBaseURL, agentModel, registry, db)
	agentRunner.LoadToolStates(context.Background())
	adminHandler.SetAgentRunner(agentRunner)
	chatHandler.SetAgentRunner(agentRunner)

	// Setup Gin router
	router := gin.Default()
	router.Use(middleware.CORS(cfg.AllowOrigins))

	// API routes
	api := router.Group("/api")
	{
		// Public routes
		auth := api.Group("/auth")
		auth.Use(middleware.RateLimiter(rdb, 5, time.Minute))
		{
			auth.POST("/send-code", authHandler.SendCode)
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			auth.POST("/reset-password", authHandler.ResetPassword)
		}

		// Announcements (public)
		api.GET("/announcements", adminHandler.PublicListActiveAnnouncements)

		// Feedback (public submit, with basic rate limit)
		feedbackGroup := api.Group("/feedback")
		feedbackGroup.Use(middleware.RateLimiter(rdb, 5, time.Minute))
		{
			feedbackGroup.POST("", adminHandler.PublicSubmitFeedback)
		}

		// Protected routes
		protected := api.Group("/")
		protected.Use(middleware.AuthMiddleware(tokenService, rdb))
		{
			// Auth protected routes
			protected.POST("/auth/logout", authHandler.Logout)
			protected.GET("/auth/profile", authHandler.GetProfile)
			protected.PUT("/auth/profile", authHandler.UpdateProfile)
			protected.POST("/auth/avatar", authHandler.UpdateAvatar)
			protected.GET("/auth/system-prompt", authHandler.GetSystemPrompt)
			protected.PUT("/auth/system-prompt", authHandler.UpdateSystemPrompt)
			protected.PUT("/auth/theme", authHandler.UpdateTheme)
			protected.POST("/auth/upgrade", authHandler.Upgrade)

			// Conversation routes
			protected.GET("/conversations", conversationHandler.GetAllConversations)
			protected.POST("/conversations", conversationHandler.CreateConversation)
			protected.GET("/conversations/temp/:id", conversationHandler.GetTempConversation)
			protected.POST("/conversations/temp/:id/promote", conversationHandler.PromoteTempConversation)
			protected.DELETE("/conversations/temp/:id", conversationHandler.DeleteTempConversation)
			protected.GET("/conversations/:id", conversationHandler.GetConversation)
			protected.PUT("/conversations/:id/title", conversationHandler.UpdateConversationTitle)
			protected.POST("/conversations/:id/generate-title", conversationHandler.GenerateTitle)
			protected.DELETE("/conversations/:id", conversationHandler.DeleteConversation)
			protected.DELETE("/conversations/:id/messages/after/:messageId", conversationHandler.DeleteMessagesAfter)

			// Chat route
			chat := protected.Group("/chat")
			chat.Use(middleware.RateLimiter(rdb, 10, time.Minute))
			{
				chat.POST("", chatHandler.Chat)
				chat.GET("/stream", chatHandler.Stream)
				chat.POST("/image", imageHandler.GenerateImage)
			}

			protected.POST("/chat/upload-reference", imageHandler.UploadReferenceImage)
			protected.DELETE("/chat/reference-image", imageHandler.DeleteReferenceImage)

			// Location route
			protected.POST("/location/resolve", locationHandler.Resolve)

			// Share routes
			protected.POST("/conversations/:id/share", shareHandler.CreateShare)
			protected.GET("/my/shared", shareHandler.GetMyShares)
			protected.DELETE("/shared/:token", shareHandler.DeleteShare)
			protected.POST("/shared/:token/save", shareHandler.SaveSharedConversation)

			// ALing routes
			aling := protected.Group("/aling")
			{
				aling.GET("/tools", alingHandler.GetTools)
				aling.GET("/translator/languages", alingHandler.GetTranslatorLanguages)
				aling.POST("/translator/languages", alingHandler.AddTranslatorLanguage)
				aling.DELETE("/translator/languages", alingHandler.DeleteTranslatorLanguage)
				aling.POST("/translator/languages/reset", alingHandler.ResetTranslatorLanguages)
				aling.POST("/translator/translate", alingHandler.TranslateText)
				aling.GET("/translator/history", alingHandler.GetTranslationHistory)
				aling.DELETE("/translator/history/:id", alingHandler.DeleteTranslationHistory)
			}

			// Admin routes
			admin := protected.Group("/admin")
			admin.Use(middleware.AdminMiddleware())
			{
				admin.GET("/dashboard", adminHandler.GetDashboardStats)
				admin.GET("/users", adminHandler.GetUsers)
				admin.GET("/users/:id", adminHandler.GetUser)
				admin.PUT("/users/:id/role", adminHandler.UpdateUserRole)
				admin.PUT("/users/:id/credits", adminHandler.UpdateUserCredits)
				admin.PUT("/users/:id/member-type", adminHandler.UpdateUserMemberType)
				admin.PUT("/users/:id/member", adminHandler.UpdateUserMember)
				admin.DELETE("/users/:id", adminHandler.DeleteUser)
				admin.GET("/conversations", adminHandler.GetConversations)
				admin.GET("/conversations/:id", adminHandler.GetConversation)
				admin.DELETE("/conversations/:id", adminHandler.DeleteConversation)
				admin.GET("/messages/search", adminHandler.SearchMessages)
				admin.GET("/configs", adminHandler.GetModelConfigs)
				admin.PUT("/configs", adminHandler.UpdateModelConfig)
				admin.GET("/invitation-codes", adminHandler.GetInvitationCodes)
				admin.POST("/invitation-codes", adminHandler.GenerateInvitationCodes)
				admin.GET("/settings", adminHandler.GetSystemSettings)
				admin.PUT("/settings", adminHandler.UpdateSystemSettings)
				admin.GET("/agent/tools", adminHandler.GetAgentTools)
				admin.PUT("/agent/tools/:name", adminHandler.ToggleAgentTool)
				admin.GET("/shared", shareHandler.GetAllShares)
				admin.DELETE("/shared/:id", shareHandler.AdminDeleteShare)

				// Announcements (admin)
				admin.GET("/announcements", adminHandler.ListAnnouncements)
				admin.POST("/announcements", adminHandler.CreateAnnouncement)
				admin.PUT("/announcements/:id", adminHandler.UpdateAnnouncement)
				admin.DELETE("/announcements/:id", adminHandler.DeleteAnnouncement)

				// Feedbacks (admin)
				admin.GET("/feedbacks", adminHandler.ListFeedbacks)
				admin.POST("/feedbacks/:id/reply", adminHandler.ReplyFeedback)
				admin.PUT("/feedbacks/:id/status", adminHandler.UpdateFeedbackStatus)
				admin.DELETE("/feedbacks/:id", adminHandler.DeleteFeedback)
			}

			// Public admin register (protected by code verification, but allows creating first admin)
			api.POST("/admin/register", adminHandler.AdminRegister)
		}
	}

	// Health check with database pings
	router.GET("/health", func(c *gin.Context) {
		status := "ok"
		mongoStatus := "ok"
		redisStatus := "ok"

		// Ping MongoDB
		if err := db.Client.Ping(c.Request.Context(), nil); err != nil {
			mongoStatus = "error"
			status = "partial_outage"
		}

		// Ping Redis
		if err := rdb.Client.Ping(c.Request.Context()).Err(); err != nil {
			redisStatus = "error"
			status = "partial_outage"
		}

		c.JSON(200, gin.H{
			"status":   status,
			"mongodb":  mongoStatus,
			"redis":    redisStatus,
			"version":  "1.0.0",
			"gin_mode": cfg.GinMode,
		})
	})

	// Public shared conversation route (no auth required)
	router.GET("/api/shared/:token", shareHandler.GetSharedConversation)

	// Start server
	slog.Info("Server is ready", "port", cfg.Port, "model", cfg.OpenAIModel)
	if err := router.Run(":" + cfg.Port); err != nil {
		slog.Error("Failed to start server", "error", err)
		os.Exit(1)
	}
}
