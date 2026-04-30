package utils

import (
	"log"

	"github.com/pkoukk/tiktoken-go"
)

func CountTokens(text string) int {
	// Use o200k_base or cl100k_base which are commonly used for GPT-4o/GPT-3.5
	tkm, err := tiktoken.GetEncoding("cl100k_base")
	if err != nil {
		log.Printf("Error getting encoding: %v", err)
		return len(text) / 4 // Fallback estimation
	}
	token := tkm.Encode(text, nil, nil)
	return len(token)
}

func CalculateCredit(inputTokens, outputTokens int) float64 {
	// 汇率：输入 token * 0.001 + 输出 token * 0.004
	return (float64(inputTokens) * 0.001) + (float64(outputTokens) * 0.004)
}

func GetMemberLimits(memberType string, isCampaign bool, campaignCredits map[string]float64) (float64, float64) {
	var dailyLimit float64
	var warningThreshold float64

	if isCampaign && campaignCredits != nil {
		if val, ok := campaignCredits[memberType]; ok {
			dailyLimit = val
		}
	}

	if dailyLimit == 0 {
		switch memberType {
		case "pro":
			dailyLimit = 5000
		case "max":
			dailyLimit = 10000
		case "ultra":
			dailyLimit = 50000
		default:
			dailyLimit = 1000
		}
	}

	switch memberType {
	case "pro", "max":
		warningThreshold = 100
	case "ultra":
		warningThreshold = 200
	default:
		warningThreshold = 50
	}

	return dailyLimit, warningThreshold
}
