import { dayKey, getProgression, type CharacterState } from '@xianxia/shared';

/** Event counters are folded into the same character write as the originating action. */
export function progressEvent(
  state: CharacterState,
  now: number,
  event: 'kills' | 'dungeon' | 'arena' | 'chat' | 'first_breakthrough' | 'first_boss',
  amount = 1,
): CharacterState {
  if (state.isBot) return state;
  const progression = getProgression(state.progression, now);
  if (event === 'first_breakthrough' || event === 'first_boss') {
    if (!progression.achievements.includes(event)) progression.achievements.push(event);
  } else {
    progression.daily[event] = Math.min(Number.MAX_SAFE_INTEGER, progression.daily[event] + amount);
  }
  return { ...state, progression };
}

/** Credit only today's part of the capped settlement window, once per lastSettledAt. */
export function progressCultivation(
  state: CharacterState,
  now: number,
  capHours: number,
): CharacterState {
  if (state.isBot) return state;
  const progression = getProgression(state.progression, now);
  const midnight = Date.parse(`${dayKey(now)}T00:00:00.000Z`);
  const from = Math.max(midnight, state.lastSettledAt, now - Math.max(0, capHours) * 3_600_000);
  progression.daily.cultivationSeconds += Math.max(0, now - from) / 1000;
  return { ...state, progression };
}
