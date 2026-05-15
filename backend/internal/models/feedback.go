package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Feedback struct {
	ID            primitive.ObjectID  `bson:"_id,omitempty" json:"id"`
	UserID        *primitive.ObjectID `bson:"user_id,omitempty" json:"user_id,omitempty"`
	UserEmail     string              `bson:"user_email" json:"user_email"`
	Type          string              `bson:"type" json:"type"` // bug | feature | other
	Content       string              `bson:"content" json:"content"`
	Meta          map[string]string   `bson:"meta,omitempty" json:"meta,omitempty"`
	Status        string              `bson:"status" json:"status"` // open | replied | closed
	ReplyContent  string              `bson:"reply_content,omitempty" json:"reply_content,omitempty"`
	RepliedAt     *time.Time          `bson:"replied_at,omitempty" json:"replied_at,omitempty"`
	CreatedAt     time.Time           `bson:"created_at" json:"created_at"`
	UpdatedAt     time.Time           `bson:"updated_at" json:"updated_at"`
}

type SubmitFeedbackRequest struct {
	Type      string            `json:"type" binding:"required,oneof=bug feature other"`
	Content   string            `json:"content" binding:"required"`
	UserEmail string            `json:"user_email" binding:"required,email"`
	Meta      map[string]string `json:"meta"`
}

type ReplyFeedbackRequest struct {
	ReplyContent string `json:"reply_content" binding:"required"`
}

type UpdateFeedbackStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=open replied closed"`
}
