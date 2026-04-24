package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type User struct {
	ID               primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Username         string             `bson:"username" json:"username"`
	Nickname         string             `bson:"nickname" json:"nickname"`
	Password         string             `bson:"password" json:"-"` // Omit password from JSON
	SecurityQuestion string             `bson:"security_question" json:"security_question"`
	SecurityAnswer   string             `bson:"security_answer" json:"-"` // Omit from JSON
	Avatar           string             `bson:"avatar" json:"avatar"`
	CreatedAt        time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt        time.Time          `bson:"updated_at" json:"updated_at"`
}

type RegisterRequest struct {
	Username         string `json:"username"`
	Nickname         string `json:"nickname"`
	Password         string `json:"password"`
	ConfirmPassword  string `json:"confirm_password"`
	SecurityQuestion string `json:"security_question"`
	SecurityAnswer   string `json:"security_answer"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type ResetPasswordRequest struct {
	Username         string `json:"username"`
	SecurityAnswer   string `json:"security_answer"`
	NewPassword      string `json:"new_password"`
	ConfirmPassword  string `json:"confirm_password"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}
