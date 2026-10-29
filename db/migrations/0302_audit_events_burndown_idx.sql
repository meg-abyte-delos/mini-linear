-- Cycle burndown replays audit_events: (a) find issues whose cycle_id diff touched a cycle, (b) fetch one issue's events in order.
-- Expression indexes match the query's diff->'cycle_id'->>'before' / 'after' predicates exactly; all start with workspace_id (S12). Run as OWNER.
BEGIN;
CREATE INDEX audit_events_cycle_before_idx ON audit_events (workspace_id, (diff->'cycle_id'->>'before')) WHERE entity = 'issue' AND diff ? 'cycle_id';
CREATE INDEX audit_events_cycle_after_idx ON audit_events (workspace_id, (diff->'cycle_id'->>'after')) WHERE entity = 'issue' AND diff ? 'cycle_id';
CREATE INDEX audit_events_entity_created_idx ON audit_events (workspace_id, entity, entity_id, created_at);
COMMIT;
