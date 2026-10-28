-- Area 9 / Part 5: personal API keys + outbound webhooks.
-- Keys: only sha256(token) is stored; the plain token (mlk_<prefix>_<secret>) is returned once at creation.
-- A key belongs to (workspace, user) and acts with that user's CURRENT role (resolve_workspace), never more.
BEGIN;
CREATE TABLE api_keys (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  prefix text NOT NULL CHECK (prefix ~ '^[a-z0-9]{8}$'),
  key_hash text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'write' CHECK (scope IN ('read','write')),
  expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX api_keys_user_idx ON api_keys (workspace_id, user_id);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (char_length(url) <= 2000 AND url ~ '^https?://'),
  secret text NOT NULL, -- needed in clear to sign payloads (HMAC); never returned after creation
  events text[] NOT NULL CHECK (cardinality(events) > 0 AND events <@ ARRAY['issue.created','issue.updated','issue.deleted','comment.created','comment.updated','comment.deleted','project.created','project.updated','project.deleted']::text[]),
  active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id));

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  webhook_id uuid NOT NULL, event text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code integer, last_error text, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
  FOREIGN KEY (webhook_id, workspace_id) REFERENCES webhooks(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_hook_idx ON webhook_deliveries (workspace_id, webhook_id, created_at DESC);
CREATE INDEX webhooks_ws_idx ON webhooks (workspace_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys','webhooks','webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Event fan-out: one delivery row per matching active webhook, written in the SAME tx as the change (no lost events,
-- rolled back with it). Runs as the invoker (app_user) under the tenant RLS already set for the request.
CREATE FUNCTION enqueue_webhook_event() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE kind text := TG_ARGV[0]; ev text; r record; act text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; act := 'deleted';
  ELSIF TG_OP = 'INSERT' THEN r := NEW; act := 'created';
  ELSE r := NEW; act := CASE WHEN kind = 'issue' AND to_jsonb(OLD)->>'deleted_at' IS NULL AND to_jsonb(NEW)->>'deleted_at' IS NOT NULL THEN 'deleted' ELSE 'updated' END;
  END IF;
  ev := kind || '.' || act;
  INSERT INTO webhook_deliveries (workspace_id, webhook_id, event, payload)
    SELECT w.workspace_id, w.id, ev, jsonb_build_object('event', ev, 'workspace_id', r.workspace_id, 'occurred_at', now(), 'data', to_jsonb(r))
    FROM webhooks w WHERE w.workspace_id = r.workspace_id AND w.active AND ev = ANY (w.events);
  RETURN NULL;
END $$;
CREATE TRIGGER issues_webhooks AFTER INSERT OR UPDATE OR DELETE ON issues FOR EACH ROW EXECUTE FUNCTION enqueue_webhook_event('issue');
CREATE TRIGGER comments_webhooks AFTER INSERT OR UPDATE OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION enqueue_webhook_event('comment');
CREATE TRIGGER projects_webhooks AFTER INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION enqueue_webhook_event('project');

-- SECURITY NOTE: resolve_api_key is SECURITY DEFINER; it is only ever called with sha256 of a bearer token
-- presented by the client. Returns nothing for unknown / revoked / expired keys. Touches last_used_at (<= 1/min).
CREATE FUNCTION resolve_api_key(p_key_hash text)
RETURNS TABLE (key_id uuid, workspace_id uuid, user_id uuid, scope text)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE k public.api_keys%ROWTYPE;
BEGIN
  SELECT * INTO k FROM public.api_keys a
  WHERE a.key_hash = p_key_hash AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now());
  IF NOT FOUND THEN RETURN; END IF;
  IF k.last_used_at IS NULL OR k.last_used_at < now() - interval '1 minute' THEN
    UPDATE public.api_keys SET last_used_at = now() WHERE id = k.id;
  END IF;
  key_id := k.id; workspace_id := k.workspace_id; user_id := k.user_id; scope := k.scope;
  RETURN NEXT;
END $$;

-- Dispatcher (background, no tenant): claim due deliveries with a 2-minute lease (SKIP LOCKED: safe with N instances),
-- then report the outcome. Exposes url+secret only to the server-side dispatcher role (app_user).
CREATE FUNCTION claim_webhook_deliveries(p_limit integer)
RETURNS TABLE (id uuid, workspace_id uuid, webhook_id uuid, event text, payload jsonb, attempts integer, url text, secret text)
LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, public AS $$
  WITH due AS (
    SELECT d.id FROM public.webhook_deliveries d WHERE d.status = 'pending' AND d.next_attempt_at <= now()
    ORDER BY d.next_attempt_at LIMIT least(greatest(p_limit, 1), 100) FOR UPDATE SKIP LOCKED),
  upd AS (UPDATE public.webhook_deliveries d SET next_attempt_at = now() + interval '2 minutes', attempts = d.attempts + 1
    FROM due WHERE d.id = due.id RETURNING d.*)
  SELECT u.id, u.workspace_id, u.webhook_id, u.event, u.payload, u.attempts, w.url, w.secret
  FROM upd u JOIN public.webhooks w ON w.id = u.webhook_id AND w.workspace_id = u.workspace_id WHERE w.active $$;

-- Backoff: 30s * 2^(attempts-1), capped at 6h; after 8 attempts the delivery is 'failed'.
CREATE FUNCTION complete_webhook_delivery(p_id uuid, p_ok boolean, p_status integer, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path = pg_catalog, public AS $$
  UPDATE public.webhook_deliveries d SET
    status = CASE WHEN p_ok THEN 'succeeded' WHEN d.attempts >= 8 THEN 'failed' ELSE 'pending' END,
    delivered_at = CASE WHEN p_ok THEN now() ELSE NULL END,
    next_attempt_at = CASE WHEN p_ok OR d.attempts >= 8 THEN d.next_attempt_at
      ELSE now() + least(interval '30 seconds' * power(2, d.attempts - 1), interval '6 hours') END,
    last_status_code = p_status, last_error = left(p_error, 500)
  WHERE d.id = p_id $$;

GRANT CREATE ON SCHEMA public TO definer;
ALTER FUNCTION resolve_api_key(text) OWNER TO definer;
ALTER FUNCTION claim_webhook_deliveries(integer) OWNER TO definer;
ALTER FUNCTION complete_webhook_delivery(uuid, boolean, integer, text) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
GRANT SELECT, UPDATE ON api_keys, webhooks, webhook_deliveries TO definer;
REVOKE ALL ON FUNCTION resolve_api_key(text), claim_webhook_deliveries(integer),
  complete_webhook_delivery(uuid, boolean, integer, text), enqueue_webhook_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_api_key(text), claim_webhook_deliveries(integer),
  complete_webhook_delivery(uuid, boolean, integer, text) TO app_user;
GRANT SELECT, INSERT, UPDATE ON api_keys TO app_user; -- revoke = UPDATE revoked_at (no hard delete: audit trail)
GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks TO app_user;
GRANT SELECT, INSERT ON webhook_deliveries TO app_user;
COMMIT;
