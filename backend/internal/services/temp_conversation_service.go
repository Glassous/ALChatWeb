package services

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type TempConversationService struct {
	redis *database.Redis
}

func NewTempConversationService(redis *database.Redis) *TempConversationService {
	return &TempConversationService{redis: redis}
}

// TempMessage internal struct for Redis storage with string IDs
type TempMessage struct {
	ID             string                     `json:"id"`
	ConversationID string                     `json:"conversation_id"`
	ParentID       string                     `json:"parent_id,omitempty"`
	Role           string                     `json:"role"`
	Content        string                     `json:"content"`
	Reasoning      string                     `json:"reasoning,omitempty"`
	Search         *models.SearchData         `json:"search,omitempty"`
	AgentSteps     []models.AgentStepData     `json:"agent_steps,omitempty"`
	AgentPlan      []models.AgentPlanItemData `json:"agent_plan,omitempty"`
	CreatedAt      time.Time                  `json:"created_at"`
}

type TempConversation struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

const tempTTL = 1 * time.Hour

func (s *TempConversationService) getConvKey(id string) string {
	return fmt.Sprintf("alchat:temp:conv:%s", id)
}

func (s *TempConversationService) getMsgsKey(id string) string {
	return fmt.Sprintf("alchat:temp:conv:%s:msgs", id)
}

func (s *TempConversationService) getMsgKey(id string) string {
	return fmt.Sprintf("alchat:temp:msg:%s", id)
}

func (s *TempConversationService) RefreshExpiration(ctx context.Context, convID string) error {
	s.redis.Client.Expire(ctx, s.getConvKey(convID), tempTTL)
	s.redis.Client.Expire(ctx, s.getMsgsKey(convID), tempTTL)

	msgIDs, _ := s.redis.Client.LRange(ctx, s.getMsgsKey(convID), 0, -1).Result()
	for _, msgID := range msgIDs {
		s.redis.Client.Expire(ctx, s.getMsgKey(msgID), tempTTL)
	}
	return nil
}

func (s *TempConversationService) CreateConversation(ctx context.Context, convID, title string) error {
	conv := TempConversation{
		ID:        convID,
		Title:     title,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	data, _ := json.Marshal(conv)
	err := s.redis.Client.Set(ctx, s.getConvKey(convID), data, tempTTL).Err()
	return err
}

func (s *TempConversationService) GetConversation(ctx context.Context, convID string) (*TempConversation, error) {
	data, err := s.redis.Client.Get(ctx, s.getConvKey(convID)).Result()
	if err != nil {
		return nil, err
	}
	var conv TempConversation
	json.Unmarshal([]byte(data), &conv)
	return &conv, nil
}

func (s *TempConversationService) SaveMessage(ctx context.Context, convID, msgID, role, content, parentID string) (*TempMessage, error) {
	msg := &TempMessage{
		ID:             msgID,
		ConversationID: convID,
		ParentID:       parentID,
		Role:           role,
		Content:        content,
		CreatedAt:      time.Now(),
	}

	data, _ := json.Marshal(msg)
	s.redis.Client.Set(ctx, s.getMsgKey(msgID), data, tempTTL)
	s.redis.Client.RPush(ctx, s.getMsgsKey(convID), msgID)

	s.RefreshExpiration(ctx, convID)
	return msg, nil
}

func (s *TempConversationService) UpdateMessage(ctx context.Context, msg *TempMessage) error {
	data, _ := json.Marshal(msg)
	s.redis.Client.Set(ctx, s.getMsgKey(msg.ID), data, tempTTL)
	return nil
}

func (s *TempConversationService) GetMessages(ctx context.Context, convID string) ([]models.Message, error) {
	msgIDs, err := s.redis.Client.LRange(ctx, s.getMsgsKey(convID), 0, -1).Result()
	if err != nil {
		return nil, err
	}

	var messages []models.Message
	for _, id := range msgIDs {
		data, err := s.redis.Client.Get(ctx, s.getMsgKey(id)).Result()
		if err == nil {
			var tm TempMessage
			json.Unmarshal([]byte(data), &tm)
			msgModel := tm.ToModel()
			// Override the ID Hex to be the original temp ID so lookup works
			// However, models.Message.ID is primitive.ObjectID, so we can't put a string there.
			messages = append(messages, msgModel)
		}
	}
	return messages, nil
}

func (s *TempConversationService) GetMessageBranch(ctx context.Context, convID, leafID string) ([]models.Message, error) {
	msgIDs, err := s.redis.Client.LRange(ctx, s.getMsgsKey(convID), 0, -1).Result()
	if err != nil {
		return nil, err
	}

	tempMsgMap := make(map[string]TempMessage)
	for _, id := range msgIDs {
		data, err := s.redis.Client.Get(ctx, s.getMsgKey(id)).Result()
		if err == nil {
			var tm TempMessage
			json.Unmarshal([]byte(data), &tm)
			tempMsgMap[tm.ID] = tm
		}
	}

	var branch []models.Message
	currID := leafID
	for currID != "" {
		tm, ok := tempMsgMap[currID]
		if !ok {
			break
		}
		branch = append(branch, tm.ToModel())
		currID = tm.ParentID
	}

	// Reverse for chronological order
	for i, j := 0, len(branch)-1; i < j; i, j = i+1, j-1 {
		branch[i], branch[j] = branch[j], branch[i]
	}
	return branch, nil
}

func (s *TempConversationService) DeleteConversation(ctx context.Context, convID string) error {
	msgIDs, _ := s.redis.Client.LRange(ctx, s.getMsgsKey(convID), 0, -1).Result()
	for _, id := range msgIDs {
		s.redis.Client.Del(ctx, s.getMsgKey(id))
	}
	s.redis.Client.Del(ctx, s.getMsgsKey(convID))
	s.redis.Client.Del(ctx, s.getConvKey(convID))
	return nil
}

// ToModel converts TempMessage to models.Message with a pseudo-ObjectID
func (tm *TempMessage) ToModel() models.Message {
	// Generate a deterministic but valid ObjectID from the string ID
	var id primitive.ObjectID
	if oid, err := primitive.ObjectIDFromHex(tm.ID); err == nil {
		id = oid
	} else {
		hash := md5.Sum([]byte(tm.ID))
		copy(id[:], hash[:12])
	}

	var convID primitive.ObjectID
	if oid, err := primitive.ObjectIDFromHex(tm.ConversationID); err == nil {
		convID = oid
	} else {
		hash := md5.Sum([]byte(tm.ConversationID))
		copy(convID[:], hash[:12])
	}

	var parentID *primitive.ObjectID
	if tm.ParentID != "" {
		if oid, err := primitive.ObjectIDFromHex(tm.ParentID); err == nil {
			parentID = &oid
		} else {
			var pID primitive.ObjectID
			hash := md5.Sum([]byte(tm.ParentID))
			copy(pID[:], hash[:12])
			parentID = &pID
		}
	}

	return models.Message{
		ID:             id,
		ConversationID: convID,
		ParentID:       parentID,
		Role:           tm.Role,
		Content:        tm.Content,
		Reasoning:      tm.Reasoning,
		Search:         tm.Search,
		AgentSteps:     tm.AgentSteps,
		AgentPlan:      tm.AgentPlan,
		CreatedAt:      tm.CreatedAt,
	}
}

// PromoteConversation moves data from Redis to MongoDB
func (s *TempConversationService) PromoteConversation(ctx context.Context, convID, userID string, convService *ConversationService, aiService *AIService) (*models.Conversation, error) {
	// 1. Get all messages from Redis
	msgIDs, err := s.redis.Client.LRange(ctx, s.getMsgsKey(convID), 0, -1).Result()
	if err != nil {
		return nil, err
	}

	var tempMsgs []TempMessage
	for _, id := range msgIDs {
		data, err := s.redis.Client.Get(ctx, s.getMsgKey(id)).Result()
		if err == nil {
			var tm TempMessage
			json.Unmarshal([]byte(data), &tm)
			tempMsgs = append(tempMsgs, tm)
		}
	}

	if len(tempMsgs) == 0 {
		return nil, fmt.Errorf("no messages found in temporary conversation")
	}

	// 2. Create new permanent conversation
	newConv, err := convService.CreateConversation(ctx, "临时对话", userID)
	if err != nil {
		return nil, err
	}

	// 3. Migrate messages and build ID mapping
	idMapping := make(map[string]string) // old_temp_id -> new_real_id
	for _, tm := range tempMsgs {
		parentID := ""
		if tm.ParentID != "" {
			parentID = idMapping[tm.ParentID]
		}

		newMsg, err := convService.SaveMessage(ctx, newConv.ID.Hex(), tm.Role, tm.Content, userID, parentID)
		if err != nil {
			continue
		}

		// Update additional fields like reasoning, search, etc.
		if tm.Reasoning != "" || tm.Search != nil || tm.AgentSteps != nil || tm.AgentPlan != nil {
			newMsg.Reasoning = tm.Reasoning
			newMsg.Search = tm.Search
			newMsg.AgentSteps = tm.AgentSteps
			newMsg.AgentPlan = tm.AgentPlan
			convService.UpdateMessage(ctx, newMsg)
		}

		idMapping[tm.ID] = newMsg.ID.Hex()
	}

	// 4. Generate title
	title, err := convService.AutoGenerateTitle(ctx, newConv.ID.Hex(), userID, aiService)
	if err == nil && title != "" {
		newConv.Title = title
	}

	// 5. Cleanup Redis
	s.DeleteConversation(ctx, convID)

	return newConv, nil
}
