package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port            string
	MongoDBURI      string
	MongoDBDatabase string
	OpenAIAPIKey    string
	OpenAIBaseURL   string
	OpenAIModel     string
	JWTSecret       string
	TitleAIModel    string
	TitleAIBaseURL  string
	TitleAIAPIKey   string
}

func Load() *Config {
	// Load .env file if it exists
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	return &Config{
		Port:            getEnv("PORT", "8080"),
		MongoDBURI:      getEnv("MONGODB_URI", "mongodb://localhost:27017"),
		MongoDBDatabase: getEnv("MONGODB_DATABASE", "alchat"),
		OpenAIAPIKey:    getEnv("OPENAI_API_KEY", ""),
		OpenAIBaseURL:   getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		OpenAIModel:     getEnv("OPENAI_MODEL", "gpt-3.5-turbo"),
		JWTSecret:       getEnv("JWT_SECRET", "default_jwt_secret_change_in_production"),
		TitleAIModel:    getEnv("TITLE_AI_MODEL", getEnv("OPENAI_MODEL", "gpt-3.5-turbo")),
		TitleAIBaseURL:  getEnv("TITLE_AI_BASE_URL", getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1")),
		TitleAIAPIKey:   getEnv("TITLE_AI_API_KEY", getEnv("OPENAI_API_KEY", "")),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
