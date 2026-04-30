package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type MemberType string

const (
	MemberFree MemberType = "free"
	MemberPro  MemberType = "pro"
	MemberMax  MemberType = "max"
)

type InvitationCode struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Code      string             `bson:"code" json:"code"`
	Type      MemberType         `bson:"type" json:"type"` // pro, max
	IsUsed    bool               `bson:"is_used" json:"is_used"`
	UsedBy    primitive.ObjectID `bson:"used_by,omitempty" json:"used_by,omitempty"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	UsedAt    *time.Time         `bson:"used_at,omitempty" json:"used_at,omitempty"`
}

type CampaignConfig struct {
	IsActive        bool               `bson:"is_active" json:"is_active"`
	CampaignCredits map[string]float64 `bson:"campaign_credits" json:"campaign_credits"` // member_type -> credits
}

type SystemSettings struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	CampaignConfig CampaignConfig     `bson:"campaign_config" json:"campaign_config"`
	UpdatedAt      time.Time          `bson:"updated_at" json:"updated_at"`
}
