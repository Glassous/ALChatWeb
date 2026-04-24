package services

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ConversationService struct {
	db *database.MongoDB
}

func NewConversationService(db *database.MongoDB) *ConversationService {
	return &ConversationService{db: db}
}

func (s *ConversationService) CreateConversation(ctx context.Context, title string) (*models.Conversation, error) {
	conversation := &models.Conversation{
		ID:        primitive.NewObjectID(),
		Title:     title,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	_, err := s.db.Conversations().InsertOne(ctx, conversation)
	if err != nil {
		return nil, fmt.Errorf("failed to create conversation: %w", err)
	}

	return conversation, nil
}

func (s *ConversationService) GetAllConversations(ctx context.Context) ([]models.Conversation, error) {
	opts := options.Find().SetSort(bson.D{{Key: "updated_at", Value: -1}})
	cursor, err := s.db.Conversations().Find(ctx, bson.M{}, opts)
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

func (s *ConversationService) GetConversationWithMessages(ctx context.Context, conversationID string) (*models.ConversationWithMessages, error) {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return nil, fmt.Errorf("invalid conversation ID: %w", err)
	}

	var conversation models.Conversation
	err = s.db.Conversations().FindOne(ctx, bson.M{"_id": objID}).Decode(&conversation)
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

func (s *ConversationService) SaveMessage(ctx context.Context, conversationID, role, content string) (*models.Message, error) {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return nil, fmt.Errorf("invalid conversation ID: %w", err)
	}

	message := &models.Message{
		ID:             primitive.NewObjectID(),
		ConversationID: objID,
		Role:           role,
		Content:        content,
		CreatedAt:      time.Now(),
	}

	_, err = s.db.Messages().InsertOne(ctx, message)
	if err != nil {
		return nil, fmt.Errorf("failed to save message: %w", err)
	}

	// Update conversation's updated_at timestamp
	_, err = s.db.Conversations().UpdateOne(
		ctx,
		bson.M{"_id": objID},
		bson.M{"$set": bson.M{"updated_at": time.Now()}},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update conversation timestamp: %w", err)
	}

	return message, nil
}

func (s *ConversationService) DeleteConversation(ctx context.Context, conversationID string) error {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return fmt.Errorf("invalid conversation ID: %w", err)
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

func (s *ConversationService) UpdateConversationTitle(ctx context.Context, conversationID, title string) error {
	objID, err := primitive.ObjectIDFromHex(conversationID)
	if err != nil {
		return fmt.Errorf("invalid conversation ID: %w", err)
	}

	_, err = s.db.Conversations().UpdateOne(
		ctx,
		bson.M{"_id": objID},
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
