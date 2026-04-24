package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"

	"github.com/volcengine/volcengine-go-sdk/service/arkruntime"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
)

type ImageService struct {
	client     *arkruntime.Client
	endpointID string
	ossService *OSSService
}

func NewImageService(apiKey, endpointID string, ossService *OSSService) (*ImageService, error) {
	if apiKey == "" || endpointID == "" {
		return nil, fmt.Errorf("volcengine API key or endpoint ID is missing")
	}

	client := arkruntime.NewClientWithApiKey(apiKey)

	return &ImageService{
		client:     client,
		endpointID: endpointID,
		ossService: ossService,
	}, nil
}

// GenerateAndUploadImage generates an image using Volcengine and uploads it to Aliyun OSS.
func (s *ImageService) GenerateAndUploadImage(ctx context.Context, prompt, resolution string) (string, error) {
	format := model.GenerateImagesResponseFormatBase64
	addWatermark := false
	req := model.GenerateImagesRequest{
		Model:          s.endpointID,
		Prompt:         prompt,
		ResponseFormat: &format,
		Watermark:      &addWatermark,
	}

	if resolution != "" {
		req.Size = &resolution
	}

	resp, err := s.client.GenerateImages(ctx, req)
	if err != nil {
		return "", fmt.Errorf("failed to generate image: %v", err)
	}

	if len(resp.Data) == 0 {
		return "", fmt.Errorf("no image returned from API")
	}

	// Decode base64 image
	b64Data := resp.Data[0].B64Json
	if b64Data == nil || *b64Data == "" {
		return "", fmt.Errorf("empty base64 data returned")
	}

	imgBytes, err := base64.StdEncoding.DecodeString(*b64Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 image: %v", err)
	}

	// Upload to OSS
	reader := bytes.NewReader(imgBytes)
	ossURL, err := s.ossService.UploadFile(reader, "image.png", "images")
	if err != nil {
		return "", fmt.Errorf("failed to upload image to OSS: %v", err)
	}

	return ossURL, nil
}
