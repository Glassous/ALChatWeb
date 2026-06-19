package database

import (
	"log"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type MySQL struct {
	DB *gorm.DB
}

func NewMySQL(dsn string, debug bool) (*MySQL, error) {
	logLogLevel := logger.Silent
	if debug {
		logLogLevel = logger.Info
	}

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logLogLevel),
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// Set connection pool settings
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	log.Println("Connected to MySQL successfully")

	return &MySQL{
		DB: db,
	}, nil
}

func (m *MySQL) Close() error {
	sqlDB, err := m.DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
