package tools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/firebase/genkit/go/ai"
)

const WeatherDescription = `Get weather information for a location. Input: {"location": "city name"} or {"latitude": 0.0, "longitude": 0.0}.
When user mentions a city name (e.g. "北京", "Shanghai"), use the location field.
IMPORTANT: After receiving weather data, you MUST include a <weather> tag in your response with the exact JSON data returned by this tool. Example:
<weather>{"location":"北京","current":{"temp":25,"feels_like":27,"humidity":60,"condition":"晴","wind_speed":10,"wind_direction":180,"precipitation":0,"cloud_cover":20},"forecast":[{"date":"2026-05-02","high":28,"low":18,"condition":"晴","precipitation":0},{"date":"2026-05-03","high":26,"low":17,"condition":"多云","precipitation":2}]}</weather>
Copy the "weather_data" field from the tool result directly into the tag.`

type geocodingResult struct {
	Results []struct {
		Name      string  `json:"name"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Country   string  `json:"country"`
	} `json:"results"`
}

type weatherAPIResult struct {
	Current struct {
		Time                string  `json:"time"`
		Temperature         float64 `json:"temperature_2m"`
		Humidity            int     `json:"relative_humidity_2m"`
		ApparentTemperature float64 `json:"apparent_temperature"`
		Precipitation       float64 `json:"precipitation"`
		CloudCover          int     `json:"cloud_cover"`
		WindSpeed           float64 `json:"wind_speed_10m"`
		WindDirection       int     `json:"wind_direction_10m"`
		WeatherCode         int     `json:"weather_code"`
	} `json:"current"`
	Daily struct {
		Time         []string  `json:"time"`
		MaxTemp      []float64 `json:"temperature_2m_max"`
		MinTemp      []float64 `json:"temperature_2m_min"`
		PrecipSum    []float64 `json:"precipitation_sum"`
		WeatherCode  []int     `json:"weather_code"`
		WindSpeedMax []float64 `json:"wind_speed_10m_max"`
	} `json:"daily"`
}

func WeatherFn(ctx *ai.ToolContext, input map[string]any) (map[string]any, error) {
	location, _ := input["location"].(string)
	lat, _ := input["latitude"].(float64)
	lon, _ := input["longitude"].(float64)

	var latitude, longitude float64
	var locationName string

	if location != "" {
		geoURL := fmt.Sprintf("https://geocoding-api.open-meteo.com/v1/search?name=%s&count=1&language=zh", url.QueryEscape(location))
		req, err := http.NewRequestWithContext(ctx, "GET", geoURL, nil)
		if err != nil {
			return map[string]any{"error": fmt.Sprintf("geocoding request failed: %v", err)}, nil
		}

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			return map[string]any{"error": fmt.Sprintf("geocoding failed: %v", err)}, nil
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		var geo geocodingResult
		if err := json.Unmarshal(body, &geo); err != nil || len(geo.Results) == 0 {
			return map[string]any{"error": fmt.Sprintf("location '%s' not found", location)}, nil
		}

		latitude = geo.Results[0].Latitude
		longitude = geo.Results[0].Longitude
		locationName = geo.Results[0].Name + ", " + geo.Results[0].Country
	} else if lat != 0 || lon != 0 {
		latitude = lat
		longitude = lon
		locationName = fmt.Sprintf("%.4f, %.4f", lat, lon)
	} else {
		return map[string]any{"error": "no location provided. Please provide a location name or latitude/longitude coordinates."}, nil
	}

	weatherURL := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max&forecast_days=7",
		latitude, longitude,
	)
	req, err := http.NewRequestWithContext(ctx, "GET", weatherURL, nil)
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("weather request failed: %v", err)}, nil
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("weather fetch failed: %v", err)}, nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var weather weatherAPIResult
	if err := json.Unmarshal(body, &weather); err != nil {
		return map[string]any{"error": "failed to parse weather data"}, nil
	}

	currentCondition := wmoToCondition(weather.Current.WeatherCode)

	forecast := make([]map[string]any, 0, len(weather.Daily.Time))
	for i, date := range weather.Daily.Time {
		dayCondition := "Unknown"
		if i < len(weather.Daily.WeatherCode) {
			dayCondition = wmoToCondition(weather.Daily.WeatherCode[i])
		}
		day := map[string]any{
			"date":      date,
			"high":      weather.Daily.MaxTemp[i],
			"low":       weather.Daily.MinTemp[i],
			"condition": dayCondition,
		}
		if i < len(weather.Daily.PrecipSum) {
			day["precipitation"] = weather.Daily.PrecipSum[i]
		}
		if i < len(weather.Daily.WindSpeedMax) {
			day["wind_speed_max"] = weather.Daily.WindSpeedMax[i]
		}
		forecast = append(forecast, day)
	}

	weatherData := map[string]any{
		"location": locationName,
		"current": map[string]any{
			"temp":           weather.Current.Temperature,
			"feels_like":     weather.Current.ApparentTemperature,
			"humidity":       weather.Current.Humidity,
			"condition":      currentCondition,
			"wind_speed":     weather.Current.WindSpeed,
			"wind_direction": weather.Current.WindDirection,
			"precipitation":  weather.Current.Precipitation,
			"cloud_cover":    weather.Current.CloudCover,
		},
		"forecast": forecast,
	}

	weatherJSON, _ := json.Marshal(weatherData)

	return map[string]any{
		"weather_data": string(weatherJSON),
		"summary": fmt.Sprintf("Current weather in %s: %s, %.1f°C (feels like %.1f°C), humidity %d%%, wind %.1f km/h. 7-day forecast included.",
			locationName, currentCondition, weather.Current.Temperature, weather.Current.ApparentTemperature, weather.Current.Humidity, weather.Current.WindSpeed),
	}, nil
}

func wmoToCondition(code int) string {
	switch {
	case code == 0:
		return "晴"
	case code <= 3:
		return "多云"
	case code <= 49:
		return "雾"
	case code <= 59:
		return "毛毛雨"
	case code <= 69:
		return "雨"
	case code <= 79:
		return "雪"
	case code <= 82:
		return "阵雨"
	case code <= 86:
		return "阵雪"
	case code <= 99:
		return "雷暴"
	default:
		return "未知"
	}
}
