-- Down for 0810: restore the search_snippet body of 0808 (no heading stripping, no line pick).
CREATE OR REPLACE FUNCTION search_snippet(src text, tq tsquery) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT replace(replace(replace(replace(replace(replace(
    ts_headline('simple', translate(search_plain(src), U&'\E000\E001', ''), tq, U&'StartSel=\E000,StopSel=\E001,MaxFragments=1,MaxWords=20,MinWords=8'),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), U&'\E000', '<mark>'), U&'\E001', '</mark>') $$;
