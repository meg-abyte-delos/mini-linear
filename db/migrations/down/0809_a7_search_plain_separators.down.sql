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
