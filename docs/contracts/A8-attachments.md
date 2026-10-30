# A8: attachments (upload, storage, rights)

## Already on main (0104)
- `issue_attachments`: `kind link|file`, `url` (http/https, max 2048), `title` 1..255, `mime_type` (`type/subtype`), `size_bytes >= 0`. No binary storage today: a file is a URL plus metadata.
- `GET /issues/:id/attachments?limit&cursor` (order `created_at, id`); `POST /issues/:id/attachments` body strict `{ kind=link, url, title?, mime_type?, size_bytes? }` (mime/size only for kind=file; title defaults from the url), 201 + `Location`; `DELETE /issues/:id/attachments/:aid` 204.
- Limits today: max 500 per issue (422). Rights: create and delete need member+ (guest 403); delete only by the uploader or admin+ (else 403). Hidden issue: 404. Create/delete appear in the activity feed.

## Delta: real uploads
### Storage interface (fixed)
`AttachmentStore { put(key, stream, {size, mime}); get(key, range?): stream; delete(key) }`. Implementations: `fs` (dev/CI, `ATTACHMENTS_DIR`, default `./.data/attachments`); `s3` later behind the same interface. Key = `<workspace_id>/<attachment_id>`, server generated, never derived from the filename. The filename is metadata (`filename`), sanitised: no path separators or control chars, max 255.

### Limits
- Max file 25 MB (`ATTACHMENT_MAX_BYTES`); over: 413 `payload_too_large` (new code). Max 200 MB per workspace (`ATTACHMENT_WORKSPACE_QUOTA`); over: 422 `validation_failed` with message `workspace attachment quota exceeded`.
- Mime allowlist: image/png, jpeg, gif, webp; application/pdf; text/plain, text/markdown, text/csv; application/zip; application/json; the docx/xlsx/pptx types. Else 415 `unsupported_media_type` (new code). `image/svg+xml` and `text/html` are refused (script risk).
- Declared `mime_type`/`size_bytes` are checked against the received bytes: size must match exactly (else 422). sha256 is computed server-side.

### Flow
1. `POST /issues/:id/attachments/uploads` body strict `{ filename, mime_type, size_bytes, title? }`. Member+ on the issue. Creates a row `kind=file, upload_status=pending` and returns 201 `{ id, upload_url, expires_at }` where `upload_url` is `/api/v1/w/<slug>/issues/<id>/attachments/<aid>/content`. Pending rows expire after 1 h; a GC job removes them and their bytes.
2. `PUT <upload_url>` raw body, `Content-Type` = declared mime, `Content-Length` = declared size. Streamed to the store and hashed; the row becomes `ready` in the same request. 200 with the attachment DTO. Only the creator may PUT, once (second PUT: 409 `conflict`; another user: 403). Wrong length 422, wrong type 415.
3. `GET .../attachments/:aid/content` streams the bytes (Range supported). Visibility is the issue's (hidden: 404; guest with an active share: allowed, read only). Headers: Content-Type from the stored mime, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` with an RFC 5987 `filename*` (images may be inline with `?inline=1`), `Cache-Control: private, max-age=0`, `Content-Security-Policy: sandbox`. A pending attachment is 404 for everyone but its creator.

DTO adds `filename|null`, `upload_status`, `sha256|null`, `download_url|null` (null for links and pending). `url` is null for uploaded files.

### Rights
| Action | owner/admin | member of the issue's team | member of another team | guest (shared) |
|---|---|---|---|---|
| list / download | yes | yes | 404 | yes |
| upload / add link | yes | yes | 404 | 403 |
| delete | yes | own only (403 otherwise) | 404 | 403 |

### Lifecycle
DELETE sets `deleted_at`; the row leaves lists at once and the GC job deletes the bytes (deleted rows older than 10 min, pending older than 1 h). Hard delete of an issue cascades the rows; GC removes orphan keys. Restoring a soft-deleted issue keeps its attachments.

### New error codes
Add to `ErrorCode`: `payload_too_large` 413, `unsupported_media_type` 415.

### DDL
`sql/0805_a8_attachment_storage.*`: `storage_key`, `sha256`, `upload_status`, `filename`, `deleted_at`; `url` nullable with a CHECK that exactly one of (`url`, `storage_key`) is set; unique `(workspace_id, storage_key)`; UPDATE grant limited to `upload_status, sha256, size_bytes, deleted_at`. Down deletes uploaded rows (bytes stay for GC).

### Tests required
Round trip (bytes + sha256); size/mime mismatch; 413; 415 incl. svg; quota; second PUT 409; PUT by another user 403; guest download with/without share; other-team member 404; delete rights matrix; content headers; path traversal in filename; pending expiry/GC; RLS cross-workspace; the old link flow unchanged.
