package tools

import (
	"fmt"
	"time"

	"github.com/firebase/genkit/go/ai"
)

const GetTimeDescription = "Get the current date and time, or convert between timezones. Use this when the user asks about the current time, date, or time in a specific timezone. Input: {\"timezone\": \"optional timezone, e.g. Asia/Shanghai, America/New_York\"}. If no timezone is provided, returns UTC+8 (China Standard Time)."

func GetTimeFn(ctx *ai.ToolContext, input map[string]any) (map[string]any, error) {
	tz, _ := input["timezone"].(string)

	loc := time.FixedZone("CST", 8*3600)
	if tz != "" {
		var err error
		loc, err = time.LoadLocation(tz)
		if err != nil {
			return map[string]any{"error": fmt.Sprintf("invalid timezone: %s", tz)}, nil
		}
	}

	now := time.Now().In(loc)

	return map[string]any{
		"datetime":  now.Format("2006-01-02 15:04:05"),
		"date":      now.Format("2006-01-02"),
		"time":      now.Format("15:04:05"),
		"weekday":   now.Weekday().String(),
		"timezone":  loc.String(),
		"timestamp": now.Unix(),
	}, nil
}
