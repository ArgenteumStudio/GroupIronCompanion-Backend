import { randomUUID } from 'node:crypto';
import { SKILLS } from '../public/skills.js';

const RETENTION = 5 * 60 * 1000;
const MAX_EVENTS = 500;
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

export function validXpBatch(body, now = Date.now()) {
  return body && typeof body.username === 'string' && /^[a-zA-Z0-9 _-]{1,12}$/.test(body.username) &&
    Array.isArray(body.drops) && body.drops.length > 0 && body.drops.length <= 50 &&
    body.drops.every(drop => drop && typeof drop.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(drop.id) &&
      SKILLS.includes(drop.skill) && integer(drop.amount, 200000000) && drop.amount > 0 &&
      integer(drop.totalXp, 200000000) && drop.totalXp >= drop.amount &&
      integer(drop.level, 126) && drop.level > 0 &&
      integer(drop.observedAt, Number.MAX_SAFE_INTEGER) && drop.observedAt <= now + 60000 &&
      now - drop.observedAt <= 30000);
}

export class LiveXp {
  constructor({ now = Date.now, waitMillis = 12000 } = {}) {
    this.now = now;
    this.waitMillis = waitMillis;
    this.epoch = randomUUID();
    this.sequence = 0;
    this.events = [];
    this.seen = new Map();
    this.waiters = new Set();
    this.closed = false;
  }

  get cursor() { return `${this.epoch}:${this.sequence}`; }

  publish(username, drops) {
    const now = this.now();
    for (const [key, time] of this.seen) if (now - time > RETENTION) this.seen.delete(key);
    // Keep retry deduplication bounded independently of the visible event buffer.
    const unique = drops.filter(drop => !this.seen.has(`${username.toLowerCase().replaceAll('_', ' ')}:${drop.id}`));
    if (this.seen.size + unique.length > 10000) throw new Error('Live XP capacity reached; retry after older events expire');
    let accepted = 0;
    for (const drop of unique) {
      const key = `${username.toLowerCase().replaceAll('_', ' ')}:${drop.id}`;
      if (this.seen.has(key)) continue;
      this.seen.set(key, now);
      this.events.push({ ...drop, username, receivedAt: now, sequence: ++this.sequence });
      accepted++;
    }
    this.events = this.events.filter(event => now - event.receivedAt <= RETENTION).slice(-MAX_EVENTS);
    if (accepted) for (const wake of [...this.waiters]) wake();
    return accepted;
  }

  read(after) {
    const prefix = `${this.epoch}:`;
    const sequence = typeof after === 'string' && after.startsWith(prefix) ? Number(after.slice(prefix.length)) : -1;
    const reset = !Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.sequence ||
      (this.events.length > 0 && sequence < this.events[0].sequence - 1);
    return { cursor: this.cursor, reset, serverTime: this.now(),
      drops: this.events.filter(event => this.now() - event.receivedAt <= RETENTION &&
        (reset || event.sequence > sequence)) };
  }

  async poll(after, signal) {
    if (after === this.cursor && !this.closed && !signal.aborted) {
      await new Promise(resolve => {
        const done = () => {
          clearTimeout(timer);
          this.waiters.delete(done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, this.waitMillis);
        this.waiters.add(done);
        signal.addEventListener('abort', done, { once: true });
      });
    }
    return this.read(after);
  }

  close() {
    this.closed = true;
    for (const wake of [...this.waiters]) wake();
  }
}
