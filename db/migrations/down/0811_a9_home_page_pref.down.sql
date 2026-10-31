-- Down for 0811: drop the landing page preference.
ALTER TABLE users DROP COLUMN IF EXISTS home_page;
