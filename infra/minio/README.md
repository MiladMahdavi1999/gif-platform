# Private local object storage

B00 introduced the real `/minio/health/ready` probe. B03 adds private bucket
provisioning, versioned quarantine, actual S3 HEAD and browser presigned POST.
The guarded `storage-init` service removes bucket policies and enables quarantine
versioning before the API becomes healthy. MinIO uses its global
`MINIO_API_CORS_ALLOW_ORIGIN` set to the exact local web origin. This restricts
browser CORS; authorization still depends on signed forms and private storage.
No wildcard origin, public ACL or anonymous GetObject is configured.

B03 integration tests verify allowed/denied CORS origins, exact policy key and MIME,
size ceiling, expiry, anonymous/version reads and private derivative bucket. The
browser test sends a real POST to `http://localhost:9000`. A receipt pins the exact
version ID and ETag; future B04 must read that version. Replayed forms may create
additional private versions until expiration; cleanup is not implemented.

The official Docker Hub image was unavailable during B00 verification. Following
the upstream [security release instructions](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z),
Compose builds that release from commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`.
This preserves the selected local MinIO dependency; it does not select production
storage. The source license is retained in the image. `health.go` is a tiny HTTP
probe for the scratch image, not a replacement object store.
