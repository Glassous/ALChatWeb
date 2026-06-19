package services

import (
	"alchat-backend/internal/models"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type TavilyService struct {
	apiKey string
}

func NewTavilyService(apiKey string) *TavilyService {
	return &TavilyService{
		apiKey: apiKey,
	}
}

type tavilySearchResult struct {
	Title         string `json:"title"`
	URL           string `json:"url"`
	Content       string `json:"content"`
	Favicon       string `json:"favicon"`
	PublishedDate string `json:"published_date"`
}

func (s *TavilyService) Search(ctx context.Context, query string, count int) ([]models.SearchResult, error) {
	if count <= 0 {
		count = 10
	}

	if s.apiKey == "" {
		return nil, fmt.Errorf("Tavily API key is empty")
	}

	apiURL := "https://api.tavily.com/search"
	requestBody, err := json.Marshal(map[string]interface{}{
		"api_key":         s.apiKey,
		"query":           query,
		"search_depth":    "basic",
		"include_images":  false,
		"include_favicon": true,
		"max_results":     count,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Tavily API error (status %d): %s", resp.StatusCode, string(body))
	}

	var response struct {
		Results []tavilySearchResult `json:"results"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, err
	}

	searchResults := make([]models.SearchResult, 0, len(response.Results))
	for _, v := range response.Results {
		siteName := extractDomain(v.URL)
		searchResults = append(searchResults, models.SearchResult{
			Title:         v.Title,
			URL:           v.URL,
			Snippet:       v.Content,
			SiteName:      siteName,
			SiteIcon:      v.Favicon,
			DatePublished: v.PublishedDate,
		})
	}

	return searchResults, nil
}

func extractDomain(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	host := parsed.Host
	if strings.Contains(host, ":") {
		parts := strings.Split(host, ":")
		host = parts[0]
	}
	host = strings.TrimPrefix(host, "www.")
	return host
}
