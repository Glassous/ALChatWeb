package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/firebase/genkit/go/ai"
)

const WebSearchDescription = "Search the web for information using Bocha AI. Use this when you need to find current information, news, travel guides, or facts. Input: {\"query\": \"search keywords\"}. Returns search results with titles, URLs, and snippets."

func NewWebSearchFn(apiKey string) func(ctx *ai.ToolContext, input map[string]any) (map[string]any, error) {
	return func(ctx *ai.ToolContext, input map[string]any) (map[string]any, error) {
		query, _ := input["query"].(string)
		if query == "" {
			return map[string]any{"error": "query is required"}, nil
		}

		if apiKey == "" {
			return map[string]any{
				"query":   query,
				"results": "Search unavailable: API key not configured",
			}, nil
		}

		results, err := bochaSearch(ctx, apiKey, query, 8)
		if err != nil {
			return map[string]any{
				"query":   query,
				"results": fmt.Sprintf("Search error: %v", err),
			}, nil
		}

		return map[string]any{
			"query":   query,
			"results": results,
		}, nil
	}
}

type bochaSearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

func bochaSearch(ctx context.Context, apiKey, query string, count int) ([]bochaSearchResult, error) {
	url := "https://api.bochaai.com/v1/web-search"
	requestBody, err := json.Marshal(map[string]interface{}{
		"query": query,
		"count": count,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Bocha AI API error (status %d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data struct {
			WebPages struct {
				Value []struct {
					Name    string `json:"name"`
					URL     string `json:"url"`
					Snippet string `json:"snippet"`
				} `json:"value"`
			} `json:"webPages"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	searchResults := make([]bochaSearchResult, 0, len(result.Data.WebPages.Value))
	for _, v := range result.Data.WebPages.Value {
		searchResults = append(searchResults, bochaSearchResult{
			Title:   v.Name,
			URL:     v.URL,
			Snippet: v.Snippet,
		})
	}

	return searchResults, nil
}
