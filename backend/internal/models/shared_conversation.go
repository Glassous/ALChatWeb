package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type SharedConversation struct {
	ID             primitive.ObjectID   `bson:"_id,omitempty" json:"id"`
	ShareToken     string               `bson:"share_token" json:"share_token"`
	ConversationID primitive.ObjectID   `bson:"conversation_id" json:"conversation_id"`
	UserID         primitive.ObjectID   `bson:"user_id" json:"user_id"`
	UserNickname   string               `bson:"user_nickname" json:"user_nickname"`
	Title          string               `bson:"title" json:"title"`
	MessageIDs     []primitive.ObjectID `bson:"message_ids" json:"message_ids"`
	LeafMessageID  primitive.ObjectID   `bson:"leaf_message_id" json:"leaf_message_id"`
	IsDeleted      bool                 `bson:"is_deleted" json:"is_deleted"`
	CreatedAt      time.Time            `bson:"created_at" json:"created_at"`
	UpdatedAt      time.Time            `bson:"updated_at" json:"updated_at"`
	ExpiresAt      *time.Time           `bson:"expires_at,omitempty" json:"expires_at,omitempty"`
	ViewCount      int                  `bson:"view_count" json:"view_count"`
}
