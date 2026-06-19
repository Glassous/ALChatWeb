package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Feedback struct {
	ID            primitive.ObjectID  `bson:"_id,omitempty" json:"id" gorm:"primaryKey;type:varchar(24);serializer:objectid"`
	UserID        *primitive.ObjectID `bson:"user_id,omitempty" json:"user_id,omitempty" gorm:"type:varchar(24);serializer:nullobjectid"`
	UserEmail     string              `bson:"user_email" json:"user_email" gorm:"type:varchar(255)"`
	Type          string              `bson:"type" json:"type" gorm:"type:varchar(50);default:'other'"` // bug | feature | other
	Content       string              `bson:"content" json:"content" gorm:"type:text"`
	Meta          map[string]string   `bson:"meta,omitempty" json:"meta,omitempty" gorm:"serializer:json;type:json"`
	Status        string              `bson:"status" json:"status" gorm:"type:varchar(50);default:'open'"` // open | replied | closed
	ReplyContent  string              `bson:"reply_content,omitempty" json:"reply_content,omitempty" gorm:"type:text"`
	RepliedAt     *time.Time          `bson:"replied_at,omitempty" json:"replied_at,omitempty" gorm:"type:datetime"`
	CreatedAt     time.Time           `bson:"created_at" json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt     time.Time           `bson:"updated_at" json:"updated_at" gorm:"autoUpdateTime"`
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
