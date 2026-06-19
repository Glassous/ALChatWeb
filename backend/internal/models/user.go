package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type User struct {
	ID                primitive.ObjectID `bson:"_id,omitempty" json:"id" gorm:"primaryKey;type:varchar(24);serializer:objectid"`
	Email             string             `bson:"email" json:"email" gorm:"uniqueIndex;type:varchar(255);not null"`
	Nickname          string             `bson:"nickname" json:"nickname" gorm:"type:varchar(255)"`
	Password          string             `bson:"password" json:"-" gorm:"type:varchar(255);not null"` // Omit password from JSON
	Avatar            string             `bson:"avatar" json:"avatar" gorm:"type:varchar(255)"`
	Role              string             `bson:"role" json:"role" gorm:"type:varchar(50);default:'user'"` // "user" | "admin"
	SystemPrompt      string             `bson:"system_prompt" json:"system_prompt" gorm:"type:text"`
	IncludeDateTime   bool               `bson:"include_datetime" json:"include_datetime" gorm:"type:boolean"`
	IncludeLocation   bool               `bson:"include_location" json:"include_location" gorm:"type:boolean"`
	MemberType        string             `bson:"member_type" json:"member_type" gorm:"type:varchar(50);default:'free'"` // "free" | "pro" | "max"
	MemberExpiry      *time.Time         `bson:"member_expiry,omitempty" json:"member_expiry,omitempty" gorm:"type:datetime"`
	Credits           float64            `bson:"credits" json:"credits" gorm:"type:decimal(10,2);default:0"`
	LastCreditResetAt time.Time          `bson:"last_credit_reset_at" json:"last_credit_reset_at" gorm:"type:datetime"`
	ThemeConfig       ThemeConfig        `bson:"theme_config" json:"theme_config" gorm:"serializer:json;type:json"`
	CreatedAt         time.Time          `bson:"created_at" json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         time.Time          `bson:"updated_at" json:"updated_at" gorm:"autoUpdateTime"`
}

type ThemeConfig struct {
	Enabled       bool          `bson:"enabled" json:"enabled"`
	CustomPresets []ThemePreset `bson:"custom_presets" json:"custom_presets"`
	Divider       struct {
		Type   string `bson:"type" json:"type"`
		Value  string `bson:"value" json:"value"`
		Preset string `bson:"preset" json:"preset"`
	} `bson:"divider" json:"divider"`
}

type ThemePreset struct {
	ID    string `bson:"id" json:"id"`
	Name  string `bson:"name" json:"name"`
	Value string `bson:"value" json:"value"`
	Type  string `bson:"type" json:"type"`
}

type RegisterRequest struct {
	Email           string `json:"email" binding:"required,email"`
	Nickname        string `json:"nickname"`
	Password        string `json:"password" binding:"required,min=6"`
	ConfirmPassword string `json:"confirm_password" binding:"required,eqfield=Password"`
	Code            string `json:"code" binding:"required,len=6"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type ResetPasswordRequest struct {
	Email           string `json:"email" binding:"required,email"`
	Code            string `json:"code" binding:"required,len=6"`
	NewPassword     string `json:"new_password" binding:"required,min=6"`
	ConfirmPassword string `json:"confirm_password" binding:"required,eqfield=NewPassword"`
}

type SendCodeRequest struct {
	Email string `json:"email" binding:"required,email"`
	Scene string `json:"scene" binding:"required,oneof=register reset"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}
