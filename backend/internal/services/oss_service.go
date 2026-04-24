package services

import (
	"fmt"
	"io"
	"path/filepath"
	"time"

	"alchat-backend/internal/config"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/google/uuid"
)

type OSSService struct {
	client     *oss.Client
	bucketName string
	endpoint   string
}

func NewOSSService(cfg *config.Config) (*OSSService, error) {
	if cfg.OSSAccessKeyID == "" || cfg.OSSAccessKeySecret == "" || cfg.OSSEndpoint == "" || cfg.OSSBucketName == "" {
		return nil, fmt.Errorf("OSS configuration is missing")
	}

	client, err := oss.New(cfg.OSSEndpoint, cfg.OSSAccessKeyID, cfg.OSSAccessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("failed to create OSS client: %v", err)
	}

	// Test the connection by getting bucket info (optional but helpful for debugging)
	// We don't do it here to avoid blocking startup if network is slow
	
	fmt.Printf("[OSS] Initialized with endpoint: %s, bucket: %s, keyId prefix: %s...\n", 
		cfg.OSSEndpoint, cfg.OSSBucketName, cfg.OSSAccessKeyID[:5])

	return &OSSService{
		client:     client,
		bucketName: cfg.OSSBucketName,
		endpoint:   cfg.OSSEndpoint,
	}, nil
}

// UploadFile uploads a file to Aliyun OSS and returns the public URL
func (s *OSSService) UploadFile(file io.Reader, filename string, folder string) (string, error) {
	bucket, err := s.client.Bucket(s.bucketName)
	if err != nil {
		return "", fmt.Errorf("failed to get bucket: %v", err)
	}

	// Generate a unique filename to avoid collisions
	ext := filepath.Ext(filename)
	uniqueName := fmt.Sprintf("%s%s", uuid.New().String(), ext)
	
	objectKey := uniqueName
	if folder != "" {
		objectKey = fmt.Sprintf("%s/%s", folder, uniqueName)
	}

	err = bucket.PutObject(objectKey, file)
	if err != nil {
		return "", fmt.Errorf("failed to upload object: %v", err)
	}

	// Construct the public URL
	// Note: This assumes the bucket is publicly readable or uses a custom domain
	url := fmt.Sprintf("https://%s.%s/%s", s.bucketName, s.endpoint, objectKey)
	return url, nil
}

// DeleteFile deletes a file from Aliyun OSS
func (s *OSSService) DeleteFile(objectKey string) error {
	bucket, err := s.client.Bucket(s.bucketName)
	if err != nil {
		return fmt.Errorf("failed to get bucket: %v", err)
	}

	err = bucket.DeleteObject(objectKey)
	if err != nil {
		return fmt.Errorf("failed to delete object: %v", err)
	}

	return nil
}

// GetSignedURL generates a signed URL for private access
func (s *OSSService) GetSignedURL(objectKey string, expiration time.Duration) (string, error) {
	bucket, err := s.client.Bucket(s.bucketName)
	if err != nil {
		return "", fmt.Errorf("failed to get bucket: %v", err)
	}

	signedURL, err := bucket.SignURL(objectKey, oss.HTTPGet, int64(expiration.Seconds()))
	if err != nil {
		return "", fmt.Errorf("failed to sign URL: %v", err)
	}

	return signedURL, nil
}
