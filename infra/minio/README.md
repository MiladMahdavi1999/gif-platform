# B00 object-store boundary

B00 probes MinIO's real `/minio/health/ready` endpoint. It creates no buckets,
objects, public policies or upload CORS rules. Private bucket provisioning and
browser upload policy verification belong to B03; no S3 object API exists in B00.

The official Docker Hub image was unavailable during B00 verification. Following
the upstream [security release instructions](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z),
Compose builds that release from commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`.
This preserves the selected local MinIO dependency; it does not select production
storage. The source license is retained in the image. `health.go` is a tiny HTTP
probe for the scratch image, not a replacement object store.
