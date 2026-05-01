package tools

import (
	"sync"

	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
)

type ToolMeta struct {
	Name        string
	Description string
	Enabled     bool
	GenkitTool  ai.ToolRef
}

type Registry struct {
	mu    sync.RWMutex
	tools map[string]*ToolMeta
	g     *genkit.Genkit
}

func NewRegistry(g *genkit.Genkit) *Registry {
	return &Registry{
		tools: make(map[string]*ToolMeta),
		g:     g,
	}
}

func (r *Registry) Register(name, description string, fn ai.ToolFunc[map[string]any, map[string]any]) {
	r.mu.Lock()
	defer r.mu.Unlock()

	t := genkit.DefineTool(r.g, name, description, fn)
	r.tools[name] = &ToolMeta{
		Name:        name,
		Description: description,
		Enabled:     true,
		GenkitTool:  t,
	}
}

func (r *Registry) SetEnabled(name string, enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t, ok := r.tools[name]; ok {
		t.Enabled = enabled
	}
}

func (r *Registry) GetEnabledTools() []ai.ToolRef {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var tools []ai.ToolRef
	for _, t := range r.tools {
		if t.Enabled {
			tools = append(tools, t.GenkitTool)
		}
	}
	return tools
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
