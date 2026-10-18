// Local-only IAM bootstrap, built against the pinned MinIO module dependencies.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"time"

	madmin "github.com/minio/madmin-go/v3"
)

func run() error {
	staging := os.Getenv("APP_ENV") == "staging" && os.Getenv("ALLOW_STAGING_PROVISION") == "true"
	if !staging && (os.Getenv("APP_ENV") != "development" || os.Getenv("ALLOW_DEV_DATABASE_COMMANDS") != "true") {
		return fmt.Errorf("development provisioning disabled")
	}
	endpoint, err := url.Parse(os.Getenv("S3_INTERNAL_ENDPOINT"))
	if err != nil || (endpoint.Scheme != "http" && !(staging && endpoint.Scheme == "https")) || endpoint.User != nil || endpoint.RawQuery != "" || (endpoint.Path != "" && endpoint.Path != "/") || (endpoint.Hostname() != "minio" && endpoint.Hostname() != "localhost" && endpoint.Hostname() != "127.0.0.1") {
		return fmt.Errorf("local endpoint required")
	}
	user := os.Getenv("S3_WORKER_ACCESS_KEY_ID")
	secret := os.Getenv("S3_WORKER_SECRET_ACCESS_KEY")
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`).MatchString(user) || len(secret) < 16 || user == os.Getenv("MINIO_ROOT_USER") {
		return fmt.Errorf("separate worker identity required")
	}
	quarantine := os.Getenv("S3_QUARANTINE_BUCKET")
	derivatives := os.Getenv("S3_DERIVATIVES_BUCKET")
	valid := regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)
	if !valid.MatchString(quarantine) || !valid.MatchString(derivatives) || quarantine == derivatives {
		return fmt.Errorf("separate private buckets required")
	}
	client, err := madmin.New(endpoint.Host, os.Getenv("MINIO_ROOT_USER"), os.Getenv("MINIO_ROOT_PASSWORD"), endpoint.Scheme == "https")
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	policy := map[string]any{"Version": "2012-10-17", "Statement": []map[string]any{
		{"Effect": "Allow", "Action": []string{"s3:GetBucketVersioning"}, "Resource": []string{"arn:aws:s3:::" + quarantine, "arn:aws:s3:::" + derivatives}},
		{"Effect": "Allow", "Action": []string{"s3:GetObject", "s3:GetObjectVersion"}, "Resource": []string{"arn:aws:s3:::" + quarantine + "/quarantine/*"}},
		{"Effect": "Allow", "Action": []string{"s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"}, "Resource": []string{"arn:aws:s3:::" + derivatives + "/assets/*"}},
	}}
	data, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	name := "gif-processing-" + user
	if err = client.AddCannedPolicy(ctx, name, data); err != nil {
		return err
	}
	if err = client.AddUser(ctx, user, secret); err != nil {
		return err
	}
	if err = client.SetPolicy(ctx, name, user, false); err != nil {
		return err
	}
	if !staging {
		return nil
	}
	apiUser := os.Getenv("S3_API_ACCESS_KEY_ID")
	apiSecret := os.Getenv("S3_API_SECRET_ACCESS_KEY")
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`).MatchString(apiUser) || len(apiSecret) < 32 || apiUser == user || apiUser == os.Getenv("MINIO_ROOT_USER") {
		return fmt.Errorf("separate API identity required")
	}
	apiPolicy := map[string]any{"Version": "2012-10-17", "Statement": []map[string]any{
		{"Effect": "Allow", "Action": []string{"s3:ListBucket", "s3:GetBucketVersioning"}, "Resource": []string{"arn:aws:s3:::" + quarantine, "arn:aws:s3:::" + derivatives}},
		{"Effect": "Allow", "Action": []string{"s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"}, "Resource": []string{"arn:aws:s3:::" + quarantine + "/quarantine/*"}},
		{"Effect": "Allow", "Action": []string{"s3:GetObject", "s3:GetObjectVersion"}, "Resource": []string{"arn:aws:s3:::" + derivatives + "/assets/*"}},
	}}
	apiData, err := json.Marshal(apiPolicy)
	if err != nil {
		return err
	}
	apiName := "gif-api-" + apiUser
	if err = client.AddCannedPolicy(ctx, apiName, apiData); err != nil {
		return err
	}
	if err = client.AddUser(ctx, apiUser, apiSecret); err != nil {
		return err
	}
	return client.SetPolicy(ctx, apiName, apiUser, false)
}
func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "Private worker storage provisioning failed")
		os.Exit(1)
	}
	fmt.Println("Private worker storage identity provisioned")
}
