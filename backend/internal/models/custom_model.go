package models

import "time"

// CustomModelConfig stores one server-side custom model configuration per user.
// APIKeyCiphertext is never serialized to clients.
type CustomModelConfig struct {
	UserID           string     `json:"-" gorm:"primaryKey;type:varchar(24)"`
	Enabled          bool       `json:"enabled" gorm:"not null;default:false"`
	BaseURL          string     `json:"base_url" gorm:"type:varchar(512)"`
	APIKeyCiphertext string     `json:"-" gorm:"type:text"`
	Model            string     `json:"model" gorm:"type:varchar(255)"`
	DailyEnabled     bool       `json:"daily_enabled" gorm:"not null;default:false"`
	ExpertEnabled    bool       `json:"expert_enabled" gorm:"not null;default:false"`
	SearchEnabled    bool       `json:"search_enabled" gorm:"not null;default:false"`
	ResponseMode     string     `json:"response_mode" gorm:"type:varchar(20)"` // stream | non_stream
	LastTestedAt     *time.Time `json:"last_tested_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt        time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}
