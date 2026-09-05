-- 商店限购台账.
--
-- Quest progress and story flags live in `characters.state_json`, so the whole
-- NPC / 任务 / 商店 feature needs exactly one table: the per-day tally of how
-- much of a limited-stock shelf a cultivator has already bought. `day` is the
-- UTC `YYYY-MM-DD` key `dayKey()` produces, which is what makes the restock
-- happen without a sweeper — yesterday's rows simply stop matching.
CREATE TABLE shop_purchases (
  character_id TEXT NOT NULL,
  shop_id      TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  day          TEXT NOT NULL,
  qty          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, shop_id, item_id, day)
);
CREATE INDEX idx_shop_purchases_day ON shop_purchases(day);
