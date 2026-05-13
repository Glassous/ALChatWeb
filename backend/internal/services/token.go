package services

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type TokenService struct {
	jwtSecret string
}

func NewTokenService(jwtSecret string) *TokenService {
	return &TokenService{
		jwtSecret: jwtSecret,
	}
}

func (s *TokenService) GenerateToken(userID string, role string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"role":    role,
		"jti":     uuid.New().String(),
		"exp":     time.Now().Add(time.Hour * 24 * 7).Unix(), // 7 days
	})
	return token.SignedString([]byte(s.jwtSecret))
}

func (s *TokenService) ParseToken(tokenStr string) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.jwtSecret), nil
	})

	if err != nil || !token.Valid {
		return nil, err
	}

	return claims, nil
}
