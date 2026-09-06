package services

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"gorm.io/gorm"
)

type CustomModelService struct {
	db  *database.MySQL
	key [32]byte
}

func NewCustomModelService(db *database.MySQL, encryptionSecret string) *CustomModelService {
	return &CustomModelService{db: db, key: sha256.Sum256([]byte(encryptionSecret))}
}

func (s *CustomModelService) Get(ctx context.Context, userID string) (*models.CustomModelConfig, error) {
	var cfg models.CustomModelConfig
	err := s.db.DB.WithContext(ctx).Where("user_id = ?", userID).First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &models.CustomModelConfig{UserID: userID}, nil
	}
	return &cfg, err
}

func (s *CustomModelService) Save(ctx context.Context, cfg *models.CustomModelConfig) error {
	return s.db.DB.WithContext(ctx).Save(cfg).Error
}

func (s *CustomModelService) Encrypt(plain string) (string, error) {
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func (s *CustomModelService) Decrypt(encoded string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted API key")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}

func ValidateCustomBaseURL(raw string) error {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return errors.New("base_url must be a valid HTTPS URL")
	}
	if strings.EqualFold(u.Hostname(), "localhost") {
		return errors.New("private hosts are not allowed")
	}
	addresses, err := net.LookupIP(u.Hostname())
	if err != nil {
		return fmt.Errorf("cannot resolve base_url host: %w", err)
	}
	for _, ip := range addresses {
		if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return errors.New("private or reserved addresses are not allowed")
		}
	}
	return nil
}

func isForbiddenOutboundIP(ip net.IP) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}

// NewSafeOutboundHTTPClient revalidates every connection and redirect to
// prevent localhost access, private-network access, and DNS rebinding.
func NewSafeOutboundHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	// Do not honor proxy environment variables: a proxy could otherwise fetch a
	// private destination on behalf of this server and bypass DialContext checks.
	transport := &http.Transport{}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if isForbiddenOutboundIP(ip) {
				continue
			}
			if conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port)); dialErr == nil {
				return conn, nil
			}
		}
		return nil, errors.New("target resolves only to private or reserved addresses")
	}
	return &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		return ValidateCustomBaseURL(req.URL.String())
	}}
}

type CustomModelRuntime struct {
	APIKey       string
	BaseURL      string
	Model        string
	ResponseMode string
}

func (s *CustomModelService) RuntimeForMode(ctx context.Context, userID, mode string, hasMultimodal bool) (*CustomModelRuntime, error) {
	if hasMultimodal {
		return nil, nil
	}
	cfg, err := s.Get(ctx, userID)
	if err != nil || !cfg.Enabled || cfg.ResponseMode == "" {
		return nil, err
	}
	enabled := (mode == "daily" && cfg.DailyEnabled) || (mode == "expert" && cfg.ExpertEnabled) || (strings.HasPrefix(mode, "search") && cfg.SearchEnabled)
	if !enabled || cfg.BaseURL == "" || cfg.Model == "" || cfg.APIKeyCiphertext == "" {
		return nil, nil
	}
	key, err := s.Decrypt(cfg.APIKeyCiphertext)
	if err != nil {
		return nil, err
	}
	return &CustomModelRuntime{APIKey: key, BaseURL: cfg.BaseURL, Model: cfg.Model, ResponseMode: cfg.ResponseMode}, nil
}
