package utils

import (
	"regexp"
	"strings"
)

var jsonBlockRe = regexp.MustCompile("(?s)```(?:json)?\\s*\\n?(.*?)\\n?```")

// ExtractJSON extracts JSON content from a string, stripping markdown code blocks if present
func ExtractJSON(raw string) string {
	cleaned := strings.TrimSpace(raw)
	if matches := jsonBlockRe.FindStringSubmatch(cleaned); len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return cleaned
}
