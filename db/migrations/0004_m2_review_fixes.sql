-- Review fixes for M2: the parent-chain trigger now takes row locks (FOR UPDATE) on the ancestor chain and on the moved
-- node's subtree before validating, so two concurrent re-parent transactions cannot both pass the cycle/depth check and commit.
-- Locks are taken parent-first, then descendants. SECURITY INVOKER: runs under RLS; FOR UPDATE needs the UPDATE grant app_user has.
CREATE OR REPLACE FUNCTION issues_check_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE up integer; down integer; is_cycle boolean; cur uuid; nxt uuid; n integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'issue parent cycle' USING ERRCODE = 'check_violation'; END IF;
  cur := NEW.parent_id; -- lock the ancestor chain, nearest first (bounded; longer chains fail the depth check anyway)
  WHILE cur IS NOT NULL AND n < 10 LOOP
    SELECT parent_id INTO nxt FROM public.issues WHERE id = cur FOR UPDATE;
    cur := nxt; n := n + 1;
  END LOOP;
  PERFORM 1 FROM public.issues WHERE id IN ( -- lock the subtree under the node being moved
    WITH RECURSIVE d(id, n) AS (
      SELECT id, 1 FROM public.issues WHERE parent_id = NEW.id
      UNION ALL SELECT i.id, d.n + 1 FROM public.issues i JOIN d ON i.parent_id = d.id WHERE d.n < 10)
    SELECT id FROM d) FOR UPDATE;
  -- READ COMMITTED: each statement below takes a fresh snapshot, so it sees anything committed while we waited for the locks
  WITH RECURSIVE anc(id, parent_id, d) AS (
    SELECT id, parent_id, 1 FROM public.issues WHERE id = NEW.parent_id
    UNION ALL SELECT i.id, i.parent_id, a.d + 1 FROM public.issues i JOIN anc a ON i.id = a.parent_id WHERE a.d < 10)
  SELECT coalesce(max(d), 0), coalesce(bool_or(id = NEW.id), false) INTO up, is_cycle FROM anc;
  IF is_cycle THEN RAISE EXCEPTION 'issue parent cycle' USING ERRCODE = 'check_violation'; END IF;
  WITH RECURSIVE dsc(id, d) AS (
    SELECT id, 1 FROM public.issues WHERE parent_id = NEW.id
    UNION ALL SELECT i.id, x.d + 1 FROM public.issues i JOIN dsc x ON i.parent_id = x.id WHERE x.d < 10)
  SELECT coalesce(max(d), 0) INTO down FROM dsc;
  IF up + 1 + down > 5 THEN RAISE EXCEPTION 'issue parent depth exceeds 5' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
