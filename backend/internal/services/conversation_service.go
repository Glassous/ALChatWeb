package services

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ConversationService struct {
	db    *database.MongoDB
	redis *database.Redis
}

func NewConversationService(db *database.MongoDB, redis *database.Redis) *ConversationService {
	return &ConversationService{db: db, redis: redis}
}

func (s *ConversationService) CreateConversation(ctx context.Context, title string, userIDStr string) (*models.Conversation, error) {
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid user ID: %w", err)
	}

	conversation := &models.Conversation{
		ID:        primitive.NewObjectID(),
		UserID:    userID,
		Title:     title,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	_, err = s.db.Conversations().InsertOne(ctx, conversation)
	if err != nil {
		return nil, fmt.Errorf("failed to create conversation: %w", err)
	}

	return conversation, nil
}

func (s *ConversationService) GetAllConversations(ctx context.Context, userIDStr string) ([]models.Conversation, error) {
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid user ID: %w", err)
	}

	opts := options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}})
	cursor, err := s.db.Conversations().Find(ctx, bson.M{"user_id": userID}, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch conversations: %w", err)
	}
	defer cursor.Close(ctx)

	var conversations []models.Conversation
	if err := cursor.All(ctx, &conversations); err != nil {
		return nil, fmt.Errorf("failed to decode conversations: %w", err)
	}

	// Ensure we return an empty array instead of nil
	if conversations == nil {
		conversations = []models.Conversation{}
	}

	return conversations, nil
}

func (s *ConversationService) GetConversationWithMessages(ctx context.Context, conversationID string, userIDStr string) (*models.ConversationWithMessages, error) {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return nil, fmt.Errorf("invalid conversation ID: %w", err)
	}
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid user ID: %w", err)
	}

	var conversation models.Conversation
	err = s.db.Conversations().FindOne(ctx, bson.M{"_id": objID, "user_id": userID}).Decode(&conversation)
	if err != nil {
		return nil, fmt.Errorf("conversation not found: %w", err)
	}

	messages, err := s.GetMessages(ctx, conversationID)
	if err != nil {
		return nil, err
	}

	return &models.ConversationWithMessages{
		Conversation: conversation,
		Messages:     messages,
	}, nil
}

func (s *ConversationService) GetMessages(ctx context.Context, conversationID string) ([]models.Message, error) {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return nil, fmt.Errorf("invalid conversation ID: %w", err)
	}

	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})
	cursor, err := s.db.Messages().Find(ctx, bson.M{"conversation_id": objID}, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch messages: %w", err)
	}
	defer cursor.Close(ctx)

	var messages []models.Message
	if err := cursor.All(ctx, &messages); err != nil {
		return nil, fmt.Errorf("failed to decode messages: %w", err)
	}

	// Ensure we return an empty array instead of nil
	if messages == nil {
		messages = []models.Message{}
	}

	return messages, nil
}

func (s *ConversationService) SaveMessage(ctx context.Context, conversationID, role, content, userIDStr, parentIDStr string) (*models.Message, error) {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return nil, fmt.Errorf("invalid conversation ID: %w", err)
	}

	var parentID *primitive.ObjectID
	if parentIDStr != "" {
		pID, err := primitive.ObjectIDFromHex(parentIDStr)
		if err == nil {
			parentID = &pID
		} else {
			// If parentIDStr is not a valid ObjectID (e.g. temporary frontend ID),
			// we log it and treat it as a root message to avoid crashing.
			// In a more advanced version, we could try to map temporary IDs to real IDs.
			log.Printf("Warning: Invalid parent message ID '%s', saving as root", parentIDStr)
		}
	}

	message := &models.Message{
		ID:             primitive.NewObjectID(),
		ConversationID: objID,
		Role:           role,
		Content:        content,
		ParentID:       parentID,
		CreatedAt:      time.Now(),
	}

	_, err = s.db.Messages().InsertOne(ctx, message)
	if err != nil {
		return nil, fmt.Errorf("failed to save message: %w", err)
	}

	// Update conversation's updated_at timestamp
	_, _ = s.db.Conversations().UpdateOne(
		ctx,
		bson.M{"_id": objID},
		bson.M{"$set": bson.M{"updated_at": time.Now()}},
	)

	// Invalidate branch cache for parent if it exists
	if parentID != nil {
		s.redis.Client.Del(ctx, fmt.Sprintf("alchat:branch:%s", parentID.Hex()))
	}

	return message, nil
}

func (s *ConversationService) GetMessageBranch(ctx context.Context, conversationID string, leafMessageID string) ([]models.Message, error) {
	redisKey := fmt.Sprintf("alchat:branch:%s", leafMessageID)

	// Step B: Try from Redis
	cached, err := s.redis.Client.Get(ctx, redisKey).Result()
	if err == nil {
		var branch []models.Message
		if err := json.Unmarshal([]byte(cached), &branch); err == nil {
			return branch, nil
		}
	}

	// Step C: Cache Miss - Pull all messages from MongoDB
	allMessages, err := s.GetMessages(ctx, conversationID)
	if err != nil {
		return nil, err
	}

	// Create a map for quick lookup
	msgMap := make(map[string]models.Message)
	for _, m := range allMessages {
		msgMap[m.ID.Hex()] = m
	}

	// Reverse backtrack from leafMessageID
	var branch []models.Message
	currID := leafMessageID
	for currID != "" {
		msg, ok := msgMap[currID]
		if !ok {
			break
		}
		branch = append(branch, msg)
		if msg.ParentID == nil {
			break
		}
		currID = msg.ParentID.Hex()
	}

	// Reverse the branch to maintain correct chronological order
	for i, j := 0, len(branch)-1; i < j; i, j = i+1, j-1 {
		branch[i], branch[j] = branch[j], branch[i]
	}

	// Step D: SET to Redis with expiration
	if branchJSON, err := json.Marshal(branch); err == nil {
		s.redis.Client.Set(ctx, redisKey, string(branchJSON), 24*time.Hour)
	}

	return branch, nil
}

func (s *ConversationService) UpdateMessage(ctx context.Context, message *models.Message) error {
	_, err := s.db.Messages().UpdateOne(
		ctx,
		bson.M{"_id": message.ID},
		bson.M{"$set": bson.M{
			"content":   message.Content,
			"reasoning": message.Reasoning,
			"search":    message.Search,
		}},
	)
	return err
}

func (s *ConversationService) DeleteConversation(ctx context.Context, conversationID string, userIDStr string) error {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return fmt.Errorf("invalid conversation ID: %w", err)
	}
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		return fmt.Errorf("invalid user ID: %w", err)
	}

	// Verify ownership first
	var conversation models.Conversation
	err = s.db.Conversations().FindOne(ctx, bson.M{"_id": objID, "user_id": userID}).Decode(&conversation)
	if err != nil {
		return fmt.Errorf("conversation not found or access denied: %w", err)
	}

	// Delete all messages in the conversation
	_, err = s.db.Messages().DeleteMany(ctx, bson.M{"conversation_id": objID})
	if err != nil {
		return fmt.Errorf("failed to delete messages: %w", err)
	}

	// Delete the conversation
	_, err = s.db.Conversations().DeleteOne(ctx, bson.M{"_id": objID})
	if err != nil {
		return fmt.Errorf("failed to delete conversation: %w", err)
	}

	return nil
}

func (s *ConversationService) DeleteMessagesAfter(ctx context.Context, conversationID, messageID, userIDStr string) error {
	// N-ary tree architecture: We no longer delete messages.
	// This function is kept for API compatibility but performs no deletions.
	log.Printf("DeleteMessagesAfter called for conv %s, msg %s - skipping to maintain immutability", conversationID, messageID)
	return nil
}

func (s *ConversationService) UpdateConversationTitle(ctx context.Context, conversationID, title string, userIDStr string) error {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return fmt.Errorf("invalid conversation ID: %w", err)
	}
	userID, err := primitive.ObjectIDFromHex(userIDStr)
	if err != nil {
		return fmt.Errorf("invalid user ID: %w", err)
	}

	_, err = s.db.Conversations().UpdateOne(
		ctx,
		bson.M{"_id": objID, "user_id": userID},
		bson.M{
			"$set": bson.M{
				"title":      title,
				"updated_at": time.Now(),
			},
		},
	)
	if err != nil {
		return fmt.Errorf("failed to update conversation title: %w", err)
	}

	return nil
}

func (s *ConversationService) AutoGenerateTitle(ctx context.Context, conversationID string, userID string, aiService *AIService) (string, error) {
	// Check if title needs auto-generation
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return "", err
	}

	var conv models.Conversation
	err = s.db.Conversations().FindOne(ctx, bson.M{"_id": objID}).Decode(&conv)
	if err != nil {
		return "", err
	}

	if conv.Title != "New Conversation" && conv.Title != " " && conv.Title != "" {
		return conv.Title, nil
	}

	// Get conversation history for title generation
	history, err := s.GetMessages(ctx, conversationID)
	if err != nil || len(history) == 0 {
		return "", err
	}

	genkitMsgs := make([]struct {
		Role    string
		Content string
	}, len(history))
	for i, m := range history {
		genkitMsgs[i] = struct {
			Role    string
			Content string
		}{Role: m.Role, Content: m.Content}
	}

	title, err := aiService.GenerateTitle(ctx, ConvertToGenkitMessages(genkitMsgs))
	if err != nil || title == "" {
		return "", err
	}

	err = s.UpdateConversationTitle(ctx, conversationID, title, userID)
	return title, err
}

