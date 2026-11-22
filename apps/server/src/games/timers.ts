/**
 * Server-owned timers, keyed so a game has at most one timer per purpose. Deadlines themselves are
 * stored in the database, and the timers are rebuilt from them on boot.
 */
export class Timers {
  private readonly handles = new Map<string, NodeJS.Timeout>();

  schedule(key: string, delayMs: number, fn: () => void): void {
    this.cancel(key);
    const handle = setTimeout(() => {
      this.handles.delete(key);
      fn();
    }, Math.max(0, delayMs));
    handle.unref?.();
    this.handles.set(key, handle);
  }

  cancel(key: string): void {
    const handle = this.handles.get(key);
    if (handle) clearTimeout(handle);
    this.handles.delete(key);
  }

  has(key: string): boolean {
    return this.handles.has(key);
  }

  clear(): void {
    for (const handle of this.handles.values()) clearTimeout(handle);
    this.handles.clear();
  }
}
