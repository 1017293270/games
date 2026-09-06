-- 战斗大地图 图籍: which field each player is standing on.
--
-- A player stays on the field while logged out — that is the whole point of the
-- 挂机 loop — so the membership has to outlive both the socket and the process.
-- One row per character, because a cultivator is on at most one map at a time;
-- `ON DELETE CASCADE` means a deleted account takes its 图籍 with it and the
-- rebuild on boot never has to skip a dangling id.
--
-- 机器人修士 are deliberately absent: the bot engine decides afresh every tick
-- which field each bot belongs on, so persisting that would only be a slower
-- way of computing `zoneFor(stageIndex)` again.
--
-- Nothing about the fight itself is stored. Positions, 气血 and aggro live in
-- the in-memory `ZoneSim` and are rebuilt at the entrance on boot: a restart
-- costs everyone their spot, never their 修为.
CREATE TABLE zone_members (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  zone_id      TEXT NOT NULL,
  entered_at   INTEGER NOT NULL
);

-- The boot rebuild reads the whole table grouped by field.
CREATE INDEX idx_zone_members_zone ON zone_members(zone_id);
