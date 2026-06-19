package models

import "time"

type ModelConfig struct {
	Mode      string    `bson:"mode" json:"mode" gorm:"primaryKey;type:varchar(50)"` // daily, expert, search, multimodal, title, agent, aling
	BaseURL   string    `bson:"base_url" json:"base_url" gorm:"type:varchar(255)"`
	APIKey    string    `bson:"api_key" json:"api_key" gorm:"type:varchar(255)"`
	Model     string    `bson:"model" json:"model" gorm:"type:varchar(255)"`
	IsActive  bool      `bson:"is_active" json:"is_active" gorm:"type:boolean"`
	UpdatedAt time.Time `bson:"updated_at" json:"updated_at" gorm:"autoUpdateTime"`
}

type SystemStats struct {
	TotalUsers         int64 `json:"total_users"`
	TodayNewUsers      int64 `json:"today_new_users"`
	TotalConversations int64 `json:"total_conversations"`
	TodayActiveConvs   int64 `json:"today_active_convs"`
	TotalMessages      int64 `json:"total_messages"`
	TodayNewMessages   int64 `json:"today_new_messages"`
}
