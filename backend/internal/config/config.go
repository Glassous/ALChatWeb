package config

import (
	"log"
	"os"
	"strconv"
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
	SMTPHost           string
	SMTPPort           int
	SMTPUser           string
	SMTPPass           string
	SMTPFrom           string
	TitleAIModel       string
	TitleAIBaseURL     string
	TitleAIAPIKey      string
	COSSecretID     string
	COSSecretKey    string
	COSBucket       string
	COSRegion       string
	COSCustomDomain string
	VolcengineAPIKey   string
	VolcengineImageEP  string
	BochaAPIKey        string
	TavilyAPIKey       string
	SearchAPIKey       string
	SearchBaseURL      string
	SearchModel        string
	MultimodalAPIKey   string
	MultimodalBaseURL  string
	MultimodalModel    string
	AgentAPIKey        string
	AgentBaseURL       string
	AgentModel         string
	ALingAPIKey        string
	ALingBaseURL       string
	ALingModel         string
	RedisAddr          string
	RedisPassword      string
	RedisDB            int
	AllowOrigins       []string
	GinMode            string
	MySQLDSN           string
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
		MongoDBDatabase:    getEnv("MONGODB_DATABASE", getEnv("MONGODB_DB", "alchat")),
		OpenAIAPIKey:       getEnv("OPENAI_API_KEY", ""),
		OpenAIBaseURL:      getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		OpenAIModel:        getEnv("OPENAI_MODEL", "gpt-3.5-turbo"),
		ExpertAPIKey:       getEnv("EXPERT_API_KEY", ""),
		ExpertBaseURL:      getEnv("EXPERT_BASE_URL", "https://api.openai.com/v1"),
		ExpertModel:        getEnv("EXPERT_MODEL", "gpt-4"),
		JWTSecret:          getEnv("JWT_SECRET", "your-secret-key"),
		SMTPHost:           getEnv("SMTP_HOST", "smtp.office365.com"),
		SMTPPort:           getEnvInt("SMTP_PORT", 587),
		SMTPUser:           getEnv("SMTP_USER", ""),
		SMTPPass:           getEnv("SMTP_PASS", ""),
		SMTPFrom:           getEnv("SMTP_FROM", ""),
		TitleAIModel:       getEnv("TITLE_AI_MODEL", ""),
		TitleAIBaseURL:     getEnv("TITLE_AI_BASE_URL", ""),
		TitleAIAPIKey:      getEnv("TITLE_AI_API_KEY", ""),
		COSSecretID:     getEnv("COS_SECRET_ID", ""),
		COSSecretKey:    getEnv("COS_SECRET_KEY", ""),
		COSBucket:       getEnv("COS_BUCKET", ""),
		COSRegion:       getEnv("COS_REGION", ""),
		COSCustomDomain: getEnv("COS_CUSTOM_DOMAIN", ""),
		VolcengineAPIKey:   getEnv("VOLCENGINE_API_KEY", ""),
		VolcengineImageEP:  getEnv("VOLCENGINE_IMAGE_EP", ""),
		BochaAPIKey:        getEnv("BOCHA_API_KEY", ""),
		TavilyAPIKey:       getEnv("TAVILY_API_KEY", ""),
		SearchAPIKey:       getEnv("SEARCH_API_KEY", ""),
		SearchBaseURL:      getEnv("SEARCH_BASE_URL", "https://api.openai.com/v1"),
		SearchModel:        getEnv("SEARCH_MODEL", "gpt-4"),
		MultimodalAPIKey:   getEnv("MULTIMODAL_API_KEY", ""),
		MultimodalBaseURL:  getEnv("MULTIMODAL_BASE_URL", "https://api.openai.com/v1"),
		MultimodalModel:    getEnv("MULTIMODAL_MODEL", "gpt-4o"),
		AgentAPIKey:        getEnv("AGENT_API_KEY", ""),
		AgentBaseURL:       getEnv("AGENT_BASE_URL", "https://api.openai.com/v1"),
		AgentModel:         getEnv("AGENT_MODEL", "gpt-4o"),
		ALingAPIKey:        getEnv("ALING_API_KEY", ""),
		ALingBaseURL:       getEnv("ALING_BASE_URL", "https://api.openai.com/v1"),
		ALingModel:         getEnv("ALING_MODEL", "gpt-4o"),
		RedisAddr:          getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:      getEnv("REDIS_PASSWORD", ""),
		RedisDB:            getEnvInt("REDIS_DB", 0),
		AllowOrigins:       getEnvSlice("ALLOW_ORIGINS", []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:3000", "http://localhost:3001"}),
		GinMode:            getEnv("GIN_MODE", "debug"),
		MySQLDSN:           getEnv("MYSQL_DSN", ""),
	}

	// Enhanced Debug Logging for OSS
	if cfg.COSSecretID != "" {
		idLen := len(cfg.COSSecretID)
		secretLen := len(cfg.COSSecretKey)
		maskID := ""
		if idLen > 8 {
			maskID = cfg.COSSecretID[:4] + "****" + cfg.COSSecretID[idLen-4:]
		} else {
			maskID = "****"
		}
		log.Printf("[Config] COS Loaded - ID: %s (len:%d), Secret Len: %d, Bucket: %s, Region: %s, CustomDomain: %s",
			maskID, idLen, secretLen, cfg.COSBucket, cfg.COSRegion, cfg.COSCustomDomain)
	} else {
		log.Println("[Config] WARNING: COS_SECRET_ID is empty!")
	}

	return cfg
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return strings.TrimSpace(value)
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(valueStr)
	if err != nil {
		return defaultValue
	}
	return value
}

func getEnvSlice(key string, defaultValue []string) []string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	parts := strings.Split(value, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}
