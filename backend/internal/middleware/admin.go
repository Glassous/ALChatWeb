package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const RoleKey = "role"

func AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// This middleware assumes AuthMiddleware has already run
		// and stored claims or token in the context if we needed full validation here.
		// However, for simplicity and performance, we can extract role from claims
		// that AuthMiddleware should have already verified.

		// We need to update AuthMiddleware to set the role in context too.
		role, exists := c.Get(RoleKey)
		if !exists || role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			c.Abort()
			return
		}

		c.Next()
	}
}
