package tools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/firebase/genkit/go/ai"
)

const WeatherDescription = "Get current weather information for a location. Use this when the user asks about weather, temperature, or atmospheric conditions. Input: {\"location\": \"city name\", \"latitude\": 0.0, \"longitude\": 0.0}. Priority: location text > latitude/longitude > error. If user mentions a specific place in their message, use the location field. If no place is mentioned (e.g. 'what's the weather today'), use latitude and longitude."

type geocodingResult struct {
	Results []struct {
		Name      string  `json:"name"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Country   string  `json:"country"`
	} `json:"results"`
}

type weatherResult struct {
	CurrentWeather struct {
		Temperature   float64 `json:"temperature"`
		Windspeed     float64 `json:"windspeed"`
		Winddirection float64 `json:"winddirection"`
		Weathercode   int     `json:"weathercode"`
		Time          string  `json:"time"`
	} `json:"current_weather"`
}

func WeatherFn(ctx *ai.ToolContext, input map[string]any) (map[string]any, error) {
	location, _ := input["location"].(string)
	lat, _ := input["latitude"].(float64)
	lon, _ := input["longitude"].(float64)

	var latitude, longitude float64
	var locationName string

	if location != "" {
		geoURL := fmt.Sprintf("https://geocoding-api.open-meteo.com/v1/search?name=%s&count=1", url.QueryEscape(location))
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

	weatherURL := fmt.Sprintf("https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f&current_weather=true", latitude, longitude)
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
	var weather weatherResult
	if err := json.Unmarshal(body, &weather); err != nil {
		return map[string]any{"error": "failed to parse weather data"}, nil
	}

	wmoCode := weather.CurrentWeather.Weathercode
	condition := wmoToCondition(wmoCode)

	return map[string]any{
		"location":    locationName,
		"temperature": weather.CurrentWeather.Temperature,
		"windspeed":   weather.CurrentWeather.Windspeed,
		"condition":   condition,
		"time":        weather.CurrentWeather.Time,
	}, nil
}

func wmoToCondition(code int) string {
	switch {
	case code == 0:
		return "Clear sky"
	case code <= 3:
		return "Partly cloudy"
	case code <= 49:
		return "Fog"
	case code <= 59:
		return "Drizzle"
	case code <= 69:
		return "Rain"
	case code <= 79:
		return "Snow"
	case code <= 82:
		return "Rain showers"
	case code <= 86:
		return "Snow showers"
	case code <= 99:
		return "Thunderstorm"
	default:
		return "Unknown"
	}
}
