import type { RtdbProfile } from '@shared/types/profile';
import type { DatabaseDriver, TableInfo, TestConnectionOutcome } from './types';
import { connectRtdbEmulator, connectRtdbLive } from '../rtdb/adminClient';
import type { RtdbHandle } from '../rtdb/types';

export const MAX_RTDB_JSON_BYTES = 1_000_000;
export const MAX_RTDB_VALUE_DEPTH = 32;

/**
 * Normalizes a Realtime Database path. Root is `"/"`. Rejects `..` and empty segments.
 */
export function normalizeRtdbPath(path: string): string {
  const t = path.trim();
  if (!t || t === '/') return '/';
  const withSlash = t.startsWith('/') ? t : `/${t}`;
  const parts = withSlash.split('/').filter((p) => p.length > 0);
  for (const p of parts) {
    if (p === '.' || p === '..') {
      throw new Error('Path cannot contain "." or ".." segments');
    }
  }
  return `/${parts.join('/')}`;
}

function valueDepth(v: unknown, d: number): number {
  if (d > MAX_RTDB_VALUE_DEPTH) return d;
  if (v === null || typeof v !== 'object') return d;
  if (Array.isArray(v)) {
    let m = d;
    for (const x of v) m = Math.max(m, valueDepth(x, d + 1));
    return m;
  }
  let m = d;
  for (const k of Object.keys(v as Record<string, unknown>)) {
    m = Math.max(m, valueDepth((v as Record<string, unknown>)[k], d + 1));
  }
  return m;
}

/**
 * Returns a JSON-serializable clone and enforces size/depth limits.
 */
export function jsonSafeRtdbValue(
  value: unknown,
  opts: { maxBytes: number; maxDepth: number } = {
    maxBytes: MAX_RTDB_JSON_BYTES,
    maxDepth: MAX_RTDB_VALUE_DEPTH,
  },
): unknown {
  if (valueDepth(value, 0) > opts.maxDepth) {
    throw new Error(`Value exceeds max nesting depth (${opts.maxDepth})`);
  }
  const s = JSON.stringify(value);
  if (s.length > opts.maxBytes) {
    throw new Error(
      `Value size (${s.length} bytes) exceeds limit (${opts.maxBytes} bytes). Try a deeper path or a smaller subtree.`,
    );
  }
  return JSON.parse(s) as unknown;
}

function topLevelKeysFromRootValue(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === 'object' && !Array.isArray(v)) {
    return Object.keys(v as Record<string, unknown>);
  }
  if (Array.isArray(v)) {
    return v.map((_, i) => String(i));
  }
  return [];
}

export class RtdbDriver implements DatabaseDriver {
  readonly engine = 'rtdb' as const;

  private constructor(
    readonly profile: RtdbProfile,
    readonly handle: RtdbHandle,
  ) {}

  static async connect(profile: RtdbProfile): Promise<RtdbDriver> {
    const handle =
      profile.kind === 'live' ? await connectRtdbLive(profile) : await connectRtdbEmulator(profile);
    return new RtdbDriver(profile, handle);
  }

  get database() {
    return this.handle.database;
  }

  get profileId(): string {
    return this.handle.profileId;
  }

  async testConnection(): Promise<TestConnectionOutcome> {
    const started = Date.now();
    try {
      const snap = await this.handle.database.ref('/.info/connected').once('value');
      if (snap.val() !== true) {
        await this.handle.database.ref('/').once('value');
      }
      return {
        ok: true,
        elapsedMs: Date.now() - started,
        detail:
          this.profile.kind === 'emulator'
            ? `RTDB emulator @ ${this.profile.host}:${this.profile.port} · ${this.profile.projectId}`
            : `RTDB (Admin) · ${this.profile.projectId}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: 'RTDB_CONNECT_FAILED',
        message,
        elapsedMs: Date.now() - started,
      };
    }
  }

  /**
   * Maps top-level JSON keys to synthetic "containers" for the query sidebar.
   * **Cost:** one full read of the database root (no shallow REST in Admin SDK);
   * large trees can be slow or hit payload limits.
   */
  async listContainers(): Promise<TableInfo[]> {
    const snap = await this.handle.database.ref('/').once('value');
    const v = snap.val() as unknown;
    const names = topLevelKeysFromRootValue(v);
    return names.map((name) => ({ name, schema: null, tableType: 'rtdb-root' }));
  }

  /**
   * Read and return JSON-safe data at a path, enforcing size/depth limits.
   */
  async readPath(
    path: string,
    opts?: { maxBytes?: number; maxDepth?: number },
  ): Promise<{ value: unknown }> {
    const p = normalizeRtdbPath(path);
    const rel = p === '/' ? '' : p.replace(/^\//, '');
    const snap = await this.handle.database.ref(rel).once('value');
    if (!snap.exists()) {
      return { value: null };
    }
    const raw = snap.val() as unknown;
    const value = jsonSafeRtdbValue(raw, {
      maxBytes: opts?.maxBytes ?? MAX_RTDB_JSON_BYTES,
      maxDepth: opts?.maxDepth ?? MAX_RTDB_VALUE_DEPTH,
    });
    return { value };
  }

  async dispose(): Promise<void> {
    await this.handle.dispose();
  }
}
