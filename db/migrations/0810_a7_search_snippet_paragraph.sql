-- A7 follow-up: a snippet comes from the line (paragraph, list item) that contains the match, never from a heading glued into the sentence.
-- Markdown headings are dropped before the snippet is built. The first line whose plain text matches the query is used; when no single line
-- matches (terms spread over several lines) the whole heading-free description is used. Same sentinel/escape pipeline as 0808.
CREATE OR REPLACE FUNCTION search_snippet(src text, tq tsquery) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  WITH body AS (
    SELECT regexp_replace(coalesce(src, ''), '^[[:space:]]*#{1,6}([[:space:]][^\r\n]*)?$', '', 'ng') AS t
  ), pick AS (
    SELECT coalesce(
      (SELECT u.line FROM body, regexp_split_to_table(body.t, '[\r\n]+') WITH ORDINALITY AS u(line, ord)
        WHERE to_tsvector('simple', search_plain(u.line)) @@ tq ORDER BY u.ord LIMIT 1),
      (SELECT t FROM body)) AS s
  )
  SELECT replace(replace(replace(replace(replace(replace(
    ts_headline('simple', translate(search_plain((SELECT s FROM pick)), U&'\E000\E001', ''), tq, U&'StartSel=\E000,StopSel=\E001,MaxFragments=1,MaxWords=20,MinWords=8'),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), U&'\E000', '<mark>'), U&'\E001', '</mark>') $$;
