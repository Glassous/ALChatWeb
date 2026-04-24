package main

import (
	"alchat-backend/internal/config"
	"alchat-backend/internal/database"
	"alchat-backend/internal/handlers"
	"alchat-backend/internal/middleware"
	"alchat-backend/internal/services"
	"log"

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

	// Initialize services
	aiService, err := services.NewAIService(cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel)
	if err != nil {
		log.Fatalf("Failed to initialize AI service: %v", err)
	}

	conversationService := services.NewConversationService(db)

	// Initialize handlers
	conversationHandler := handlers.NewConversationHandler(conversationService)
	chatHandler := handlers.NewChatHandler(aiService, conversationService)

	// Setup Gin router
	router := gin.Default()
	router.Use(middleware.CORS())

	// API routes
	api := router.Group("/api")
	{
		// Conversation routes
		api.GET("/conversations", conversationHandler.GetAllConversations)
		api.POST("/conversations", conversationHandler.CreateConversation)
		api.GET("/conversations/:id", conversationHandler.GetConversation)
		api.PUT("/conversations/:id/title", conversationHandler.UpdateConversationTitle)
		api.DELETE("/conversations/:id", conversationHandler.DeleteConversation)

		// Chat route
		api.POST("/chat", chatHandler.Chat)
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
