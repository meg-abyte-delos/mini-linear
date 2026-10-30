DO $mig$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname = 'search_workspace' AND p.pronamespace = 'public'::regnamespace;
  def := replace(replace(def, 'search_snippet(i.description, tq)', 'search_snippet(i.title || '' '' || i.description, tq)'),
                 'search_snippet(p.description, tq)', 'search_snippet(p.name || '' '' || p.description, tq)');
  EXECUTE def;
END $mig$;
CREATE OR REPLACE FUNCTION search_snippet(src text, tq tsquery) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT replace(replace(replace(replace(replace(replace(
    ts_headline('simple', translate(coalesce(src, ''), U&'\E000\E001', ''), tq, U&'StartSel=\E000,StopSel=\E001,MaxFragments=1,MaxWords=20,MinWords=8'),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), U&'\E000', '<mark>'), U&'\E001', '</mark>') $$;
DROP FUNCTION search_plain(text);
