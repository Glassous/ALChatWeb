package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var coordRegex = regexp.MustCompile(`^\d+\.?\d*\s*,\s*\d+\.?\d*$`)

type LocationHandler struct{}

func NewLocationHandler() *LocationHandler {
	return &LocationHandler{}
}

type nominatimAddress struct {
	Country     string `json:"country"`
	State       string `json:"state"`
	City        string `json:"city"`
	Town        string `json:"town"`
	Village     string `json:"village"`
	Suburb      string `json:"suburb"`
	District    string `json:"district"`
	Neighbourhood string `json:"neighbourhood"`
	Road        string `json:"road"`
	HouseNumber string `json:"house_number"`
}

type nominatimResponse struct {
	Address nominatimAddress `json:"address"`
}

func (h *LocationHandler) Resolve(c *gin.Context) {
	var req struct {
		Lat float64 `json:"lat" binding:"required"`
		Lng float64 `json:"lng" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lat and lng are required"})
		return
	}

	address, err := reverseGeocode(req.Lat, req.Lng)
	if err != nil {
		log.Printf("Nominatim geocode failed: %v", err)
		address = fmt.Sprintf("%.6f, %.6f", req.Lat, req.Lng)
	}

	c.JSON(http.StatusOK, gin.H{"address": address})
}

func IsCoordinateFormat(s string) bool {
	return coordRegex.MatchString(strings.TrimSpace(s))
}

func ReverseGeocodeFromCoords(location string) string {
	parts := strings.SplitN(location, ",", 2)
	if len(parts) != 2 {
		return location
	}

	var lat, lng float64
	if _, err := fmt.Sscanf(strings.TrimSpace(parts[0])+" "+strings.TrimSpace(parts[1]), "%f %f", &lat, &lng); err != nil {
		return location
	}

	address, err := reverseGeocode(lat, lng)
	if err != nil {
		log.Printf("Nominatim geocode failed for chat: %v", err)
		return location
	}
	return address
}

func reverseGeocode(lat, lng float64) (string, error) {
	nominatimURL := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/reverse?lat=%f&lon=%f&format=json&accept-language=zh&zoom=18&addressdetails=1",
		lat, lng,
	)

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", nominatimURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "ALChat/1.0 (https://alchat.fiacloud.top)")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("nominatim returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result nominatimResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	address := buildAddressString(result.Address)
	if address == "" {
		return fmt.Sprintf("%f, %f", lat, lng), nil
	}
	return address, nil
}

func buildAddressString(addr nominatimAddress) string {
	var parts []string

	if addr.State != "" {
		parts = append(parts, addr.State)
	}

	city := addr.City
	if city == "" {
		city = addr.Town
	}
	if city == "" {
		city = addr.Village
	}
	if city != "" && city != addr.State {
		parts = append(parts, city)
	}

	district := addr.Suburb
	if district == "" {
		district = addr.District
	}
	if district != "" {
		parts = append(parts, district)
	}

	if addr.Neighbourhood != "" {
		parts = append(parts, addr.Neighbourhood)
	}

	if addr.Road != "" {
		parts = append(parts, addr.Road)
	}

	if len(parts) == 0 {
		return ""
	}

	result := strings.Join(parts, ", ")

	if addr.HouseNumber != "" {
		result += " " + addr.HouseNumber
	}

	return result
}
