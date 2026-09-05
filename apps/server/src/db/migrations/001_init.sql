-- Accounts. One account owns at most one cultivator.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  -- scrypt, stored as `<salt hex>:<derived key hex>`.
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  banned        INTEGER NOT NULL DEFAULT 0,
  ban_reason    TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

-- Player login sessions. The token doubles as the Socket.IO handshake token.
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- Admin panel sessions, separate from player sessions so revoking one class
-- never touches the other.
CREATE TABLE admin_sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Invite codes. `max_uses` -1 means unlimited, which is what the INVITE_CODE
-- environment variable creates on first boot; `used_by`/`used_at` record the
-- most recent redemption.
CREATE TABLE invites (
  code       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  used_by    TEXT,
  used_at    INTEGER,
  expires_at INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0
);

-- Cultivators. Players and bots share this table because they share every
-- formula; `state_json` holds the full `CharacterState` and the columns beside
-- it are denormalised copies that rankings and admin lists sort on without
-- parsing 200 JSON blobs.
CREATE TABLE characters (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL UNIQUE,
  is_bot          INTEGER NOT NULL DEFAULT 0,
  archetype_id    TEXT,
  bot_params_json TEXT,
  gender          TEXT NOT NULL,
  avatar_art      TEXT NOT NULL,
  stage_index     INTEGER NOT NULL DEFAULT 0,
  exp             REAL NOT NULL DEFAULT 0,
  power           INTEGER NOT NULL DEFAULT 0,
  arena_score     INTEGER NOT NULL DEFAULT 1000,
  spirit_stones   INTEGER NOT NULL DEFAULT 0,
  -- Reserved for a future 声望 system; carried so later migrations do not have
  -- to rewrite the table.
  prestige        INTEGER NOT NULL DEFAULT 0,
  -- Remaining 气血 share, 0-1. Raids drain it; it refills over
  -- `world.raidRecoverMinutes`.
  raid_hp         REAL NOT NULL DEFAULT 1,
  protected_until INTEGER NOT NULL DEFAULT 0,
  last_settled_at INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  state_json      TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_characters_user ON characters(user_id) WHERE is_bot = 0;
CREATE INDEX idx_characters_realm ON characters(stage_index DESC, exp DESC);
CREATE INDEX idx_characters_power ON characters(power DESC);
CREATE INDEX idx_characters_arena ON characters(arena_score DESC);
CREATE INDEX idx_characters_bot ON characters(is_bot, archetype_id);

-- One row per inventory stack. Stackable items use the deterministic uid
-- `<characterId>:<itemId>`; equipment gets a random uid so two identical
-- swords remain distinguishable and equip slots can point at one of them.
CREATE TABLE inventory (
  uid          TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  qty          INTEGER NOT NULL
);
CREATE INDEX idx_inventory_character ON inventory(character_id);

-- Server-wide key/value config. `world` holds the `WorldSettings` patch.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Bot archetypes, seeded from the shared content table and editable from the
-- admin panel afterwards.
CREATE TABLE bot_archetypes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  params_json     TEXT NOT NULL,
  weight          REAL NOT NULL,
  avatar_pool_json TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE chat_messages (
  id                TEXT PRIMARY KEY,
  channel           TEXT NOT NULL,
  sender_id         TEXT,
  sender_name       TEXT NOT NULL,
  sender_stage_name TEXT,
  party_id          TEXT,
  text              TEXT NOT NULL,
  sent_at           INTEGER NOT NULL
);
CREATE INDEX idx_chat_channel_time ON chat_messages(channel, sent_at DESC);

-- Every fight worth replaying: arena challenges, raids, dungeon runs.
CREATE TABLE battle_records (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  attacker_id   TEXT NOT NULL,
  attacker_name TEXT NOT NULL,
  defender_id   TEXT NOT NULL,
  defender_name TEXT NOT NULL,
  winner_id     TEXT,
  rating_delta  INTEGER NOT NULL DEFAULT 0,
  fought_at     INTEGER NOT NULL,
  battle_json   TEXT
);
CREATE INDEX idx_battle_attacker ON battle_records(attacker_id, fought_at DESC);
CREATE INDEX idx_battle_defender ON battle_records(defender_id, fought_at DESC);

-- Server-wide daily tallies for the admin dashboard, keyed by UTC day.
-- Per-character quotas live in `CharacterState.dailyCounters` instead.
CREATE TABLE daily_counters (
  day   TEXT NOT NULL,
  key   TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
