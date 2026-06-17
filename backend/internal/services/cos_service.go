package services

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"alchat-backend/internal/config"

	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
)

type COSService struct {
	client       *cos.Client
	bucketName   string
	region       string
	customDomain string
	secretID     string
	secretKey    string
}

func NewCOSService(cfg *config.Config) (*COSService, error) {
	if cfg.COSSecretID == "" || cfg.COSSecretKey == "" || cfg.COSBucket == "" || cfg.COSRegion == "" {
		return nil, fmt.Errorf("COS configuration is missing")
	}

	rawURL := fmt.Sprintf("https://%s.cos.%s.myqcloud.com", cfg.COSBucket, cfg.COSRegion)
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse COS URL: %v", err)
	}

	b := &cos.BaseURL{BucketURL: u}
	client := cos.NewClient(b, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  cfg.COSSecretID,
			SecretKey: cfg.COSSecretKey,
		},
	})

	fmt.Printf("[COS] Initialized with bucket: %s, region: %s, secretId prefix: %s...\n",
		cfg.COSBucket, cfg.COSRegion, cfg.COSSecretID[:5])

	return &COSService{
		client:       client,
		bucketName:   cfg.COSBucket,
		region:       cfg.COSRegion,
		customDomain: cfg.COSCustomDomain,
		secretID:     cfg.COSSecretID,
		secretKey:    cfg.COSSecretKey,
	}, nil
}

// getFinalURL constructs public URL using custom domain if available
func (s *COSService) getFinalURL(objectKey string) string {
	if s.customDomain != "" {
		domain := strings.TrimSuffix(strings.TrimPrefix(s.customDomain, "https://"), "/")
		return fmt.Sprintf("https://%s/%s", domain, objectKey)
	}
	return fmt.Sprintf("https://%s.cos.%s.myqcloud.com/%s", s.bucketName, s.region, objectKey)
}

// UploadHTML uploads raw HTML content to Tencent Cloud COS and returns public URL
func (s *COSService) UploadHTML(ctx context.Context, htmlContent string, filename string, folder string) (string, error) {
	objectKey := filename
	if folder != "" {
		objectKey = fmt.Sprintf("%s/%s", folder, filename)
	}

	opt := &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{
			ContentType:        "text/html; charset=utf-8",
			ContentDisposition: "inline",
		},
	}

	_, err := s.client.Object.Put(ctx, objectKey, strings.NewReader(htmlContent), opt)
	if err != nil {
		return "", fmt.Errorf("failed to upload HTML object: %v", err)
	}

	return s.getFinalURL(objectKey), nil
}

// UploadFile uploads a file to Tencent Cloud COS and returns public URL
func (s *COSService) UploadFile(file io.Reader, filename string, folder string) (string, error) {
	ext := filepath.Ext(filename)
	uniqueName := fmt.Sprintf("%s%s", uuid.New().String(), ext)

	objectKey := uniqueName
	if folder != "" {
		objectKey = fmt.Sprintf("%s/%s", folder, uniqueName)
	}

	_, err := s.client.Object.Put(context.Background(), objectKey, file, nil)
	if err != nil {
		return "", fmt.Errorf("failed to upload object: %v", err)
	}

	return s.getFinalURL(objectKey), nil
}

// DeleteFile deletes a file from Tencent Cloud COS
func (s *COSService) DeleteFile(objectKey string) error {
	_, err := s.client.Object.Delete(context.Background(), objectKey)
	if err != nil {
		return fmt.Errorf("failed to delete object: %v", err)
	}
	return nil
}

// GetSignedURL generates a signed URL for private access
func (s *COSService) GetSignedURL(objectKey string, expiration time.Duration) (string, error) {
	u, err := s.client.Object.GetPresignedURL(context.Background(), http.MethodGet, objectKey, s.secretID, s.secretKey, expiration, nil)
	if err != nil {
		return "", fmt.Errorf("failed to sign URL: %v", err)
	}
	return u.String(), nil
}

// GetPresignedPutURL generates a presigned URL for direct upload via PUT request
func (s *COSService) GetPresignedPutURL(ctx context.Context, folder, filename, contentType string) (string, string, error) {
	ext := filepath.Ext(filename)
	uniqueName := fmt.Sprintf("%s%s", uuid.New().String(), ext)

	objectKey := uniqueName
	if folder != "" {
		objectKey = fmt.Sprintf("%s/%s", folder, uniqueName)
	}

	opt := &cos.PresignedURLOptions{
		Query:  &url.Values{},
		Header: &http.Header{},
	}
	if contentType != "" {
		opt.Header.Set("Content-Type", contentType)
	}

	u, err := s.client.Object.GetPresignedURL(ctx, http.MethodPut, objectKey, s.secretID, s.secretKey, time.Hour, opt)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate presigned PUT URL: %v", err)
	}

	return u.String(), s.getFinalURL(objectKey), nil
}
