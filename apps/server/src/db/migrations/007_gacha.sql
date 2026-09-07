-- Keep request receipts indefinitely: history pagination must not erase deduplication.
CREATE TABLE gacha_log (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  pool TEXT NOT NULL,
  item_id TEXT NOT NULL,
  rarity TEXT NOT NULL,
  duplicate INTEGER NOT NULL CHECK (duplicate IN (0, 1)),
  pity INTEGER NOT NULL CHECK (pity >= 0),
  fragments INTEGER NOT NULL CHECK (fragments >= 0),
  at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  draw_index INTEGER NOT NULL CHECK (draw_index >= 0),
  UNIQUE (character_id, request_id, draw_index)
);
CREATE INDEX gacha_log_character_time ON gacha_log(character_id, at DESC);
