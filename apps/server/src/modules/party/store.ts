import { randomUUID } from 'node:crypto';

/**
 * 组队, in memory.
 *
 * A party has no rows: it exists for as long as the people in it are playing
 * together, and a server restart is allowed to disband it — the alternative is
 * a table full of stale groups nobody will ever return to. Only the membership
 * is held here; names, 战力 and online state are read from the character store
 * whenever a party is rendered, so a party view is never stale.
 */

/** Invite-code alphabet with 0/O/1/I/L removed, so a code can be read aloud. */
export const PARTY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PARTY_CODE_LENGTH = 6;

export interface PartyRecord {
  id: string;
  code: string;
  leaderId: string;
  /** Join order, leader first at creation; the oldest member inherits. */
  memberIds: string[];
  maxSize: number;
  createdAt: number;
}

/** Outcome of a membership change, so callers know what to broadcast. */
export interface PartyChange {
  party: PartyRecord | null;
  /** True when the party emptied out and was dropped. */
  disbanded: boolean;
  /** Set when leadership moved to another member. */
  newLeaderId: string | null;
}

export class PartyStore {
  private readonly parties = new Map<string, PartyRecord>();
  private readonly byCodeIndex = new Map<string, string>();
  private readonly memberIndex = new Map<string, string>();

  constructor(private readonly randomCode: () => string = defaultCode) {}

  /** Opens a party with `leaderId` as its only member. */
  create(leaderId: string, maxSize: number, now: number): PartyRecord {
    const party: PartyRecord = {
      id: randomUUID(),
      code: this.freshCode(),
      leaderId,
      memberIds: [leaderId],
      maxSize,
      createdAt: now,
    };
    this.parties.set(party.id, party);
    this.byCodeIndex.set(party.code, party.id);
    this.memberIndex.set(leaderId, party.id);
    return party;
  }

  byId(partyId: string): PartyRecord | null {
    return this.parties.get(partyId) ?? null;
  }

  /** Lookup by invite code; codes are matched case-insensitively. */
  byCode(code: string): PartyRecord | null {
    const id = this.byCodeIndex.get(code.trim().toUpperCase());
    return id === undefined ? null : (this.parties.get(id) ?? null);
  }

  byMember(characterId: string): PartyRecord | null {
    const id = this.memberIndex.get(characterId);
    return id === undefined ? null : (this.parties.get(id) ?? null);
  }

  /** Appends a member. Returns null when the party is gone or already full. */
  join(partyId: string, characterId: string): PartyRecord | null {
    const party = this.parties.get(partyId);
    if (!party) return null;
    if (party.memberIds.includes(characterId)) return party;
    if (party.memberIds.length >= party.maxSize) return null;
    party.memberIds.push(characterId);
    this.memberIndex.set(characterId, party.id);
    return party;
  }

  /**
   * Removes a member.
   *
   * The leader leaving hands the party to the earliest remaining member rather
   * than breaking it up — the people still inside did not ask to be disbanded.
   * An empty party is dropped.
   */
  remove(characterId: string): PartyChange {
    const party = this.byMember(characterId);
    if (!party) return { party: null, disbanded: false, newLeaderId: null };

    party.memberIds = party.memberIds.filter((id) => id !== characterId);
    this.memberIndex.delete(characterId);

    if (party.memberIds.length === 0) {
      this.parties.delete(party.id);
      this.byCodeIndex.delete(party.code);
      return { party: null, disbanded: true, newLeaderId: null };
    }

    let newLeaderId: string | null = null;
    if (party.leaderId === characterId) {
      newLeaderId = party.memberIds[0] ?? null;
      if (newLeaderId !== null) party.leaderId = newLeaderId;
    }
    return { party, disbanded: false, newLeaderId };
  }

  /** Drops a party outright, releasing its code and every membership. */
  disband(partyId: string): void {
    const party = this.parties.get(partyId);
    if (!party) return;
    for (const id of party.memberIds) this.memberIndex.delete(id);
    this.parties.delete(party.id);
    this.byCodeIndex.delete(party.code);
  }

  get size(): number {
    return this.parties.size;
  }

  /** Draws a code that is not already in play. */
  private freshCode(): string {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const code = this.randomCode();
      if (!this.byCodeIndex.has(code)) return code;
    }
    // Astronomically unlikely with a 31^6 space; fall back to a unique suffix
    // rather than looping forever.
    return `${this.randomCode().slice(0, 2)}${Date.now().toString(36).toUpperCase().slice(-4)}`;
  }
}

function defaultCode(): string {
  let out = '';
  for (let i = 0; i < PARTY_CODE_LENGTH; i += 1) {
    out += PARTY_CODE_ALPHABET[Math.floor(Math.random() * PARTY_CODE_ALPHABET.length)];
  }
  return out;
}
