package main

import (
	"context"
	"log"
	"time"

	"alchat-backend/internal/config"
	"alchat-backend/internal/database"
	"alchat-backend/internal/models"

	"go.mongodb.org/mongo-driver/bson"
)

func main() {
	log.Println("Starting data migration from MongoDB to MySQL...")

	// 1. Load configuration
	cfg := config.Load()

	// 2. Connect to MongoDB
	mongoDB, err := database.NewMongoDB(cfg.MongoDBURI, cfg.MongoDBDatabase)
	if err != nil {
		log.Fatalf("Failed to connect to MongoDB: %v", err)
	}
	defer mongoDB.Close()

	// 3. Connect to MySQL
	mysqlDB, err := database.NewMySQL(cfg.MySQLDSN, true)
	if err != nil {
		log.Fatalf("Failed to connect to MySQL: %v", err)
	}
	defer mysqlDB.Close()

	// 4. Auto Migrate schemas
	log.Println("Migrating database schemas in MySQL...")
	err = mysqlDB.DB.AutoMigrate(
		&models.User{},
		&models.ModelConfig{},
		&models.Announcement{},
		&models.Feedback{},
	)
	if err != nil {
		log.Fatalf("MySQL schema migration failed: %v", err)
	}

	ctx := context.Background()

	// 5. Migrate Users
	migrateUsers(ctx, mongoDB, mysqlDB)

	// 6. Migrate Configs
	migrateConfigs(ctx, mongoDB, mysqlDB)

	// 7. Migrate Announcements
	migrateAnnouncements(ctx, mongoDB, mysqlDB)

	// 8. Migrate Feedbacks
	migrateFeedbacks(ctx, mongoDB, mysqlDB)

	log.Println("Data migration completed successfully!")
}

func migrateUsers(ctx context.Context, mongoDB *database.MongoDB, mysqlDB *database.MySQL) {
	log.Println("Migrating Users...")
	cursor, err := mongoDB.Users().Find(ctx, bson.M{})
	if err != nil {
		log.Fatalf("Failed to query users from MongoDB: %v", err)
	}
	defer cursor.Close(ctx)

	var mongoUsers []models.User
	if err := cursor.All(ctx, &mongoUsers); err != nil {
		log.Fatalf("Failed to decode users: %v", err)
	}

	total := len(mongoUsers)
	log.Printf("Found %d users in MongoDB.", total)

	if total == 0 {
		return
	}

	successCount := 0
	for _, user := range mongoUsers {
		// Use transaction/Save to upsert
		err := mysqlDB.DB.Save(&user).Error
		if err != nil {
			log.Printf("Failed to migrate user %s (%s): %v", user.ID.Hex(), user.Email, err)
		} else {
			successCount++
		}
	}
	log.Printf("Successfully migrated %d/%d users to MySQL.", successCount, total)
}

func migrateConfigs(ctx context.Context, mongoDB *database.MongoDB, mysqlDB *database.MySQL) {
	log.Println("Migrating Configs...")
	cursor, err := mongoDB.Configs().Find(ctx, bson.M{})
	if err != nil {
		log.Fatalf("Failed to query configs from MongoDB: %v", err)
	}
	defer cursor.Close(ctx)

	var mongoConfigs []models.ModelConfig
	if err := cursor.All(ctx, &mongoConfigs); err != nil {
		log.Fatalf("Failed to decode configs: %v", err)
	}

	total := len(mongoConfigs)
	log.Printf("Found %d configs in MongoDB.", total)

	if total == 0 {
		return
	}

	successCount := 0
	for _, cfg := range mongoConfigs {
		cfg.UpdatedAt = time.Now()
		err := mysqlDB.DB.Save(&cfg).Error
		if err != nil {
			log.Printf("Failed to migrate config %s: %v", cfg.Mode, err)
		} else {
			successCount++
		}
	}
	log.Printf("Successfully migrated %d/%d configs to MySQL.", successCount, total)
}

func migrateAnnouncements(ctx context.Context, mongoDB *database.MongoDB, mysqlDB *database.MySQL) {
	log.Println("Migrating Announcements...")
	cursor, err := mongoDB.Collection("announcements").Find(ctx, bson.M{})
	if err != nil {
		log.Printf("No announcements or failed to query announcements from MongoDB: %v", err)
		return
	}
	defer cursor.Close(ctx)

	var mongoAnns []models.Announcement
	if err := cursor.All(ctx, &mongoAnns); err != nil {
		log.Printf("Failed to decode announcements: %v", err)
		return
	}

	total := len(mongoAnns)
	log.Printf("Found %d announcements in MongoDB.", total)

	if total == 0 {
		return
	}

	successCount := 0
	for _, ann := range mongoAnns {
		err := mysqlDB.DB.Save(&ann).Error
		if err != nil {
			log.Printf("Failed to migrate announcement %s (%s): %v", ann.ID.Hex(), ann.Title, err)
		} else {
			successCount++
		}
	}
	log.Printf("Successfully migrated %d/%d announcements to MySQL.", successCount, total)
}

func migrateFeedbacks(ctx context.Context, mongoDB *database.MongoDB, mysqlDB *database.MySQL) {
	log.Println("Migrating Feedbacks...")
	cursor, err := mongoDB.Collection("feedbacks").Find(ctx, bson.M{})
	if err != nil {
		log.Printf("No feedbacks or failed to query feedbacks from MongoDB: %v", err)
		return
	}
	defer cursor.Close(ctx)

	var mongoFeedbacks []models.Feedback
	if err := cursor.All(ctx, &mongoFeedbacks); err != nil {
		log.Printf("Failed to decode feedbacks: %v", err)
		return
	}

	total := len(mongoFeedbacks)
	log.Printf("Found %d feedbacks in MongoDB.", total)

	if total == 0 {
		return
	}

	successCount := 0
	for _, fb := range mongoFeedbacks {
		err := mysqlDB.DB.Save(&fb).Error
		if err != nil {
			log.Printf("Failed to migrate feedback %s (%s): %v", fb.ID.Hex(), fb.UserEmail, err)
		} else {
			successCount++
		}
	}
	log.Printf("Successfully migrated %d/%d feedbacks to MySQL.", successCount, total)
}
