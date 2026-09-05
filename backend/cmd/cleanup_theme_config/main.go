package main

import (
	"context"
	"log"
	"time"

	"alchat-backend/internal/config"
	"alchat-backend/internal/database"

	"go.mongodb.org/mongo-driver/bson"
)

// This command is intentionally separate from server startup. Run it once before
// deploying the backend version that no longer exposes theme_config.
func main() {
	cfg := config.Load()

	mysqlDB, err := database.NewMySQL(cfg.MySQLDSN, false)
	if err != nil {
		log.Fatalf("connect to MySQL: %v", err)
	}
	defer mysqlDB.Close()

	if mysqlDB.DB.Migrator().HasColumn("users", "theme_config") {
		if err := mysqlDB.DB.Migrator().DropColumn("users", "theme_config"); err != nil {
			log.Fatalf("drop users.theme_config: %v", err)
		}
		log.Println("removed MySQL users.theme_config")
	} else {
		log.Println("MySQL users.theme_config is already absent")
	}

	mongoDB, err := database.NewMongoDB(cfg.MongoDBURI, cfg.MongoDBDatabase)
	if err != nil {
		log.Fatalf("connect to MongoDB: %v", err)
	}
	defer mongoDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := mongoDB.Users().UpdateMany(ctx, bson.M{"theme_config": bson.M{"$exists": true}}, bson.M{"$unset": bson.M{"theme_config": ""}})
	if err != nil {
		log.Fatalf("remove MongoDB users.theme_config: %v", err)
	}
	log.Printf("removed theme_config from %d MongoDB user documents", result.ModifiedCount)
}
