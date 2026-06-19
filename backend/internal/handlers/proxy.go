package handlers

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type ProxyHandler struct{}

func NewProxyHandler() *ProxyHandler {
	return &ProxyHandler{}
}

func (h *ProxyHandler) ProxyIcon(c *gin.Context) {
	targetURL := c.Query("url")
	if targetURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url parameter is required"})
		return
	}

	// Parse and validate URL
	parsedURL, err := url.Parse(targetURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid url"})
		return
	}

	// Create client with timeout
	client := &http.Client{
		Timeout: 8 * time.Second,
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), "GET", targetURL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create request"})
		return
	}

	// Set standard headers to pretend we are a browser
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to fetch icon: %v", err)})
		return
	}
	defer resp.Body.Close()

	// Forward specific response headers
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" && (strings.HasPrefix(contentType, "image/") || contentType == "application/octet-stream") {
		c.Header("Content-Type", contentType)
	} else {
		// Fallback content type for images if missing/mismatched
		c.Header("Content-Type", "image/x-icon")
	}

	cacheControl := resp.Header.Get("Cache-Control")
	if cacheControl != "" {
		c.Header("Cache-Control", cacheControl)
	} else {
		// Cache icons for a day by default
		c.Header("Cache-Control", "public, max-age=86400")
	}

	c.Status(resp.StatusCode)
	_, _ = io.Copy(c.Writer, resp.Body)
}
