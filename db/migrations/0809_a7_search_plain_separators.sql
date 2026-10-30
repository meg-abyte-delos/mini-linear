-- A7 follow-up: a stripped heading or bold label keeps a separator, so "## Behaviour\n- 5 attempts" reads "Behaviour. 5 attempts"
-- ("Label: text" for a bold lead-in). Punctuation already there (. : ! ?) is not doubled. Rest of search_plain is unchanged (0808).
CREATE OR REPLACE FUNCTION search_plain(src text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(src, ''), '```[[:alnum:]_-]*', ' ', 'g'), '^[[:space:]]*#{1,6}[[:space:]]+([^\r\n]*[^[:space:].:!?\r\n])[[:space:]]*$', '\1. ', 'ng'), '^([[:space:]]*([-*+][[:space:]]+)?)\*\*([^*\r\n]*[^*:.!?[:space:]])\*\*[[:space:]]*$', '\1\3. ', 'ng'), '^([[:space:]]*([-*+][[:space:]]+)?)\*\*([^*\r\n]*[^*:.!?[:space:]])\*\*[[:space:]]+(?=[^[:space:]])', '\1\3: ', 'ng'),
                '!?\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
              '^[[:space:]]*(#{1,6}|>|[-*+]|[0-9]+[.)])[[:space:]]+', '', 'ng'),
            '^[[:space:]]*>+[[:space:]]?', '', 'ng'),
          '(\*\*|~~|`)', '', 'g'),
        '(^|[[:space:]])\*([^*[:space:]][^*]*)\*', '\1\2', 'g'),
      '[[:space:]]*[\r\n]+[[:space:]]*', ' ', 'g'),
    '[[:space:]]{2,}', ' ', 'g')) $$;

GRANT EXECUTE ON FUNCTION search_plain(text) TO app_user;
