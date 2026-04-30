package services

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/utils"
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type MemberService struct {
	db *database.MongoDB
}

func NewMemberService(db *database.MongoDB) *MemberService {
	return &MemberService{db: db}
}

func (s *MemberService) GetSystemSettings(ctx context.Context) (*models.SystemSettings, error) {
	var settings models.SystemSettings
	err := s.db.Collection("system_settings").FindOne(ctx, bson.M{}).Decode(&settings)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			// Return default settings
			return &models.SystemSettings{
				CampaignConfig: models.CampaignConfig{
					IsActive:        false,
					CampaignCredits: make(map[string]float64),
				},
			}, nil
		}
		return nil, err
	}
	return &settings, nil
}

func (s *MemberService) CheckAndResetCredits(ctx context.Context, user *models.User) error {
	now := time.Now()
	// Use server local time for reset check
	lastReset := user.LastCreditResetAt

	if lastReset.Year() != now.Year() || lastReset.Month() != now.Month() || lastReset.Day() != now.Day() {
		settings, _ := s.GetSystemSettings(ctx)
		dailyLimit, _ := utils.GetMemberLimits(user.MemberType, settings.CampaignConfig.IsActive, settings.CampaignConfig.CampaignCredits)

		update := bson.M{
			"$set": bson.M{
				"credits":              dailyLimit,
				"last_credit_reset_at": now,
				"updated_at":           now,
			},
		}

		_, err := s.db.Users().UpdateOne(ctx, bson.M{"_id": user.ID}, update)
		if err != nil {
			return err
		}
		user.Credits = dailyLimit
		user.LastCreditResetAt = now
	}
	return nil
}

func (s *MemberService) DeductCredits(ctx context.Context, userID primitive.ObjectID, inputTokens, outputTokens int) (float64, error) {
	cost := utils.CalculateCredit(inputTokens, outputTokens)

	// Atomic decrement using $inc with negative value
	var updatedUser models.User
	err := s.db.Users().FindOneAndUpdate(
		ctx,
		bson.M{"_id": userID},
		bson.M{"$inc": bson.M{"credits": -cost}, "$set": bson.M{"updated_at": time.Now()}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updatedUser)

	if err != nil {
		return 0, err
	}
	return updatedUser.Credits, nil
}

func (s *MemberService) UpgradeWithInvitationCode(ctx context.Context, userID primitive.ObjectID, code string) (string, error) {
	var invCode models.InvitationCode
	err := s.db.Collection("invitation_codes").FindOne(ctx, bson.M{"code": code, "is_used": false}).Decode(&invCode)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return "", mongo.ErrNoDocuments
		}
		return "", err
	}

	now := time.Now()
	// Update invitation code
	_, err = s.db.Collection("invitation_codes").UpdateOne(
		ctx,
		bson.M{"_id": invCode.ID},
		bson.M{"$set": bson.M{"is_used": true, "used_by": userID, "used_at": now}},
	)
	if err != nil {
		return "", err
	}

	// Update user member type and reset credits
	settings, _ := s.GetSystemSettings(ctx)
	dailyLimit, _ := utils.GetMemberLimits(string(invCode.Type), settings.CampaignConfig.IsActive, settings.CampaignConfig.CampaignCredits)

	_, err = s.db.Users().UpdateOne(
		ctx,
		bson.M{"_id": userID},
		bson.M{"$set": bson.M{
			"member_type":          string(invCode.Type),
			"credits":              dailyLimit,
			"last_credit_reset_at": now,
			"updated_at":           now,
		}},
	)
	if err != nil {
		return "", err
	}

	return string(invCode.Type), nil
}
