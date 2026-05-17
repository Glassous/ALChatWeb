package services

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/utils"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/firebase/genkit/go/ai"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ALingService struct {
	db            *database.MongoDB
	aiService     *AIService
	streamMgr     *StreamManager
	memberService *MemberService
}

func NewALingService(db *database.MongoDB, aiService *AIService, streamMgr *StreamManager, memberService *MemberService) *ALingService {
	return &ALingService{db: db, aiService: aiService, streamMgr: streamMgr, memberService: memberService}
}

func (s *ALingService) alingCollection() *mongo.Collection {
	return s.db.Collection("aling_tasks")
}

func (s *ALingService) publishEvent(taskID string, resp models.ALingStreamResponse) {
	s.streamMgr.Publish(taskID, models.ChatStreamResponse{
		Type: resp.Type,
		Data: resp.Data,
	})
}

// ── Task CRUD ──

func (s *ALingService) CreateDemo(ctx context.Context, userID primitive.ObjectID, req models.CreateDemoRequest) (*models.ALingTask, error) {
	task := &models.ALingTask{
		ID:           primitive.NewObjectID(),
		UserID:       userID,
		Title:        req.Topic,
		Topic:        req.Topic,
		EnableSearch: req.EnableSearch,
		Status:       "pending",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	if len(task.Title) > 40 {
		task.Title = task.Title[:40] + "..."
	}
	_, err := s.alingCollection().InsertOne(ctx, task)
	if err != nil {
		return nil, fmt.Errorf("failed to create demo: %w", err)
	}
	return task, nil
}

func (s *ALingService) ListDemoTasks(ctx context.Context, userID primitive.ObjectID) ([]models.ALingTask, error) {
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}})
	cursor, err := s.alingCollection().Find(ctx, bson.M{"user_id": userID}, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tasks: %w", err)
	}
	defer cursor.Close(ctx)

	var tasks []models.ALingTask
	if err := cursor.All(ctx, &tasks); err != nil {
		return nil, fmt.Errorf("failed to decode tasks: %w", err)
	}
	if tasks == nil {
		tasks = []models.ALingTask{}
	}
	return tasks, nil
}

func (s *ALingService) GetDemoTask(ctx context.Context, taskID string) (*models.ALingTask, error) {
	objID, err := primitive.ObjectIDFromHex(taskID)
	if err != nil {
		return nil, fmt.Errorf("invalid task ID: %w", err)
	}
	var task models.ALingTask
	if err := s.alingCollection().FindOne(ctx, bson.M{"_id": objID}).Decode(&task); err != nil {
		return nil, fmt.Errorf("task not found: %w", err)
	}
	return &task, nil
}

func (s *ALingService) DeleteDemoTask(ctx context.Context, taskID string) error {
	objID, err := primitive.ObjectIDFromHex(taskID)
	if err != nil {
		return fmt.Errorf("invalid task ID: %w", err)
	}
	_, err = s.alingCollection().DeleteOne(ctx, bson.M{"_id": objID})
	return err
}

func (s *ALingService) UpdateOutline(ctx context.Context, taskID string, outline []models.OutlineItem) error {
	objID, err := primitive.ObjectIDFromHex(taskID)
	if err != nil {
		return fmt.Errorf("invalid task ID: %w", err)
	}
	_, err = s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
		"$set": bson.M{
			"outline":    outline,
			"status":     "outline_ready",
			"updated_at": time.Now(),
		},
	})
	return err
}

// ── Outline Generation (Function Calling) ──

func (s *ALingService) GenerateOutline(ctx context.Context, taskID string, userID primitive.ObjectID) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[ALingOutline] Panic: %v", r)
			s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": fmt.Sprintf("Internal error: %v", r)}})
		}
	}()

	objID, err := primitive.ObjectIDFromHex(taskID)
	if err != nil {
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": "Invalid task ID"}})
		return
	}

	s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
		"$set": bson.M{"status": "outline_generating", "updated_at": time.Now()},
	})
	s.publishEvent(taskID, models.ALingStreamResponse{Type: "outline_start", Data: map[string]any{}})

	var task models.ALingTask
	if err := s.alingCollection().FindOne(ctx, bson.M{"_id": objID}).Decode(&task); err != nil {
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": "Task not found"}})
		return
	}

	systemPrompt := `You are a professional presentation designer. Based on the user's topic, generate a detailed slide-by-slide outline.

Output requirements:
- Return ONLY a valid JSON array of objects. No introductory text, no conversational filler.
- Each object represents one slide with fields:
  - index: integer starting from 1
  - title: string (slide title)
  - type: "cover" | "toc" | "section" | "content" | "ending"
  - key_points: string array (2-5 concise points)
  - image_hint: string (suggestion, can be empty)
  - layout: "title-slide" | "two-column" | "grid" | "bullet-list"

Structural requirements:
- First slide MUST be cover (type: cover)
- Second slide is table of contents (type: toc)
- Last slide is ending/thank-you (type: ending)
- Content slides: 8-15 pages
- 2-5 key_points per content slide
- Use the same language as the user's topic.`

	userPrompt := fmt.Sprintf("Topic: %s\n\nPlease generate a detailed presentation outline in JSON format.", task.Topic)

	messages := []*ai.Message{
		{Role: ai.RoleSystem, Content: []*ai.Part{ai.NewTextPart(systemPrompt)}},
		{Role: ai.RoleUser, Content: []*ai.Part{ai.NewTextPart(userPrompt)}},
	}

	// Optional Search
	if task.EnableSearch {
		results, query, err := s.aiService.PerformSearch(ctx, messages, func(data models.SearchData) error {
			s.publishEvent(taskID, models.ALingStreamResponse{
				Type: "search",
				Data: data,
			})
			return nil
		})
		if err == nil && len(results) > 0 {
			var searchContextBuilder strings.Builder
			searchContextBuilder.WriteString(fmt.Sprintf("\n\nWeb search results for \"%s\":\n", query))
			for i, r := range results {
				fmt.Fprintf(&searchContextBuilder, "[%d] %s: %s\n", i+1, r.Title, r.Snippet)
			}
			// Prepend search context to the last user message or add a new system message
			messages = append(messages, &ai.Message{
				Role:    ai.RoleSystem,
				Content: []*ai.Part{ai.NewTextPart(searchContextBuilder.String())},
			})
		}
	}

	var fullOutlineBuilder strings.Builder
	var totalOutputTokens int

	err = s.aiService.GeneratePlainStream(ctx, messages, func(token string, reasoning string) error {
		if reasoning != "" {
			s.publishEvent(taskID, models.ALingStreamResponse{
				Type: "reasoning",
				Data: map[string]any{"content": reasoning},
			})
		}
		if token != "" {
			fullOutlineBuilder.WriteString(token)
			totalOutputTokens += utils.CountTokens(token)
			s.publishEvent(taskID, models.ALingStreamResponse{
				Type: "outline_token",
				Data: map[string]any{"token": token},
			})
		}
		return nil
	})

	if err != nil {
		log.Printf("[ALingOutline] Stream error: %v", err)
		s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
			"$set": bson.M{"status": "failed", "error": err.Error(), "updated_at": time.Now()},
		})
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": err.Error()}})
		return
	}

	// Parse outline JSON
	outlineRaw := fullOutlineBuilder.String()
	outlineJSON := utils.ExtractJSON(outlineRaw)
	var items []models.OutlineItem
	if err := json.Unmarshal([]byte(outlineJSON), &items); err != nil {
		log.Printf("[ALingOutline] JSON parse error: %v, raw: %s", err, outlineRaw)
		s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
			"$set": bson.M{"status": "failed", "error": "Failed to parse outline JSON", "updated_at": time.Now()},
		})
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": "Failed to parse outline JSON"}})
		return
	}

	if len(items) == 0 {
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": "Generated outline is empty"}})
		return
	}

	s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
		"$set": bson.M{
			"outline":     items,
			"slide_count": len(items),
			"status":      "outline_ready",
			"updated_at":  time.Now(),
		},
	})

	// Deduct credits
	{
		_ = s.memberService.CheckAndResetCredits(ctx, &models.User{ID: userID})
		totalInputTokens := utils.CountTokens(systemPrompt + userPrompt)
		newCredits, _ := s.memberService.DeductCredits(ctx, userID, totalInputTokens, totalOutputTokens)
		log.Printf("[ALingOutline] Credits deducted. Remaining: %.0f", newCredits)
	}

	s.publishEvent(taskID, models.ALingStreamResponse{
		Type: "outline_done",
		Data: map[string]any{
			"outline":     items,
			"slide_count": len(items),
		},
	})
}

// ── HTML Generation (Function Calling) ──

func (s *ALingService) GenerateHTML(ctx context.Context, taskID string, userID primitive.ObjectID) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[ALingHTML] Panic: %v", r)
			s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": fmt.Sprintf("Internal error: %v", r)}})
		}
	}()

	objID, err := primitive.ObjectIDFromHex(taskID)
	if err != nil {
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": "Invalid task ID"}})
		return
	}

	s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
		"$set": bson.M{"status": "generating", "updated_at": time.Now()},
	})

	var task models.ALingTask
	if err := s.alingCollection().FindOne(ctx, bson.M{"_id": objID}).Decode(&task); err != nil {
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": "Task not found"}})
		return
	}

	if len(task.Outline) == 0 {
		s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": "No outline available"}})
		return
	}

	var slideHTMLs []models.SlideHTML
	totalSlides := len(task.Outline)
	var totalInputTokens int
	var totalOutputTokens int

	for i, item := range task.Outline {
		slideIndex := i + 1
		s.publishEvent(taskID, models.ALingStreamResponse{
			Type: "slide_start",
			Data: map[string]any{
				"index": slideIndex,
				"total": totalSlides,
				"title": item.Title,
			},
		})

		systemPrompt := `You are a professional frontend engineer and presentation designer. Generate a single HTML slide based on the given outline item.

Specifications:
- Slide container is 1920x1080px, content safe area is 1600x900px centered.
- Use CSS variables for theming: var(--md-sys-color-surface) for background, var(--md-sys-color-on-surface) for text.
- Font sizes: h1: 48px, h2: 36px, h3: 28px, p/li: 20px.
- Use flexbox/grid layouts, no external dependencies.
- CSS MUST be written in a <style> tag within the slide HTML.
- Each slide MUST be a complete self-contained div.
- Return ONLY the HTML content. No introductory text.`

		itemJSON, _ := json.Marshal(item)
		userPrompt := fmt.Sprintf("Generate HTML for slide %d/%d.\nOutline Item: %s", slideIndex, totalSlides, string(itemJSON))

		messages := []*ai.Message{
			{Role: ai.RoleSystem, Content: []*ai.Part{ai.NewTextPart(systemPrompt)}},
			{Role: ai.RoleUser, Content: []*ai.Part{ai.NewTextPart(userPrompt)}},
		}

		var slideHTMLBuilder strings.Builder
		totalInputTokens += utils.CountTokens(systemPrompt + userPrompt)

		err = s.aiService.GeneratePlainStream(ctx, messages, func(token string, reasoning string) error {
			if reasoning != "" {
				s.publishEvent(taskID, models.ALingStreamResponse{
					Type: "reasoning",
					Data: map[string]any{"content": reasoning},
				})
			}
			if token != "" {
				slideHTMLBuilder.WriteString(token)
				totalOutputTokens += utils.CountTokens(token)
				s.publishEvent(taskID, models.ALingStreamResponse{
					Type: "slide_token",
					Data: map[string]any{
						"index": slideIndex,
						"token": token,
					},
				})
			}
			return nil
		})

		if err != nil {
			log.Printf("[ALingHTML] Slide %d generation failed: %v", slideIndex, err)
			s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
				"$set": bson.M{"status": "failed", "error": err.Error(), "updated_at": time.Now()},
			})
			s.publishEvent(taskID, models.ALingStreamResponse{Type: "error", Data: map[string]any{"error": err.Error()}})
			return
		}

		cleanedHTML := CleanSlideHTML(slideHTMLBuilder.String())
		slide := models.SlideHTML{
			Index: slideIndex,
			Title: item.Title,
			HTML:  cleanedHTML,
		}
		slideHTMLs = append(slideHTMLs, slide)

		s.publishEvent(taskID, models.ALingStreamResponse{
			Type: "slide_done",
			Data: map[string]any{
				"index": slideIndex,
				"total": totalSlides,
				"title": slide.Title,
				"html":  slide.HTML,
			},
		})

		s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
			"$set": bson.M{
				"current_slide": slideIndex,
				"updated_at":    time.Now(),
			},
		})
	}

	// Build full HTML
	fullHTML := buildFullHTML(task.Title, slideHTMLs)

	s.alingCollection().UpdateOne(ctx, bson.M{"_id": objID}, bson.M{
		"$set": bson.M{
			"html_content": fullHTML,
			"slide_htmls":  slideHTMLs,
			"slide_count":  totalSlides,
			"status":       "completed",
			"updated_at":   time.Now(),
		},
	})

	// Deduct credits
	{
		_ = s.memberService.CheckAndResetCredits(ctx, &models.User{ID: userID})
		newCredits, _ := s.memberService.DeductCredits(ctx, userID, totalInputTokens, totalOutputTokens)
		log.Printf("[ALingHTML] Credits deducted. Remaining: %.0f", newCredits)

		s.publishEvent(taskID, models.ALingStreamResponse{
			Type: "done",
			Data: map[string]any{
				"task_id":     taskID,
				"slide_count": totalSlides,
			},
		})
	}
}

// ── HTML Cleaning ──

var markdownBlockRe = regexp.MustCompile("(?s)^\\s*```(?:html)?\\s*\\n?(.*)\\n?```\\s*$")

func CleanSlideHTML(raw string) string {
	cleaned := strings.TrimSpace(raw)

	if matches := markdownBlockRe.FindStringSubmatch(cleaned); len(matches) > 1 {
		cleaned = strings.TrimSpace(matches[1])
	}

	htmlStart := strings.Index(cleaned, "<")
	if htmlStart == -1 {
		return cleaned
	}
	cleaned = cleaned[htmlStart:]

	lastClose := strings.LastIndex(cleaned, ">")
	if lastClose > 0 && lastClose < len(cleaned)-1 {
		trailing := strings.TrimSpace(cleaned[lastClose+1:])
		if trailing != "" && !strings.HasPrefix(trailing, "<") {
			cleaned = cleaned[:lastClose+1]
		}
	}

	scriptRe := regexp.MustCompile(`(?i)<script[^>]*>.*?</script>`)
	cleaned = scriptRe.ReplaceAllString(cleaned, "")

	return cleaned
}

// ── Helper ──

func buildFullHTML(title string, slides []models.SlideHTML) string {
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>`)
	b.WriteString(escapeHTML(title))
	b.WriteString(`</title>
<style>
:root {
  --md-sys-color-surface: #1a1a2e;
  --md-sys-color-on-surface: #e0e0e0;
  --md-sys-color-primary: #7b68ee;
  --md-sys-color-surface-container: #16213e;
  --md-sys-color-on-surface-variant: #b0b0b0;
}
.slide-container { width: 1920px; height: 1080px; position: relative; overflow: hidden; }
.slide { display: none; width: 100%; height: 100%; position: absolute; top: 0; left: 0;
  flex-direction: column; align-items: center; justify-content: center;
  box-sizing: border-box; padding: 80px 160px; font-family: system-ui, sans-serif;
  transition: opacity 0.5s ease, transform 0.5s ease; }
.slide.active { display: flex; }
.page-indicator { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  color: var(--md-sys-color-on-surface-variant); font-size: 16px; z-index: 100; }
.nav-btn { position: fixed; top: 50%; transform: translateY(-50%); z-index: 100;
  background: rgba(255,255,255,0.12); border: none; color: #fff; font-size: 32px;
  width: 56px; height: 56px; border-radius: 50%; cursor: pointer; display: flex;
  align-items: center; justify-content: center; opacity: 0.6; transition: opacity 0.2s; }
.nav-btn:hover { opacity: 1; }
.nav-prev { left: 24px; }
.nav-next { right: 24px; }
</style>
</head>
<body style="margin:0;overflow:hidden;background:var(--md-sys-color-surface)">
<div class="slide-container" id="slideContainer">
`)

	for i, slide := range slides {
		activeClass := ""
		if i == 0 {
			activeClass = " active"
		}
		b.WriteString(fmt.Sprintf(`<div class="slide%s" data-index="%d">%s</div>`, activeClass, i, slide.HTML))
	}

	b.WriteString(fmt.Sprintf(`
</div>
<div class="page-indicator" id="pageIndicator">1 / %d</div>
<button class="nav-btn nav-prev" onclick="prevSlide()">&larr;</button>
<button class="nav-btn nav-next" onclick="nextSlide()">&rarr;</button>
<script>
let current=%d, total=%d;
function showSlide(n){
  document.querySelectorAll('.slide').forEach(function(s,i){
    s.classList.toggle('active', i===n);
  });
  document.getElementById('pageIndicator').textContent=(n+1)+' / '+total;
}
function nextSlide(){ if(current<total-1){ current++; showSlide(current); } }
function prevSlide(){ if(current>0){ current--; showSlide(current); } }
document.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'||e.key===' '){ e.preventDefault(); nextSlide(); }
  else if(e.key==='ArrowLeft'){ e.preventDefault(); prevSlide(); }
  else if(e.key==='f'||e.key==='F'){ e.preventDefault();
    if(document.fullscreenElement){ document.exitFullscreen(); }
    else { document.body.requestFullscreen(); } }
});
showSlide(current);
</script>
</body>
</html>`, len(slides), 0, len(slides)))

	return b.String()
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&#34;")
	return s
}
