-- Should-fix from PR #3 review: app_user must not delete users (account removal is an owner-run operation).
REVOKE DELETE ON users FROM app_user;
