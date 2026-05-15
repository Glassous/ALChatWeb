package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Announcement struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Title       string             `bson:"title" json:"title"`
	Content     string             `bson:"content" json:"content"`
	Type        string             `bson:"type" json:"type"` // info | warning | critical
	IsActive    bool               `bson:"is_active" json:"is_active"`
	PublishedAt *time.Time         `bson:"published_at,omitempty" json:"published_at,omitempty"`
	CreatedBy   primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt   time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time          `bson:"updated_at" json:"updated_at"`
}

type CreateAnnouncementRequest struct {
	Title    string `json:"title" binding:"required"`
	Content  string `json:"content" binding:"required"`
	Type     string `json:"type" binding:"required,oneof=info warning critical"`
	IsActive bool   `json:"is_active"`
}

type UpdateAnnouncementRequest struct {
	Title     *string `json:"title,omitempty"`
	Content   *string `json:"content,omitempty"`
	Type      *string `json:"type,omitempty"`
	IsActive  *bool   `json:"is_active,omitempty"`
	Publish   *bool   `json:"publish,omitempty"`
	Unpublish *bool   `json:"unpublish,omitempty"`
}
