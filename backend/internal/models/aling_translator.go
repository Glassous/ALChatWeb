package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ALingUserLanguages stores the customizable target language list for a user
type ALingUserLanguages struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID    primitive.ObjectID `bson:"user_id" json:"user_id"`
	Languages []string           `bson:"languages" json:"languages"`
	UpdatedAt time.Time          `bson:"updated_at" json:"updated_at"`
}

// ALingTranslationHistory stores translation history records
type ALingTranslationHistory struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID     primitive.ObjectID `bson:"user_id" json:"user_id"`
	SourceText string             `bson:"source_text" json:"source_text"`
	TargetText string             `bson:"target_text" json:"target_text"`
	TargetLang string             `bson:"target_lang" json:"target_lang"`
	CreatedAt  time.Time          `bson:"created_at" json:"created_at"`
}
