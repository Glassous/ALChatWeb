package services

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ALingService struct {
	db        *database.MongoDB
	aiService *AIService
}

func NewALingService(db *database.MongoDB, aiService *AIService, streamMgr *StreamManager, memberService *MemberService, ossService *OSSService) *ALingService {
	return &ALingService{
		db:        db,
		aiService: aiService,
	}
}

func (s *ALingService) languagesCollection() *mongo.Collection {
	return s.db.Collection("aling_translator_languages")
}

func (s *ALingService) historyCollection() *mongo.Collection {
	return s.db.Collection("aling_translation_history")
}

var PresetLanguages = []string{"中文", "英语", "日语", "韩语", "法语", "西班牙语"}

// GetTranslatorLanguages gets user's target languages. Initializes with presets if empty.
func (s *ALingService) GetTranslatorLanguages(ctx context.Context, userID primitive.ObjectID) ([]string, error) {
	var userLangs models.ALingUserLanguages
	err := s.languagesCollection().FindOne(ctx, bson.M{"user_id": userID}).Decode(&userLangs)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			// Initialize with presets
			userLangs = models.ALingUserLanguages{
				ID:        primitive.NewObjectID(),
				UserID:    userID,
				Languages: PresetLanguages,
				UpdatedAt: time.Now(),
			}
			_, err = s.languagesCollection().InsertOne(ctx, userLangs)
			if err != nil {
				return nil, err
			}
			return userLangs.Languages, nil
		}
		return nil, err
	}
	return userLangs.Languages, nil
}

// AddTranslatorLanguage adds a custom target language for a user
func (s *ALingService) AddTranslatorLanguage(ctx context.Context, userID primitive.ObjectID, lang string) error {
	lang = strings.TrimSpace(lang)
	if lang == "" {
		return errors.New("语言名称不能为空")
	}

	currentLangs, err := s.GetTranslatorLanguages(ctx, userID)
	if err != nil {
		return err
	}

	// Check duplicates (case-insensitive)
	lowerLang := strings.ToLower(lang)
	for _, l := range currentLangs {
		if strings.ToLower(strings.TrimSpace(l)) == lowerLang {
			return errors.New("该语言已存在于选择列表中，不能重复添加")
		}
	}

	currentLangs = append(currentLangs, lang)
	opts := options.Update().SetUpsert(true)
	_, err = s.languagesCollection().UpdateOne(
		ctx,
		bson.M{"user_id": userID},
		bson.M{
			"$set": bson.M{
				"languages":  currentLangs,
				"updated_at": time.Now(),
			},
		},
		opts,
	)
	return err
}

// DeleteTranslatorLanguage deletes a target language for a user
func (s *ALingService) DeleteTranslatorLanguage(ctx context.Context, userID primitive.ObjectID, lang string) error {
	lang = strings.TrimSpace(lang)
	currentLangs, err := s.GetTranslatorLanguages(ctx, userID)
	if err != nil {
		return err
	}

	// Filter out the language
	var updatedLangs []string
	lowerLang := strings.ToLower(lang)
	for _, l := range currentLangs {
		if strings.ToLower(strings.TrimSpace(l)) != lowerLang {
			updatedLangs = append(updatedLangs, l)
		}
	}

	_, err = s.languagesCollection().UpdateOne(
		ctx,
		bson.M{"user_id": userID},
		bson.M{
			"$set": bson.M{
				"languages":  updatedLangs,
				"updated_at": time.Now(),
			},
		},
	)
	return err
}

// ResetTranslatorLanguages resets target languages list back to PresetLanguages
func (s *ALingService) ResetTranslatorLanguages(ctx context.Context, userID primitive.ObjectID) ([]string, error) {
	_, err := s.languagesCollection().UpdateOne(
		ctx,
		bson.M{"user_id": userID},
		bson.M{
			"$set": bson.M{
				"languages":  PresetLanguages,
				"updated_at": time.Now(),
			},
		},
	)
	if err != nil {
		return nil, err
	}
	return PresetLanguages, nil
}

// GetTranslationHistory gets user's translation history records
func (s *ALingService) GetTranslationHistory(ctx context.Context, userID primitive.ObjectID) ([]models.ALingTranslationHistory, error) {
	opts := options.Find().SetSort(bson.M{"created_at": -1})
	cursor, err := s.historyCollection().Find(ctx, bson.M{"user_id": userID}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var history []models.ALingTranslationHistory
	if err = cursor.All(ctx, &history); err != nil {
		return nil, err
	}
	if history == nil {
		history = []models.ALingTranslationHistory{}
	}
	return history, nil
}

// DeleteTranslationHistory deletes a translation history record by ID
func (s *ALingService) DeleteTranslationHistory(ctx context.Context, userID primitive.ObjectID, historyID primitive.ObjectID) error {
	_, err := s.historyCollection().DeleteOne(ctx, bson.M{"_id": historyID, "user_id": userID})
	return err
}

// SaveTranslationHistory saves a translation record
func (s *ALingService) SaveTranslationHistory(ctx context.Context, userID primitive.ObjectID, sourceText, targetText, targetLang string) (*models.ALingTranslationHistory, error) {
	record := models.ALingTranslationHistory{
		ID:         primitive.NewObjectID(),
		UserID:     userID,
		SourceText: sourceText,
		TargetText: targetText,
		TargetLang: targetLang,
		CreatedAt:  time.Now(),
	}
	_, err := s.historyCollection().InsertOne(ctx, record)
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// TranslateStream translates text and streams response tokens back
func (s *ALingService) TranslateStream(ctx context.Context, userID primitive.ObjectID, text, targetLang string, callback func(string) error) (string, error) {
	messages := []models.AIMessage{
		{
			Role: "system",
			Content: fmt.Sprintf(`You are a professional, highly accurate translation engine.
Your task is to detect the source language of the user's input and translate it into the following target language: %s.

Rules:
1. Translate naturally, fluidly, and preserve the original formatting, tone, style, and meaning.
2. Do not include any introductory remarks, explanations, notes, or markdown block formatting wrappers (e.g. do not wrap in markdown code blocks like `+"`"+` or `+"`"+"`"+"`"+`). Output ONLY the translated text.
3. If the input text is already in the target language or is ambiguous, translate/rephrase it naturally in the target language.`, targetLang),
		},
		{
			Role:    "user",
			Content: text,
		},
	}

	var fullResponse strings.Builder
	err := s.aiService.GenerateALingStream(ctx, messages, func(token string, reasoning string) error {
		if token != "" {
			fullResponse.WriteString(token)
			if callback != nil {
				if err := callback(token); err != nil {
					return err
				}
			}
		}
		return nil
	})

	if err != nil {
		return "", err
	}

	return fullResponse.String(), nil
}

