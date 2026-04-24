package config

import (
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port               string
	MongoDBURI         string
	MongoDBDatabase    string
	OpenAIAPIKey       string
	OpenAIBaseURL      string
	OpenAIModel        string
	ExpertAPIKey       string
	ExpertBaseURL      string
	ExpertModel        string
	JWTSecret          string
	TitleAIModel       string
	TitleAIBaseURL     string
	TitleAIAPIKey      string
	OSSEndpoint        string
	OSSAccessKeyID     string
	OSSAccessKeySecret string
	OSSBucketName      string
	VolcengineAPIKey   string
	VolcengineImageEP  string
	BochaAPIKey        string
	SearchAPIKey       string
	SearchBaseURL      string
	SearchModel        string
}

func Load() *Config {
	// Try to load .env from the current directory or parent directories
	// Use Overload instead of Load to ensure .env overrides system environment variables
	err := godotenv.Overload()
	if err != nil {
		// Try loading from a specific path if default fails
		_ = godotenv.Overload("../.env")
		_ = godotenv.Overload("../../.env")
	}

	cfg := &Config{
		Port:               getEnv("PORT", "8080"),
		MongoDBURI:         getEnv("MONGODB_URI", "mongodb://localhost:27017"),
		MongoDBDatabase:    getEnv("MONGODB_DATABASE", "alchat"),
		OpenAIAPIKey:       getEnv("OPENAI_API_KEY", ""),
		OpenAIBaseURL:      getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		OpenAIModel:        getEnv("OPENAI_MODEL", "gpt-3.5-turbo"),
		ExpertAPIKey:       getEnv("EXPERT_API_KEY", ""),
		ExpertBaseURL:      getEnv("EXPERT_BASE_URL", "https://api.openai.com/v1"),
		ExpertModel:        getEnv("EXPERT_MODEL", "gpt-4"),
		JWTSecret:          getEnv("JWT_SECRET", "your-secret-key"),
		TitleAIModel:       getEnv("TITLE_AI_MODEL", ""),
		TitleAIBaseURL:     getEnv("TITLE_AI_BASE_URL", ""),
		TitleAIAPIKey:      getEnv("TITLE_AI_API_KEY", ""),
		OSSEndpoint:        getEnv("OSS_ENDPOINT", ""),
		OSSAccessKeyID:     getEnv("OSS_ACCESS_KEY_ID", ""),
		OSSAccessKeySecret: getEnv("OSS_ACCESS_KEY_SECRET", ""),
		OSSBucketName:      getEnv("OSS_BUCKET_NAME", ""),
		VolcengineAPIKey:   getEnv("VOLCENGINE_API_KEY", ""),
		VolcengineImageEP:  getEnv("VOLCENGINE_IMAGE_EP", ""),
		BochaAPIKey:        getEnv("BOCHA_API_KEY", ""),
		SearchAPIKey:       getEnv("SEARCH_API_KEY", ""),
		SearchBaseURL:      getEnv("SEARCH_BASE_URL", "https://api.openai.com/v1"),
		SearchModel:        getEnv("SEARCH_MODEL", "gpt-4"),
	}

	// Enhanced Debug Logging for OSS
	if cfg.OSSAccessKeyID != "" {
		idLen := len(cfg.OSSAccessKeyID)
		secretLen := len(cfg.OSSAccessKeySecret)
		maskID := ""
		if idLen > 8 {
			maskID = cfg.OSSAccessKeyID[:4] + "****" + cfg.OSSAccessKeyID[idLen-4:]
		} else {
			maskID = "****"
		}
		log.Printf("[Config] OSS Loaded - ID: %s (len:%d), Secret Len: %d, Endpoint: %s",
			maskID, idLen, secretLen, cfg.OSSEndpoint)
	} else {
		log.Println("[Config] WARNING: OSS_ACCESS_KEY_ID is empty!")
	}

	return cfg
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return strings.TrimSpace(value)
	}
	return defaultValue
}
