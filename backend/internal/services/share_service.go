package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"alchat-backend/internal/database"
	"alchat-backend/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ShareService struct {
	db *database.MongoDB
}

func NewShareService(db *database.MongoDB) *ShareService {
	return &ShareService{db: db}
}

func generateShareToken() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (s *ShareService) CreateShare(ctx context.Context, userID, conversationID primitive.ObjectID, leafMsgID *primitive.ObjectID) (*models.SharedConversation, error) {
	var conv models.Conversation
	err := s.db.Conversations().FindOne(ctx, bson.M{
		"_id":     conversationID,
		"user_id": userID,
	}).Decode(&conv)
	if err != nil {
		return nil, fmt.Errorf("对话不存在或无权限")
	}

	var user models.User
	err = s.db.Users().FindOne(ctx, bson.M{"_id": userID}).Decode(&user)
	if err != nil {
		return nil, fmt.Errorf("用户不存在")
	}

	nickname := user.Nickname
	if nickname == "" {
		nickname = user.Username
	}

	msgIDs, leafID, err := s.extractBranch(ctx, conversationID, leafMsgID)
	if err != nil {
		return nil, err
	}
	if len(msgIDs) == 0 {
		return nil, fmt.Errorf("对话中没有消息")
	}

	share := models.SharedConversation{
		ShareToken:     generateShareToken(),
		ConversationID: conversationID,
		UserID:         userID,
		UserNickname:   nickname,
		UserAvatar:     user.Avatar,
		Title:          conv.Title,
		MessageIDs:     msgIDs,
		LeafMessageID:  leafID,
		IsDeleted:      false,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		ViewCount:      0,
	}

	result, err := s.db.Collection("shared_conversations").InsertOne(ctx, share)
	if err != nil {
		return nil, err
	}
	share.ID = result.InsertedID.(primitive.ObjectID)
	return &share, nil
}

func (s *ShareService) extractBranch(ctx context.Context, convID primitive.ObjectID, leafMsgID *primitive.ObjectID) ([]primitive.ObjectID, primitive.ObjectID, error) {
	matchStage := bson.M{"conversation_id": convID}
	if leafMsgID != nil {
		matchStage["_id"] = *leafMsgID
	}

	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetLimit(1)
	cursor, err := s.db.Messages().Find(ctx, matchStage, opts)
	if err != nil {
		return nil, primitive.NilObjectID, err
	}

	var msgs []models.Message
	if err = cursor.All(ctx, &msgs); err != nil {
		return nil, primitive.NilObjectID, err
	}
	if len(msgs) == 0 {
		return nil, primitive.NilObjectID, fmt.Errorf("未找到消息")
	}

	leafMsg := msgs[0]
	if leafMsg.ParentID == nil {
		return []primitive.ObjectID{leafMsg.ID}, leafMsg.ID, nil
	}

	msgMap := make(map[primitive.ObjectID]models.Message)
	allMsgs, _ := s.getAllMessages(ctx, convID)
	for _, m := range allMsgs {
		msgMap[m.ID] = m
	}

	var branch []primitive.ObjectID
	currentLeaf := leafMsg.ID
	branch = append(branch, currentLeaf)

	for {
		msg, ok := msgMap[currentLeaf]
		if !ok || msg.ParentID == nil {
			break
		}
		branch = append(branch, *msg.ParentID)
		currentLeaf = *msg.ParentID
	}

	for i, j := 0, len(branch)-1; i < j; i, j = i+1, j-1 {
		branch[i], branch[j] = branch[j], branch[i]
	}

	return branch, leafMsg.ID, nil
}

func (s *ShareService) getAllMessages(ctx context.Context, convID primitive.ObjectID) ([]models.Message, error) {
	cursor, err := s.db.Messages().Find(ctx, bson.M{
		"conversation_id": convID,
	})
	if err != nil {
		return nil, err
	}
	var msgs []models.Message
	if err = cursor.All(ctx, &msgs); err != nil {
		return nil, err
	}
	return msgs, nil
}

func (s *ShareService) GetSharedConversation(ctx context.Context, token string) (map[string]interface{}, error) {
	var shared models.SharedConversation
	err := s.db.Collection("shared_conversations").FindOne(ctx, bson.M{"share_token": token}).Decode(&shared)
	if err != nil {
		return nil, fmt.Errorf("not_found")
	}

	if shared.IsDeleted {
		return map[string]interface{}{
			"status":          "deleted",
			"title":           shared.Title,
			"sharer_nickname": shared.UserNickname,
			"sharer_avatar":   shared.UserAvatar,
			"created_at":      shared.CreatedAt,
		}, nil
	}

	if shared.ExpiresAt != nil && shared.ExpiresAt.Before(time.Now()) {
		return map[string]interface{}{
			"status":          "expired",
			"title":           shared.Title,
			"sharer_nickname": shared.UserNickname,
			"sharer_avatar":   shared.UserAvatar,
			"created_at":      shared.CreatedAt,
		}, nil
	}

	var conv models.Conversation
	err = s.db.Conversations().FindOne(ctx, bson.M{"_id": shared.ConversationID}).Decode(&conv)
	if err != nil {
		return map[string]interface{}{
			"status":          "conversation_deleted",
			"title":           shared.Title,
			"sharer_nickname": shared.UserNickname,
			"sharer_avatar":   shared.UserAvatar,
			"created_at":      shared.CreatedAt,
		}, nil
	}

	s.db.Collection("shared_conversations").UpdateOne(ctx,
		bson.M{"_id": shared.ID},
		bson.M{"$inc": bson.M{"view_count": 1}},
	)

	msgs := s.fetchMessagesByIDs(ctx, shared.MessageIDs)
	if len(msgs) == 0 {
		return map[string]interface{}{
			"status":          "messages_deleted",
			"title":           shared.Title,
			"sharer_nickname": shared.UserNickname,
			"sharer_avatar":   shared.UserAvatar,
			"created_at":      shared.CreatedAt,
		}, nil
	}

	status := "active"
	if len(msgs) < len(shared.MessageIDs) {
		status = "partial"
	}

	return map[string]interface{}{
		"status":          status,
		"title":           shared.Title,
		"sharer_nickname": shared.UserNickname,
		"sharer_avatar":   shared.UserAvatar,
		"created_at":      shared.CreatedAt,
		"messages":        msgs,
	}, nil
}

func (s *ShareService) fetchMessagesByIDs(ctx context.Context, ids []primitive.ObjectID) []models.Message {
	if len(ids) == 0 {
		return nil
	}
	cursor, err := s.db.Messages().Find(ctx, bson.M{
		"_id": bson.M{"$in": ids},
	})
	if err != nil {
		return nil
	}
	var msgs []models.Message
	if err = cursor.All(ctx, &msgs); err != nil {
		return nil
	}
	msgMap := make(map[primitive.ObjectID]models.Message)
	for _, m := range msgs {
		msgMap[m.ID] = m
	}
	var ordered []models.Message
	for _, id := range ids {
		if m, ok := msgMap[id]; ok {
			ordered = append(ordered, m)
		}
	}
	return ordered
}

func (s *ShareService) DeleteShare(ctx context.Context, userID, shareID primitive.ObjectID) error {
	result, err := s.db.Collection("shared_conversations").UpdateOne(ctx,
		bson.M{"_id": shareID, "user_id": userID},
		bson.M{"$set": bson.M{"is_deleted": true, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("分享不存在或无权限")
	}
	return nil
}

func (s *ShareService) DeleteShareByToken(ctx context.Context, userID primitive.ObjectID, token string) error {
	result, err := s.db.Collection("shared_conversations").UpdateOne(ctx,
		bson.M{"share_token": token, "user_id": userID},
		bson.M{"$set": bson.M{"is_deleted": true, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("分享不存在或无权限")
	}
	return nil
}

func (s *ShareService) GetMyShares(ctx context.Context, userID primitive.ObjectID) ([]models.SharedConversation, error) {
	cursor, err := s.db.Collection("shared_conversations").Find(ctx,
		bson.M{"user_id": userID},
		options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}),
	)
	if err != nil {
		return nil, err
	}
	var shares []models.SharedConversation
	if err = cursor.All(ctx, &shares); err != nil {
		return nil, err
	}
	return shares, nil
}

func (s *ShareService) SaveSharedConversation(ctx context.Context, userID primitive.ObjectID, token string) (primitive.ObjectID, error) {
	shared, err := s.getSharedRecord(ctx, token)
	if err != nil {
		return primitive.NilObjectID, fmt.Errorf("分享不存在")
	}
	if shared.IsDeleted {
		return primitive.NilObjectID, fmt.Errorf("分享已失效")
	}

	existingCursor, err := s.db.Messages().Find(ctx, bson.M{
		"_id": bson.M{"$in": shared.MessageIDs},
	})
	if err != nil {
		return primitive.NilObjectID, err
	}
	var existingMsgs []models.Message
	if err = existingCursor.All(ctx, &existingMsgs); err != nil {
		return primitive.NilObjectID, err
	}
	if len(existingMsgs) == 0 {
		return primitive.NilObjectID, fmt.Errorf("对话内容已被删除")
	}

	now := time.Now()
	conv := models.Conversation{
		UserID:    userID,
		Title:     fmt.Sprintf("[来自分享] %s", shared.Title),
		CreatedAt: now,
		UpdatedAt: now,
	}
	convResult, err := s.db.Conversations().InsertOne(ctx, conv)
	if err != nil {
		return primitive.NilObjectID, err
	}
	newConvID := convResult.InsertedID.(primitive.ObjectID)

	idMapping := make(map[primitive.ObjectID]primitive.ObjectID)
	var newMsgs []interface{}
	for _, m := range existingMsgs {
		newID := primitive.NewObjectID()
		idMapping[m.ID] = newID
		newMsg := models.Message{
			ID:             newID,
			ConversationID: newConvID,
			ParentID:       nil,
			Role:           m.Role,
			Content:        m.Content,
			Search:         m.Search,
			Reasoning:      m.Reasoning,
			AgentSteps:     m.AgentSteps,
			AgentPlan:      m.AgentPlan,
			CreatedAt:      m.CreatedAt,
		}
		if m.ParentID != nil {
			if newParentID, ok := idMapping[*m.ParentID]; ok {
				newMsg.ParentID = &newParentID
			}
		}
		newMsgs = append(newMsgs, newMsg)
	}

	if len(newMsgs) > 0 {
		_, err = s.db.Messages().InsertMany(ctx, newMsgs)
		if err != nil {
			s.db.Conversations().DeleteOne(ctx, bson.M{"_id": newConvID})
			return primitive.NilObjectID, err
		}
	}

	return newConvID, nil
}

func (s *ShareService) getSharedRecord(ctx context.Context, token string) (*models.SharedConversation, error) {
	var shared models.SharedConversation
	err := s.db.Collection("shared_conversations").FindOne(ctx, bson.M{"share_token": token}).Decode(&shared)
	if err != nil {
		return nil, err
	}
	return &shared, nil
}

func (s *ShareService) GetAllShares(ctx context.Context, page, pageSize int) ([]models.SharedConversation, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	skip := int64((page - 1) * pageSize)

	total, err := s.db.Collection("shared_conversations").CountDocuments(ctx, bson.M{})
	if err != nil {
		return nil, 0, err
	}

	cursor, err := s.db.Collection("shared_conversations").Find(ctx, bson.M{},
		options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}).SetSkip(skip).SetLimit(int64(pageSize)),
	)
	if err != nil {
		return nil, 0, err
	}
	var shares []models.SharedConversation
	if err = cursor.All(ctx, &shares); err != nil {
		return nil, 0, err
	}
	return shares, total, nil
}

func (s *ShareService) AdminDeleteShare(ctx context.Context, shareID primitive.ObjectID) error {
	result, err := s.db.Collection("shared_conversations").UpdateOne(ctx,
		bson.M{"_id": shareID},
		bson.M{"$set": bson.M{"is_deleted": true, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if result.MatchedCount == 0 {
		return mongo.ErrNoDocuments
	}
	return nil
}
