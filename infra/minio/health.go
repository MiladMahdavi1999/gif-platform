package main

import (
	"net/http"
	"os"
	"time"
)

func main() {
	client := http.Client{Timeout: time.Second}
	endpoint := os.Getenv("MINIO_HEALTH_URL")
	if endpoint == "" { endpoint = "http://127.0.0.1:9000/minio/health/ready" }
	response, err := client.Get(endpoint)
	if err != nil {
		os.Exit(1)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
