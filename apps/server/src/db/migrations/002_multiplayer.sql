-- Multiplayer: 好友 and 秘境副本 records.
--
-- 组队 has no table on purpose: a party is a live grouping, its whole lifetime
-- is one session, and a restart is allowed to disband it. It lives in
-- `PartyStore` in memory instead.
--
-- 论道 and 围攻 reuse `battle_records` (kind = 'arena' / 'raid') and the
-- `characters.raid_hp` / `protected_until` / `prestige` columns 001 already
-- carries.

-- One row per direction, so each side owns its own view of the relationship:
--   A -> B 'pending_out' pairs with B -> A 'pending_in'
--   accepting rewrites both rows to 'accepted'
-- Deleting a friend (or refusing a request) drops both rows.
CREATE TABLE friends (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_id    TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  -- 'pending_in' | 'pending_out' | 'accepted', matching shared `FriendState`.
  state        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (character_id, friend_id)
);
CREATE INDEX idx_friends_owner ON friends(character_id, state);
CREATE INDEX idx_friends_friend ON friends(friend_id);

-- One row per 秘境 run, solo or party. `participant_ids_json` is the ordered
-- id list (leader first) rather than a join table because a run is written once
-- and only ever read back whole — quest progress derives 「通关副本」 from
-- `participant_ids_json` plus `cleared`.
CREATE TABLE dungeon_runs (
  id                   TEXT PRIMARY KEY,
  dungeon_id           TEXT NOT NULL,
  leader_id            TEXT NOT NULL,
  participant_ids_json TEXT NOT NULL,
  cleared              INTEGER NOT NULL DEFAULT 0,
  fought_at            INTEGER NOT NULL
);
CREATE INDEX idx_dungeon_runs_leader ON dungeon_runs(leader_id, fought_at DESC);
CREATE INDEX idx_dungeon_runs_dungeon ON dungeon_runs(dungeon_id, fought_at DESC);
