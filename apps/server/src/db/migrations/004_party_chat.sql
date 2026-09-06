-- 队伍频道 scrollback, and 声望 moving into the shared character schema.
--
-- `chat_messages.party_id` has existed since 001; what it lacked was a reader.
-- Now that 队伍频道 lines are stamped and read back per party, that read path
-- filters on `(party_id, sent_at)` and wants its own index — the 001 index is
-- on `(channel, sent_at)`, which for the party channel would scan every party's
-- talk to find one party's.
CREATE INDEX idx_chat_party_time ON chat_messages(party_id, sent_at DESC);

-- `characters.prestige` is now a field on `CharacterState` rather than a column
-- only 围攻 knew about, so `state_json` becomes its record of truth and the
-- column its denormalised copy. Rows written before that carry the value in the
-- column alone; folding it into the blob once keeps 声望 already earned.
UPDATE characters
SET state_json = json_set(state_json, '$.prestige', prestige)
WHERE prestige > 0;
