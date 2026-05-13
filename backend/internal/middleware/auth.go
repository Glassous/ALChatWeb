package middleware

import (
	"alchat-backend/internal/database"
	"alchat-backend/internal/services"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const UserIDKey = "user_id"

func AuthMiddleware(tokenService *services.TokenService, rdb *database.Redis) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}

		tokenStr := parts[1]
		claims, err := tokenService.ParseToken(tokenStr)

		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		// Check if token is blacklisted in Redis
		if rdb != nil && rdb.Client != nil {
			if jti, ok := claims["jti"].(string); ok {
				blacklisted, err := rdb.Client.Exists(context.Background(), fmt.Sprintf("blacklist:%s", jti)).Result()
				if err == nil && blacklisted > 0 {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "Token has been revoked"})
					c.Abort()
					return
				}
			}
		}

		userIDStr, ok := claims["user_id"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
			return
		}

		role, _ := claims["role"].(string)

		// Sliding expiration: if token expires in less than 2 days, issue a new one
		if exp, ok := claims["exp"].(float64); ok {
			expiryTime := time.Unix(int64(exp), 0)
			if time.Until(expiryTime) < 24*2*time.Hour {
				newToken, err := tokenService.GenerateToken(userIDStr, role)
				if err == nil {
					c.Header("X-New-Token", newToken)
					c.Header("Access-Control-Expose-Headers", "X-New-Token")
				}
			}
		}

		c.Set(UserIDKey, userIDStr)
		c.Set("role", role)
		if jti, ok := claims["jti"].(string); ok {
			c.Set("jti", jti)
		}
		if exp, ok := claims["exp"].(float64); ok {
			c.Set("exp", int64(exp))
		}
		c.Next()
	}
}
