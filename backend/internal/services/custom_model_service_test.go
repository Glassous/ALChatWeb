package services

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"alchat-backend/internal/models"
)

func TestCustomModelEncryptionRoundTrip(t *testing.T) {
	s := NewCustomModelService(nil, "test-only-secret")
	ciphertext, err := s.Encrypt("sk-private")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == "sk-private" {
		t.Fatal("API key was not encrypted")
	}
	plain, err := s.Decrypt(ciphertext)
	if err != nil || plain != "sk-private" {
		t.Fatalf("round trip failed: %q, %v", plain, err)
	}
}

func TestValidateCustomBaseURLRejectsLocalhost(t *testing.T) {
	if err := ValidateCustomBaseURL("https://localhost/v1"); err == nil {
		t.Fatal("localhost should be rejected")
	}
	if err := ValidateCustomBaseURL("http://example.com/v1"); err == nil {
		t.Fatal("HTTP should be rejected")
	}
}

func TestGenerateCustomNonStream(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("unexpected authorization: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"content":"hello"}}]}`)
	}))
	defer server.Close()
	s := &AIService{}
	// The production client validates TLS normally; use the test server's client transport here.
	originalTransport := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = originalTransport }()
	var got string
	err := s.generateCustomNonStream(context.Background(), []models.AIMessage{{Role: "user", Content: "hi"}}, "secret", server.URL, "model", false, func(token, _ string) error { got += token; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if got != "hello" {
		t.Fatalf("unexpected content: %q", got)
	}
}

func TestCustomNonStreamGenerationTimeout(t *testing.T) {
	if customNonStreamGenerationTimeout != 240*time.Second {
		t.Fatalf("unexpected custom non-stream timeout: %s", customNonStreamGenerationTimeout)
	}
}
