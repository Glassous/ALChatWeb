package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db         *database.MongoDB
	jwtSecret  string
	ossService *services.OSSService
}

func NewAuthHandler(db *database.MongoDB, jwtSecret string, ossService *services.OSSService) *AuthHandler {
	return &AuthHandler{
		db:         db,
		jwtSecret:  jwtSecret,
		ossService: ossService,
	}
}

func (h *AuthHandler) generateToken(userID primitive.ObjectID) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID.Hex(),
		"exp":     time.Now().Add(time.Hour * 24 * 7).Unix(), // 7 days
	})
	return token.SignedString([]byte(h.jwtSecret))
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Username == "" || req.Password == "" || req.ConfirmPassword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Username and password are required"})
		return
	}

	if req.Password != req.ConfirmPassword {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Passwords do not match"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var existingUser models.User
	err := h.db.Users().FindOne(ctx, bson.M{"username": req.Username}).Decode(&existingUser)
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Username already exists"})
		return
	} else if err != mongo.ErrNoDocuments {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	hashedAnswer, err := bcrypt.GenerateFromPassword([]byte(req.SecurityAnswer), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash security answer"})
		return
	}

	user := models.User{
		ID:               primitive.NewObjectID(),
		Username:         req.Username,
		Nickname:         req.Nickname,
		Password:         string(hashedPassword),
		SecurityQuestion: req.SecurityQuestion,
		SecurityAnswer:   string(hashedAnswer),
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}

	if user.Nickname == "" {
		user.Nickname = user.Username
	}

	_, err = h.db.Users().InsertOne(ctx, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	token, err := h.generateToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, models.AuthResponse{
		Token: token,
		User:  user,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var user models.User
	err := h.db.Users().FindOne(ctx, bson.M{"username": req.Username}).Decode(&user)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	token, err := h.generateToken(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, models.AuthResponse{
		Token: token,
		User:  user,
	})
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req models.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.NewPassword != req.ConfirmPassword {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Passwords do not match"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var user models.User
	err := h.db.Users().FindOne(ctx, bson.M{"username": req.Username}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.SecurityAnswer), []byte(req.SecurityAnswer))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid security answer"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	_, err = h.db.Users().UpdateOne(
		ctx,
		bson.M{"_id": user.ID},
		bson.M{"$set": bson.M{"password": string(hashedPassword), "updated_at": time.Now()}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password reset successfully"})
}

func (h *AuthHandler) GetSecurityQuestion(c *gin.Context) {
	username := c.Query("username")
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Username is required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var user models.User
	err := h.db.Users().FindOne(ctx, bson.M{"username": username}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"security_question": user.SecurityQuestion})
}

func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	userID, err := primitive.ObjectIDFromHex(userIDStr.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req struct {
		Nickname string `json:"nickname"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	_, err = h.db.Users().UpdateOne(
		ctx,
		bson.M{"_id": userID},
		bson.M{"$set": bson.M{"nickname": req.Nickname, "updated_at": time.Now()}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile updated successfully"})
}

func (h *AuthHandler) UpdateAvatar(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	userID, err := primitive.ObjectIDFromHex(userIDStr.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if h.ossService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OSS service not configured"})
		return
	}

	file, header, err := c.Request.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get avatar file"})
		return
	}
	defer file.Close()

	// Upload to OSS
	avatarURL, err := h.ossService.UploadFile(file, header.Filename, "avatars")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to upload avatar: %v", err)})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// 1. Find existing user to get old avatar URL
	var user models.User
	err = h.db.Users().FindOne(ctx, bson.M{"_id": userID}).Decode(&user)
	if err != nil {
		// Even if we fail to get the user, we should probably still try to update it,
		// but we won't be able to delete the old avatar.
		fmt.Printf("Warning: Failed to find user %s to get old avatar: %v\n", userID.Hex(), err)
	}
	oldAvatarURL := user.Avatar

	// 2. Update database with new avatar URL
	_, err = h.db.Users().UpdateOne(
		ctx,
		bson.M{"_id": userID},
		bson.M{"$set": bson.M{"avatar": avatarURL, "updated_at": time.Now()}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user avatar in database"})
		return
	}

	// 3. If update successful and old avatar exists, delete old avatar from OSS
	if oldAvatarURL != "" && strings.Contains(oldAvatarURL, "aliyuncs.com") {
		// Extract object key from URL
		// Example URL: https://bucket-name.oss-cn-beijing.aliyuncs.com/avatars/123.jpg
		// We need to extract: avatars/123.jpg

		// Find the index after ".com/"
		idx := strings.Index(oldAvatarURL, ".com/")
		if idx != -1 {
			objectKey := oldAvatarURL[idx+5:]

			// Run deletion asynchronously so it doesn't block the response
			go func(key string) {
				delErr := h.ossService.DeleteFile(key)
				if delErr != nil {
					fmt.Printf("Failed to delete old avatar from OSS (key: %s): %v\n", key, delErr)
				} else {
					fmt.Printf("Successfully deleted old avatar from OSS: %s\n", key)
				}
			}(objectKey)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Avatar updated successfully",
		"avatar":  avatarURL,
	})
}
