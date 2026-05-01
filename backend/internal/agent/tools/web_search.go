package tools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/firebase/genkit/go/ai"
)

const WebSearchDescription = "Search the web for information. Use this when you need to find current information, news, or facts that may not be in your training data. Input: {\"query\": \"search keywords\"}"

func WebSearchFn(ctx *ai.ToolContext, input map[string]any) (map[string]any, error) {
	query, _ := input["query"].(string)
	if query == "" {
		return map[string]any{"error": "query is required"}, nil
	}

	searchURL := fmt.Sprintf("https://duckduckgo.com/html/?q=%s", url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}

	type SearchResult struct {
		Title   string `json:"title"`
		URL     string `json:"url"`
		Snippet string `json:"snippet"`
	}

	var results []SearchResult
	_ = json.Unmarshal(body, &results)

	if len(results) == 0 {
		return map[string]any{
			"query":   query,
			"results": "No results found",
		}, nil
	}

	return map[string]any{
		"query":   query,
		"results": results,
	}, nil
}
