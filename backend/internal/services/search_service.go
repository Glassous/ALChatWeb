package services

import (
	"alchat-backend/internal/models"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type SearchService struct {
	apiKey string
}

func NewSearchService(apiKey string) *SearchService {
	return &SearchService{
		apiKey: apiKey,
	}
}

func (s *SearchService) Search(ctx context.Context, query string, count int) ([]models.SearchResult, error) {
	if count <= 0 {
		count = 10
	}

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
	req.Header.Set("Authorization", "Bearer "+s.apiKey)

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

	searchResults := make([]models.SearchResult, 0, len(result.Data.WebPages.Value))
	for _, v := range result.Data.WebPages.Value {
		searchResults = append(searchResults, models.SearchResult{
			Title:   v.Name,
			URL:     v.URL,
			Snippet: v.Snippet,
		})
	}

	return searchResults, nil
}
