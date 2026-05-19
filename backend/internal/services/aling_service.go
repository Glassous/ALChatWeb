package services

import (
	"alchat-backend/internal/database"

	"go.mongodb.org/mongo-driver/mongo"
)

type ALingService struct {
	db *database.MongoDB
}

func NewALingService(db *database.MongoDB, aiService *AIService, streamMgr *StreamManager, memberService *MemberService, ossService *OSSService) *ALingService {
	return &ALingService{db: db}
}

func (s *ALingService) alingCollection() *mongo.Collection {
	return s.db.Collection("aling_tasks")
}

// ALingService methods related to demo have been removed.
// The service is kept for future ALing-related features.
