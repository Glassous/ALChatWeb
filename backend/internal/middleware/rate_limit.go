package middleware

import (
	"alchat-backend/internal/database"
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter returns a middleware that limits requests to 10 per minute
func RateLimiter(rdb *database.Redis, limit int, duration time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		// If Redis is not available, skip rate limiting
		if rdb == nil || rdb.Client == nil {
			c.Next()
			return
		}

		ctx := context.Background()

		// Identify the user by UserID (if logged in) or ClientIP
		var identifier string
		userID, exists := c.Get("user_id")
		if exists {
			identifier = fmt.Sprintf("user:%v", userID)
		} else {
			identifier = fmt.Sprintf("ip:%s", c.ClientIP())
		}

		key := fmt.Sprintf("ratelimit:%s:%s", c.FullPath(), identifier)

		// Increment the count in Redis
		count, err := rdb.Client.Incr(ctx, key).Result()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Rate limit service error"})
			c.Abort()
			return
		}

		// Set expiration if it's the first request in the window
		if count == 1 {
			rdb.Client.Expire(ctx, key, duration)
		}

		// Check if limit exceeded
		if count > int64(limit) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests. Please try again in a minute.",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
