package utils

import (
	"fmt"
	"strings"
	"time"
	"math/rand"
)

// IsTempID 检查给定的 ID 是否是临时对话 ID
func IsTempID(id string) bool {
	return strings.HasPrefix(id, "temp_")
}

// GenerateTempID 生成一个临时 ID
func GenerateTempID(prefix string) string {
	return fmt.Sprintf("temp_%s%d_%s", prefix, time.Now().UnixMilli(), randomHex(3))
}

func randomHex(n int) string {
	const letters = "0123456789abcdef"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}
