package tools

import (
	"context"
)

const GenerateImageDescription = "根据用户描述生成/绘制图像或画图。当用户要求编写代码、生成网页、设计 HTML/CSS/JS、编写文字时，千万不要调用此工具。仅在明确要求画图、绘制或生成图像照片时使用。"

func GenerateImageDummyFn(ctx context.Context, input map[string]any) (map[string]any, error) {
	return map[string]any{
		"status": "image generation request received",
	}, nil
}
