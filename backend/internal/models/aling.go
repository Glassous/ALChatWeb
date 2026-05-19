package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type ALingTask struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID       primitive.ObjectID `bson:"user_id" json:"user_id"`
	Title        string             `bson:"title" json:"title"`
	Topic        string             `bson:"topic" json:"topic"`
	EnableSearch bool               `bson:"enable_search" json:"enable_search"`
	Status       string             `bson:"status" json:"status"`
	Outline      []OutlineItem      `bson:"outline,omitempty" json:"outline,omitempty"`
	HTMLContent  string             `bson:"html_content,omitempty" json:"html_content,omitempty"`
	HTMLURL      string             `bson:"html_url,omitempty" json:"html_url,omitempty"`
	SlideHTMLs   []SlideHTML        `bson:"slide_htmls,omitempty" json:"slide_htmls,omitempty"`
	SlideCount   int                `bson:"slide_count" json:"slide_count"`
	CurrentSlide int                `bson:"current_slide" json:"current_slide"`
	Error        string             `bson:"error,omitempty" json:"error,omitempty"`
	CreatedAt    time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt    time.Time          `bson:"updated_at" json:"updated_at"`
}

type OutlineItem struct {
	Index     int      `bson:"index" json:"index"`
	Title     string   `bson:"title" json:"title"`
	Type      string   `bson:"type" json:"type"`
	KeyPoints []string `bson:"key_points" json:"key_points"`
	ImageHint string   `bson:"image_hint,omitempty" json:"image_hint,omitempty"`
	Layout    string   `bson:"layout,omitempty" json:"layout,omitempty"`
}

type SlideHTML struct {
	Index  int    `bson:"index" json:"index"`
	Title  string `bson:"title" json:"title"`
	HTML   string `bson:"html" json:"html"`
	OSSURL string `bson:"oss_url,omitempty" json:"oss_url,omitempty"`
}

type ALingStreamResponse struct {
	Type string      `json:"type"`
	Data interface{} `json:"data,omitempty"`
}
