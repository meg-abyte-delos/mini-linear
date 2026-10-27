# M1 route table (proposed by Ada; spec v1.1 names no routes, Meg to confirm)
All under /api/v1. Workspace comes from the slug path segment, validated against membership (non-member => 404).
- Auth (global): POST /auth/signup, /auth/login, /auth/logout, /auth/logout-all, /auth/verify-email, /auth/password-reset/request, /auth/password-reset/confirm; GET /auth/me
- Invite acceptance: POST /invites/accept (token in body, uses lookup_invite())
- Workspaces: GET|POST /workspaces
- Per workspace: GET /w/{slug}; GET|POST /w/{slug}/members; PATCH|DELETE /w/{slug}/members/{userId}; GET|POST /w/{slug}/invites; DELETE /w/{slug}/invites/{id}; GET|POST /w/{slug}/teams; PATCH|DELETE /w/{slug}/teams/{id}; POST|DELETE /w/{slug}/teams/{id}/members/{userId}
