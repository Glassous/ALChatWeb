package models

import "time"

type ModelConfig struct {
	Mode      string    `bson:"mode" json:"mode"` // daily, expert, search, multimodal, title
	BaseURL   string    `bson:"base_url" json:"base_url"`
	APIKey    string    `bson:"api_key" json:"api_key"`
	Model     string    `bson:"model" json:"model"`
	IsActive  bool      `bson:"is_active" json:"is_active"`
	UpdatedAt time.Time `bson:"updated_at" json:"updated_at"`
}

type SystemStats struct {
	TotalUsers         int64 `json:"total_users"`
	TodayNewUsers      int64 `json:"today_new_users"`
	TotalConversations int64 `json:"total_conversations"`
	TodayActiveConvs   int64 `json:"today_active_convs"`
	TotalMessages      int64 `json:"total_messages"`
	TodayNewMessages   int64 `json:"today_new_messages"`
}
