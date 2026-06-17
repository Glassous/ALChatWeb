package handlers

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"alchat-backend/internal/database"
	"alchat-backend/internal/models"
	"alchat-backend/internal/services"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db            *database.MongoDB
	rdb           *database.Redis
	jwtSecret     string
	ossService    *services.COSService
	memberService *services.MemberService
	tokenService  *services.TokenService
	emailService  *services.EmailService
}

func NewAuthHandler(db *database.MongoDB, rdb *database.Redis, jwtSecret string, ossService *services.COSService, memberService *services.MemberService, tokenService *services.TokenService, emailService *services.EmailService) *AuthHandler {
	return &AuthHandler{
		db:            db,
		rdb:           rdb,
		jwtSecret:     jwtSecret,
		ossService:    ossService,
		memberService: memberService,
		tokenService:  tokenService,
		emailService:  emailService,
	}
}

func (h *AuthHandler) Logout(c *gin.Context) {
	jti, _ := c.Get("jti")
	exp, _ := c.Get("exp")

	if jti != nil && exp != nil {
		jtiStr := jti.(string)
		expTime := time.Unix(exp.(int64), 0)
		ttl := time.Until(expTime)

		if ttl > 0 {
			err := h.rdb.Client.Set(c.Request.Context(), fmt.Sprintf("blacklist:%s", jtiStr), "1", ttl).Err()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to logout"})
				return
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

func (h *AuthHandler) generateToken(userID primitive.ObjectID, role string) (string, error) {
	return h.tokenService.GenerateToken(userID.Hex(), role)
}

func (h *AuthHandler) generateCode() string {
	const charset = "0123456789"
	b := make([]byte, 6)
	for i := range b {
		num, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		b[i] = charset[num.Int64()]
	}
	return string(b)
}

func (h *AuthHandler) SendCode(c *gin.Context) {
	var req models.SendCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check rate limit (1 minute)
	limitKey := fmt.Sprintf("email_limit:%s", req.Email)
	exists, _ := h.rdb.Client.Exists(c.Request.Context(), limitKey).Result()
	if exists > 0 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Please wait a minute before requesting another code"})
		return
	}

	// If resetting password, check if user exists
	if req.Scene == "reset" {
		var user models.User
		err := h.db.Users().FindOne(c.Request.Context(), bson.M{"email": req.Email}).Decode(&user)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User with this email not found"})
			return
		}
	}

	code := h.generateCode()
	err := h.emailService.SendVerificationCode(req.Email, code)
	if err != nil {
		fmt.Printf("Failed to send email to %s: %v\n", req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send email: " + err.Error()})
		return
	}

	// Store code in Redis (10 minutes)
	verifyKey := fmt.Sprintf("email_verify:%s", req.Email)
	h.rdb.Client.Set(c.Request.Context(), verifyKey, code, 10*time.Minute)
	h.rdb.Client.Set(c.Request.Context(), limitKey, "1", 1*time.Minute)

	c.JSON(http.StatusOK, gin.H{"message": "Verification code sent"})
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify code
	verifyKey := fmt.Sprintf("email_verify:%s", req.Email)
	storedCode, err := h.rdb.Client.Get(c.Request.Context(), verifyKey).Result()
	if err != nil || storedCode != req.Code {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid or expired verification code"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// Check if email already exists
	var existingUser models.User
	err = h.db.Users().FindOne(ctx, bson.M{"email": req.Email}).Decode(&existingUser)
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Email already registered"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	nickname := req.Nickname
	if nickname == "" {
		nickname = req.Email
	}

	user := models.User{
		ID:                primitive.NewObjectID(),
		Email:             req.Email,
		Nickname:          nickname,
		Password:          string(hashedPassword),
		Role:              "user", // Standard registration only creates "user"
		MemberType:        "free",
		Credits:           1000,
		LastCreditResetAt: time.Now(),
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}

	_, err = h.db.Users().InsertOne(ctx, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	// Delete code after successful registration
	h.rdb.Client.Del(c.Request.Context(), verifyKey)

	token, err := h.generateToken(user.ID, user.Role)
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
	err := h.db.Users().FindOne(ctx, bson.M{"email": req.Email}).Decode(&user)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Reset credits if needed
	if err := h.memberService.CheckAndResetCredits(ctx, &user); err != nil {
		fmt.Printf("Failed to reset credits during login: %v\n", err)
	}

	token, err := h.generateToken(user.ID, user.Role)
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

	// Verify code
	verifyKey := fmt.Sprintf("email_verify:%s", req.Email)
	storedCode, err := h.rdb.Client.Get(c.Request.Context(), verifyKey).Result()
	if err != nil || storedCode != req.Code {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid or expired verification code"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	result, err := h.db.Users().UpdateOne(
		ctx,
		bson.M{"email": req.Email},
		bson.M{"$set": bson.M{"password": string(hashedPassword), "updated_at": time.Now()}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
	}

	if result.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "User with this email not found"})
		return
	}

	// Delete code after success
	h.rdb.Client.Del(c.Request.Context(), verifyKey)

	c.JSON(http.StatusOK, gin.H{"message": "Password reset successfully"})
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
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "COS service not configured"})
		return
	}

	// 1. Check if request is JSON containing the direct upload URL
	if strings.Contains(c.GetHeader("Content-Type"), "application/json") {
		var req struct {
			AvatarURL string `json:"avatar_url" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()

		var user models.User
		err = h.db.Users().FindOne(ctx, bson.M{"_id": userID}).Decode(&user)
		if err != nil {
			fmt.Printf("Warning: Failed to find user %s to get old avatar: %v\n", userID.Hex(), err)
		}
		oldAvatarURL := user.Avatar

		_, err = h.db.Users().UpdateOne(
			ctx,
			bson.M{"_id": userID},
			bson.M{"$set": bson.M{"avatar": req.AvatarURL, "updated_at": time.Now()}},
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user avatar in database"})
			return
		}

		// Delete old avatar from COS asynchronously
		if oldAvatarURL != "" {
			go func(oldURL string) {
				u, err := url.Parse(oldURL)
				if err == nil {
					key := strings.TrimPrefix(u.Path, "/")
					if key != "" {
						_ = h.ossService.DeleteFile(key)
					}
				}
			}(oldAvatarURL)
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "Avatar updated successfully",
			"avatar":  req.AvatarURL,
		})
		return
	}

	// 2. Original multipart file upload flow (fallback/admin usage)
	const maxFileSize = 15 * 1024 * 1024 // 15MB

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse multipart form"})
		return
	}

	files := form.File["avatar"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No avatar file provided"})
		return
	}

	if len(files) > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Too many files. Maximum 5 files allowed"})
		return
	}

	header := files[0] // Only take the first one for avatar

	if header.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File size exceeds 15MB limit"})
		return
	}

	file, err := header.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to open avatar file"})
		return
	}
	defer file.Close()

	buffer := make([]byte, 512)
	_, err = file.Read(buffer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file header"})
		return
	}
	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset file pointer"})
		return
	}

	contentType := http.DetectContentType(buffer)
	validTypes := map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/webp": true,
		"image/gif":  true,
	}

	if !validTypes[contentType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file type. Only JPEG, PNG, WEBP and GIF are allowed"})
		return
	}

	// Upload to COS
	avatarURL, err := h.ossService.UploadFile(file, header.Filename, "avatars")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to upload avatar: %v", err)})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var user models.User
	err = h.db.Users().FindOne(ctx, bson.M{"_id": userID}).Decode(&user)
	if err != nil {
		fmt.Printf("Warning: Failed to find user %s to get old avatar: %v\n", userID.Hex(), err)
	}
	oldAvatarURL := user.Avatar

	_, err = h.db.Users().UpdateOne(
		ctx,
		bson.M{"_id": userID},
		bson.M{"$set": bson.M{"avatar": avatarURL, "updated_at": time.Now()}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user avatar in database"})
		return
	}

	if oldAvatarURL != "" {
		go func(oldURL string) {
			u, err := url.Parse(oldURL)
			if err == nil {
				key := strings.TrimPrefix(u.Path, "/")
				if key != "" {
					_ = h.ossService.DeleteFile(key)
				}
			}
		}(oldAvatarURL)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Avatar updated successfully",
		"avatar":  avatarURL,
	})
}

func (h *AuthHandler) Upgrade(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	userID, _ := primitive.ObjectIDFromHex(userIDStr.(string))

	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	memberType, err := h.memberService.UpgradeWithInvitationCode(c.Request.Context(), userID, req.Code)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid or used invitation code"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upgrade"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Successfully upgraded", "member_type": memberType})
}

func (h *AuthHandler) GetProfile(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	userID, _ := primitive.ObjectIDFromHex(userIDStr.(string))

	var user models.User
	err := h.db.Users().FindOne(c.Request.Context(), bson.M{"_id": userID}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch profile"})
		return
	}

	// Reset credits if needed
	if err := h.memberService.CheckAndResetCredits(c.Request.Context(), &user); err != nil {
		fmt.Printf("Failed to reset credits: %v\n", err)
	}

	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) GetSystemPrompt(c *gin.Context) {
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var user models.User
	err = h.db.Users().FindOne(ctx, bson.M{"_id": userID}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"system_prompt":    user.SystemPrompt,
		"include_datetime": user.IncludeDateTime,
		"include_location": user.IncludeLocation,
	})
}

func (h *AuthHandler) UpdateSystemPrompt(c *gin.Context) {
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
		SystemPrompt    string `json:"system_prompt"`
		IncludeDateTime bool   `json:"include_datetime"`
		IncludeLocation bool   `json:"include_location"`
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
		bson.M{"$set": bson.M{
			"system_prompt":    req.SystemPrompt,
			"include_datetime": req.IncludeDateTime,
			"include_location": req.IncludeLocation,
			"updated_at":       time.Now(),
		}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update system prompt"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "System prompt updated successfully"})
}

func (h *AuthHandler) UpdateTheme(c *gin.Context) {
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

	var req models.ThemeConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	_, err = h.db.Users().UpdateOne(
		ctx,
		bson.M{"_id": userID},
		bson.M{"$set": bson.M{
			"theme_config": req,
			"updated_at":   time.Now(),
		}},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update theme config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Theme updated successfully"})
}
