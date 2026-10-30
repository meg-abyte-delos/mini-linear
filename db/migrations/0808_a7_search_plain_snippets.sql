-- A7 follow-up: snippets are plain text (Linear). Markdown is stripped before ts_headline (fences, headings, bullets, quotes,
-- links/images keep their label, emphasis, inline code) and line breaks become spaces. Issue and project snippets are built
-- from the description alone (the title is already shown as the hit title). Same sentinel/escape pipeline as 0804.
CREATE OR REPLACE FUNCTION search_plain(src text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(coalesce(src, ''), '```[[:alnum:]_-]*', ' ', 'g'),
                '!?\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
              '^[[:space:]]*(#{1,6}|>|[-*+]|[0-9]+[.)])[[:space:]]+', '', 'ng'),
            '^[[:space:]]*>+[[:space:]]?', '', 'ng'),
          '(\*\*|~~|`)', '', 'g'),
        '(^|[[:space:]])\*([^*[:space:]][^*]*)\*', '\1\2', 'g'),
      '[[:space:]]*[\r\n]+[[:space:]]*', ' ', 'g'),
    '[[:space:]]{2,}', ' ', 'g')) $$;
GRANT EXECUTE ON FUNCTION search_plain(text) TO app_user;

CREATE OR REPLACE FUNCTION search_snippet(src text, tq tsquery) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT replace(replace(replace(replace(replace(replace(
    ts_headline('simple', translate(search_plain(src), U&'\E000\E001', ''), tq, U&'StartSel=\E000,StopSel=\E001,MaxFragments=1,MaxWords=20,MinWords=8'),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), U&'\E000', '<mark>'), U&'\E001', '</mark>') $$;

DO $mig$
DECLARE def text; fixed text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname = 'search_workspace' AND p.pronamespace = 'public'::regnamespace;
  fixed := replace(replace(def, 'search_snippet(i.title || '' '' || i.description, tq)', 'search_snippet(i.description, tq)'),
                   'search_snippet(p.name || '' '' || p.description, tq)', 'search_snippet(p.description, tq)');
  IF fixed = def OR position('search_snippet(i.description, tq)' IN fixed) = 0 OR position('search_snippet(p.description, tq)' IN fixed) = 0 THEN
    RAISE EXCEPTION 'search_workspace snippet calls not found';
  END IF;
  EXECUTE fixed;
END $mig$;
