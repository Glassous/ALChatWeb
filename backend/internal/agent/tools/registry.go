package tools

import (
	"context"
	"sync"
)

const (
	WebSearchDescription = "Search the web for information using Bocha AI. Use this when you need to find current information, news, travel guides, or facts. Input: {\"query\": \"search keywords\"}. Returns search results with titles, URLs, and snippets."
	WeatherDescription   = `Get weather information for a location. Input: {"location": "city name"} or {"latitude": 0.0, "longitude": 0.0}.
When user mentions a city name (e.g. "北京", "Shanghai"), use the location field.
IMPORTANT: After receiving weather data, you MUST include a <weather> tag in your response with the exact JSON data returned by this tool. Example:
<weather>{"location":"北京","current":{"temp":25,"feels_like":27,"humidity":60,"condition":"晴","wind_speed":10,"wind_direction":180,"precipitation":0,"cloud_cover":20},"forecast":[{"date":"2026-05-02","high":28,"low":18,"condition":"晴","precipitation":0},{"date":"2026-05-03","high":26,"low":17,"condition":"多云","precipitation":2}]}</weather>
Copy the "weather_data" field from the tool result directly into the tag.`
	CalculatorDescription = "Perform mathematical calculations. Supports basic arithmetic (+, -, *, /), powers (^), and common math functions (sqrt, abs, sin, cos, tan, log, ln). Input: {\"expression\": \"math expression\"}. Example: {\"expression\": \"2 + 3 * 4\"} or {\"expression\": \"sqrt(144)\"}"
	GetTimeDescription    = "Get the current date and time, or convert between timezones. Use this when the user asks about the current time, date, or time in a specific timezone. Input: {\"timezone\": \"optional timezone, e.g. Asia/Shanghai, America/New_York\"}. If no timezone is provided, returns UTC+8 (China Standard Time)."
	GenerateImageDescription = "根据用户描述生成/绘制图像或画图。当用户要求编写代码、生成网页、设计 HTML/CSS/JS、编写文字时，千万不要调用此工具。仅在明确要求画图、绘制或生成图像照片时使用。"
)


type ToolMeta struct {
	Name        string
	Description string
	Enabled     bool
	Fn          func(ctx context.Context, input map[string]any) (map[string]any, error)
}

type Registry struct {
	mu    sync.RWMutex
	tools map[string]*ToolMeta
}

func NewRegistry() *Registry {
	return &Registry{
		tools: make(map[string]*ToolMeta),
	}
}

func (r *Registry) Register(name, description string, fn func(ctx context.Context, input map[string]any) (map[string]any, error)) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.tools[name] = &ToolMeta{
		Name:        name,
		Description: description,
		Enabled:     true,
		Fn:          fn,
	}
}

func (r *Registry) SetEnabled(name string, enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t, ok := r.tools[name]; ok {
		t.Enabled = enabled
	}
}

func (r *Registry) GetEnabledTools() []ToolMeta {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var enabled []ToolMeta
	for _, t := range r.tools {
		if t.Enabled {
			enabled = append(enabled, *t)
		}
	}
	return enabled
}

func (r *Registry) GetAllTools() []ToolMeta {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]ToolMeta, 0, len(r.tools))
	for _, t := range r.tools {
		result = append(result, *t)
	}
	return result
}

func (r *Registry) GetToolMeta(name string) (ToolMeta, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	if !ok {
		return ToolMeta{}, false
	}
	return *t, true
}

func (r *Registry) ApplyEnabledStates(states map[string]bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for name, enabled := range states {
		if t, ok := r.tools[name]; ok {
			t.Enabled = enabled
		}
	}
}
