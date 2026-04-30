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

	var user models.User
	err = s.db.Users().FindOne(ctx, bson.M{"_id": userID}).Decode(&user)
	if err != nil {
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

	// Calculate new expiry
	var newExpiry time.Time
	duration := time.Duration(invCode.DurationMonths) * 30 * 24 * time.Hour

	if user.MemberType == string(invCode.Type) && user.MemberExpiry != nil && user.MemberExpiry.After(now) {
		newExpiry = user.MemberExpiry.Add(duration)
	} else {
		newExpiry = now.Add(duration)
	}

	// Round up to the next day's 00:00:00
	newExpiry = time.Date(newExpiry.Year(), newExpiry.Month(), newExpiry.Day(), 0, 0, 0, 0, newExpiry.Location()).AddDate(0, 0, 1)

	// Update user member type and reset credits
	settings, _ := s.GetSystemSettings(ctx)
	dailyLimit, _ := utils.GetMemberLimits(string(invCode.Type), settings.CampaignConfig.IsActive, settings.CampaignConfig.CampaignCredits)

	_, err = s.db.Users().UpdateOne(
		ctx,
		bson.M{"_id": userID},
		bson.M{"$set": bson.M{
			"member_type":          string(invCode.Type),
			"member_expiry":        newExpiry,
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

func (s *MemberService) StartExpiryChecker(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	go func() {
		for {
			select {
			case <-ticker.C:
				s.CheckExpiries(ctx)
			case <-ctx.Done():
				ticker.Stop()
				return
			}
		}
	}()
}

func (s *MemberService) CheckExpiries(ctx context.Context) {
	now := time.Now()
	// Find users whose membership has expired and they are not "free"
	filter := bson.M{
		"member_type":   bson.M{"$ne": "free"},
		"member_expiry": bson.M{"$lt": now},
	}

	cursor, err := s.db.Users().Find(ctx, filter)
	if err != nil {
		return
	}
	defer cursor.Close(ctx)

	settings, _ := s.GetSystemSettings(ctx)

	for cursor.Next(ctx) {
		var user models.User
		if err := cursor.Decode(&user); err != nil {
			continue
		}

		// Downgrade to free
		dailyLimit, _ := utils.GetMemberLimits("free", settings.CampaignConfig.IsActive, settings.CampaignConfig.CampaignCredits)
		_, _ = s.db.Users().UpdateOne(
			ctx,
			bson.M{"_id": user.ID},
			bson.M{"$set": bson.M{
				"member_type":          "free",
				"member_expiry":        nil,
				"credits":              dailyLimit,
				"last_credit_reset_at": now,
				"updated_at":           now,
			}},
		)
	}
}

func (s *MemberService) RefreshAllUsersCredits(ctx context.Context) error {
	settings, err := s.GetSystemSettings(ctx)
	if err != nil {
		return err
	}

	cursor, err := s.db.Users().Find(ctx, bson.M{})
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)

	now := time.Now()
	for cursor.Next(ctx) {
		var user models.User
		if err := cursor.Decode(&user); err != nil {
			continue
		}

		dailyLimit, _ := utils.GetMemberLimits(user.MemberType, settings.CampaignConfig.IsActive, settings.CampaignConfig.CampaignCredits)
		_, err = s.db.Users().UpdateOne(
			ctx,
			bson.M{"_id": user.ID},
			bson.M{"$set": bson.M{
				"credits":              dailyLimit,
				"last_credit_reset_at": now,
				"updated_at":           now,
			}},
		)
		if err != nil {
			continue
		}
	}

	return nil
}
