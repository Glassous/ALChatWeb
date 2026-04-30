package main

import (
	"alchat-backend/internal/config"
	"alchat-backend/internal/database"
	"alchat-backend/internal/handlers"
	"alchat-backend/internal/middleware"
	"alchat-backend/internal/services"
	"context"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Validate configuration
	if cfg.OpenAIAPIKey == "" || cfg.OpenAIAPIKey == "your-api-key-here" {
		log.Fatal("OPENAI_API_KEY is not set. Please set it in backend/.env file")
	}

	// Connect to MongoDB
	db, err := database.NewMongoDB(cfg.MongoDBURI, cfg.MongoDBDatabase)
	if err != nil {
		log.Fatalf("Failed to connect to MongoDB: %v", err)
	}
	defer db.Close()

	// Connect to Redis
	rdb, err := database.NewRedis(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
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
	streamManager := services.NewStreamManager()

	imageService, err := services.NewImageService(cfg.VolcengineAPIKey, cfg.VolcengineImageEP, ossService)
	if err != nil {
		log.Printf("Warning: Failed to initialize Image service: %v. Image generation will be disabled.", err)
	}

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(db, cfg.JWTSecret, ossService, memberService)
	conversationHandler := handlers.NewConversationHandler(conversationService, aiService)
	chatHandler := handlers.NewChatHandler(aiService, conversationService, memberService, db, streamManager)
	imageHandler := handlers.NewImageHandler(imageService, conversationService, ossService, aiService, streamManager)
	adminHandler := handlers.NewAdminHandler(db, aiService)
	adminHandler.SetupAdmin(context.Background())
	adminHandler.LoadConfigs(context.Background())

	// Setup Gin router
	router := gin.Default()
	router.Use(middleware.CORS())

	// API routes
	api := router.Group("/api")
	{
		// Public routes
		auth := api.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			auth.POST("/reset-password", authHandler.ResetPassword)
			auth.GET("/security-question", authHandler.GetSecurityQuestion)
		}

		// Protected routes
		protected := api.Group("/")
		protected.Use(middleware.AuthMiddleware(cfg.JWTSecret))
		{
			// Auth protected routes
			protected.GET("/auth/profile", authHandler.GetProfile)
			protected.PUT("/auth/profile", authHandler.UpdateProfile)
			protected.POST("/auth/avatar", authHandler.UpdateAvatar)
			protected.GET("/auth/system-prompt", authHandler.GetSystemPrompt)
			protected.PUT("/auth/system-prompt", authHandler.UpdateSystemPrompt)
			protected.POST("/auth/upgrade", authHandler.Upgrade)

			// Conversation routes
			protected.GET("/conversations", conversationHandler.GetAllConversations)
			protected.POST("/conversations", conversationHandler.CreateConversation)
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
			}
		}
	}

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server
	log.Printf("Server starting on port %s", cfg.Port)
	log.Printf("Using model: %s", cfg.OpenAIModel)
	log.Printf("API Base URL: %s", cfg.OpenAIBaseURL)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
