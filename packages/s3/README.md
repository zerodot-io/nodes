# @zerodot/s3

Manage buckets and files in Amazon S3 or in an S3-compatible service such as MinIO or Cloudflare R2: upload, download, list, and delete objects, and make signed links. Use it to store and share files.

## Install

In zerodot, go to **System > Nodes** and install **S3**.

Manual: install `@zerodot/s3` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### S3 (`s3.storage`)

- List, create, and delete buckets
- List objects in a bucket, with a prefix and a delimiter
- Download an object, or read only its details
- Upload an object from binary data or from text
- Delete an object
- Create a presigned URL (maximum 7 days)

## Credential

**S3** (`s3`): `accessKeyId`, `secretAccessKey`, `sessionToken`, `region`, `endpoint`, `forcePathStyle`. For an S3-compatible service, set `endpoint`. The secret access key and the session token are secret.

## License

AGPL-3.0-only
