# A8: attachments (upload, storage, rights)

## Already on main (0104)
- `issue_attachments`: `kind link|file`, `url` (http/https, max 2048), `title` 1..255, `mime_type` (`type/subtype`), `size_bytes >= 0`. No binary storage today: a file is a URL plus metadata.
- `GET /issues/:id/attachments?limit&cursor` (order `created_at, id`); `POST /issues/:id/attachments` body strict `{ kind=link, url, title?, mime_type?, size_bytes? }` (mime/size only for kind=file; title defaults from the url), 201 + `Location`; `DELETE /issues/:id/attachments/:aid` 204.
- Limits today: max 500 per issue (422). Rights: create and delete need member+ (guest 403); delete only by the uploader or admin+ (else 403). Hidden issue: 404. Create/delete appear in the activity feed.

## Delta: real uploads
### Storage interface (fixed)
`AttachmentStore { put(key, stream, {size, mime}); get(key, range?): stream; delete(key); list(prefix): AsyncIterable<key> }`. Implementations: `fs` (dev/CI, `ATTACHMENTS_DIR`, default `./.data/attachments`); `s3` later behind the same interface. Key = `<workspace_id>/<attachment_id>`, server generated, never derived from the filename. The filename is metadata (`filename`), sanitised: no path separators or control chars, max 255.

### Limits
- Max file 25 MB (`ATTACHMENT_MAX_BYTES`); over: 413 `payload_too_large` (new code). Max 200 MB per workspace (`ATTACHMENT_WORKSPACE_QUOTA`); over: 422 `validation_failed` with message `workspace attachment quota exceeded`. The quota is checked at `POST /uploads` inside `pg_advisory_xact_lock(hashtext(workspace_id))`, summing the declared size of non-deleted `ready` rows plus `pending` rows, so concurrent POSTs cannot overshoot. Max 20 pending rows per user per workspace (422 `validation_failed`). A declared `size_bytes` above 25 MB is refused at POST /uploads with 413, before any byte is sent.
- Mime allowlist, compared on the normalized type (parameters such as `; charset=` stripped, lowercased): image/png, jpeg, gif, webp; application/pdf; text/plain, text/markdown, text/csv; application/zip; application/json; the docx/xlsx/pptx types. Else 415 `unsupported_media_type` (new code). `image/svg+xml` and `text/html` are refused (script risk).
- Declared `mime_type`/`size_bytes` are checked against the received bytes: size must match exactly (else 422). sha256 is computed server-side.

### Flow
1. `POST /issues/:id/attachments/uploads` body strict `{ filename, mime_type, size_bytes, title? }`. Member+ on the issue. Creates a row `kind=file, upload_status=pending` and returns 201 `{ id, upload_url, expires_at }` where `upload_url` is `/api/v1/w/<slug>/issues/<id>/attachments/<aid>/content`. Pending rows expire after 1 h; a GC job removes them and their bytes.
2. `PUT <upload_url>` raw body, `Content-Type` = declared mime, `Content-Length` = declared size. Streamed to the store and hashed; the row becomes `ready` in the same request. **Byte cap while streaming**: the handler counts bytes actually read and stops at `size_bytes` (declared) and never beyond `ATTACHMENT_MAX_BYTES`; it does not trust `Content-Length` or chunked framing. One byte over, or a stream that ends short: abort, `store.delete(key)` of the partial key, row stays `pending` (retryable until expiry), 422 `validation_failed` (size mismatch) or 413 `payload_too_large` (over the global cap). Magic bytes are checked on the first 16 bytes (png, jpeg, gif, webp, pdf, zip and the zip-based office types); a mismatch with the declared mime is 415. 200 with the attachment DTO. Only the creator may PUT, once (second PUT: 409 `conflict`; another user: 403). Wrong length 422, wrong type 415.
3. `GET .../attachments/:aid/content` streams the bytes (Range supported). Visibility is the issue's (hidden: 404; guest with an active share: allowed, read only). Headers: Content-Type from the stored mime, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` with an RFC 5987 `filename*` (`?inline=1` is honoured only for stored `image/*` types other than svg, never for pdf/text/html; everything else stays `attachment`). `filename*` is RFC 5987 percent-encoded UTF-8 and the ASCII `filename="..."` fallback has CR, LF, quotes and non-ASCII replaced (stripped from the stored filename too), `Cache-Control: private, max-age=0`, `Content-Security-Policy: sandbox`. A pending attachment is 404 for everyone but its creator, and pending or soft-deleted rows are excluded from every list (`GET /attachments`, counts, search): lists filter `deleted_at IS NULL AND upload_status = 'ready'`, the creator also sees their own pending rows in the list.

DTO adds `filename|null`, `upload_status`, `sha256|null`, `download_url|null` (null for links and pending). `url` is null for uploaded files.

### Rights
| Action | owner/admin | member of the issue's team | member of another team | guest (shared) |
|---|---|---|---|---|
| list / download | yes | yes | 404 | yes |
| upload / add link | yes | yes | 404 | 403 |
| delete | yes | own only (403 otherwise) | 404 | 403 |

### Lifecycle
DELETE sets `deleted_at`; the row leaves lists at once and the GC job deletes the bytes (deleted rows older than 10 min, pending older than 1 h). Hard delete of an issue cascades the rows; GC removes orphan keys, which needs the store to list keys by prefix `<workspace_id>/` (part of the `AttachmentStore` interface: `list(prefix)`), compared with the ids still present in `issue_attachments`. Restoring a soft-deleted issue keeps its attachments.

### New error codes
Add to `ErrorCode`: `payload_too_large` 413, `unsupported_media_type` 415.

### DDL
`sql/0805_a8_attachment_storage.*`: `storage_key`, `sha256`, `upload_status`, `filename`, `deleted_at`; `url` nullable with a CHECK that exactly one of (`url`, `storage_key`) is set; unique `(workspace_id, storage_key)`; UPDATE grant limited to `upload_status, sha256, size_bytes, deleted_at`. Down deletes uploaded rows (bytes stay for GC).

### Tests required
Round trip (bytes + sha256); body longer than declared aborts at the cap and leaves no key; chunked body without Content-Length; two concurrent POSTs near the quota; 21st pending row; declared size > 25 MB is 413; inline only for image/*; header injection in filename (CR/LF, quotes, unicode); mime with parameters; magic-byte mismatch; size/mime mismatch; 413; 415 incl. svg; quota; second PUT 409; PUT by another user 403; guest download with/without share; other-team member 404; delete rights matrix; content headers; path traversal in filename; pending expiry/GC; RLS cross-workspace; the old link flow unchanged.
