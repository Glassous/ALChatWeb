package tools

import (
	"context"
	"sync"
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
