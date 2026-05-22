package tools

import (
	"context"
)

const GenerateImageDescription = "根据用户描述生成/绘制图片。当用户明确要求画、绘制、生成图片时使用此工具。"

func GenerateImageDummyFn(ctx context.Context, input map[string]any) (map[string]any, error) {
	return map[string]any{
		"status": "image generation request received",
	}, nil
}
