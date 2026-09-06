package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"gorm.io/gorm"
)

const hermesDetailLimit = 32768

type HermesService struct {
	db     *database.MySQL
	crypto *CustomModelService
	client *http.Client
}
type HermesRuntime struct{ APIKey, BaseURL, Model string }

func NewHermesService(db *database.MySQL, secret string) *HermesService {
	return &HermesService{db: db, crypto: NewCustomModelService(db, secret), client: &http.Client{Timeout: 10 * time.Minute}}
}
func (s *HermesService) Get(ctx context.Context, uid string) (*models.HermesConfig, error) {
	var c models.HermesConfig
	err := s.db.DB.WithContext(ctx).Where("user_id = ?", uid).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &models.HermesConfig{UserID: uid}, nil
	}
	return &c, err
}
func (s *HermesService) Save(ctx context.Context, c *models.HermesConfig) error {
	return s.db.DB.WithContext(ctx).Save(c).Error
}
func (s *HermesService) Encrypt(v string) (string, error) { return s.crypto.Encrypt(v) }
func (s *HermesService) Decrypt(v string) (string, error) { return s.crypto.Decrypt(v) }
func NormalizeHermesResponsesURL(v string) string {
	v = strings.TrimRight(strings.TrimSpace(v), "/")
	if strings.HasSuffix(strings.ToLower(v), "/v1/responses") {
		return v
	}
	if strings.HasSuffix(strings.ToLower(v), "/v1") {
		return v + "/responses"
	}
	return v + "/v1/responses"
}
func (s *HermesService) Runtime(ctx context.Context, uid string) (*HermesRuntime, error) {
	c, err := s.Get(ctx, uid)
	if err != nil {
		return nil, err
	}
	if !c.Tested || c.BaseURL == "" || c.Model == "" || c.APIKeyCiphertext == "" {
		return nil, nil
	}
	k, err := s.Decrypt(c.APIKeyCiphertext)
	if err != nil {
		return nil, err
	}
	return &HermesRuntime{k, c.BaseURL, c.Model}, nil
}
func clipped(v string) string {
	if len(v) > hermesDetailLimit {
		return v[:hermesDetailLimit] + "\n…[truncated]"
	}
	return v
}
func scrub(v interface{}) interface{} {
	switch x := v.(type) {
	case map[string]interface{}:
		for k, val := range x {
			l := strings.ToLower(k)
			if strings.Contains(l, "authorization") || strings.Contains(l, "api_key") || strings.Contains(l, "apikey") || l == "key" {
				x[k] = "[REDACTED]"
			} else {
				x[k] = scrub(val)
			}
		}
		return x
	case []interface{}:
		for i := range x {
			x[i] = scrub(x[i])
		}
		return x
	}
	return v
}
func eventID(m map[string]interface{}, typ string, seq int) string {
	for _, k := range []string{"item_id", "id", "call_id"} {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return fmt.Sprintf("%s-%d", typ, seq)
}
func normalizeHermesEvent(m map[string]interface{}, seq int) models.HermesStep {
	typ, _ := m["type"].(string)
	now := time.Now()
	status := "running"
	title := typ
	if strings.HasSuffix(typ, ".done") || typ == "response.completed" {
		status = "completed"
	}
	if strings.Contains(typ, "failed") || strings.Contains(typ, "error") {
		status = "failed"
	}
	if item, ok := m["item"].(map[string]interface{}); ok {
		if t, ok := item["type"].(string); ok {
			title = t
		}
		if n, ok := item["name"].(string); ok {
			title = n
		}
	}
	var summary string
	for _, k := range []string{"name", "text", "delta", "message"} {
		if v, ok := m[k].(string); ok && v != "" {
			summary = clipped(v)
			break
		}
	}
	raw := scrub(m)
	b, _ := json.Marshal(raw)
	return models.HermesStep{ID: eventID(m, typ, seq), Type: typ, Title: title, Status: status, StartedAt: &now, Summary: summary, Details: clipped(string(b)), Raw: raw}
}
func (s *HermesService) Stream(ctx context.Context, rt *HermesRuntime, history []models.AIMessage, onText func(string), onStep func(models.HermesStep)) error {
	input := make([]map[string]interface{}, 0, len(history))
	for _, m := range history {
		input = append(input, map[string]interface{}{"role": m.Role, "content": m.Content})
	}
	body, _ := json.Marshal(map[string]interface{}{"model": rt.Model, "input": input, "stream": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, NormalizeHermesResponsesURL(rt.BaseURL), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+rt.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("Hermes HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	seq := 0
	completed := false
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var m map[string]interface{}
		if json.Unmarshal([]byte(data), &m) != nil {
			continue
		}
		typ, _ := m["type"].(string)
		seq++
		if typ == "response.output_text.delta" {
			if d, ok := m["delta"].(string); ok {
				onText(d)
			}
		} else {
			onStep(normalizeHermesEvent(m, seq))
		}
		if typ == "response.completed" {
			completed = true
		}
		if typ == "response.failed" || typ == "error" {
			return fmt.Errorf("Hermes response failed")
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if !completed {
		return errors.New("Hermes stream ended before response.completed")
	}
	return nil
}
