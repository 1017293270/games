/**
 * Who is online.
 *
 * Presence is socket-derived and therefore process-local: a character counts as
 * online while it holds at least one live Socket.IO connection. Refcounting the
 * connections means a second tab does not make the first one's disconnect look
 * like a logout.
 */
export class PresenceTracker {
  private readonly counts = new Map<string, number>();

  /** Registers a connection. Returns true when this made the character online. */
  join(characterId: string): boolean {
    const next = (this.counts.get(characterId) ?? 0) + 1;
    this.counts.set(characterId, next);
    return next === 1;
  }

  /** Drops a connection. Returns true when the character just went offline. */
  leave(characterId: string): boolean {
    const next = (this.counts.get(characterId) ?? 0) - 1;
    if (next <= 0) {
      this.counts.delete(characterId);
      return true;
    }
    this.counts.set(characterId, next);
    return false;
  }

  isOnline(characterId: string): boolean {
    return this.counts.has(characterId);
  }

  ids(): string[] {
    return [...this.counts.keys()];
  }

  get count(): number {
    return this.counts.size;
  }

  clear(): void {
    this.counts.clear();
  }
}
