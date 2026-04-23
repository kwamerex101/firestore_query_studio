import type { Firestore } from 'firebase-admin/firestore';
import type { FirestoreProfile } from '@shared/types/profile';
import type { DatabaseDriver, TableInfo, TestConnectionOutcome } from './types';
import { connectEmulator, connectLive } from '../firestore/adminClient';
import type { FirestoreHandle } from '../firestore/types';

export class FirestoreDriver implements DatabaseDriver {
  readonly engine = 'firestore' as const;

  private constructor(
    readonly profile: FirestoreProfile,
    readonly handle: FirestoreHandle,
  ) {}

  static async connect(profile: FirestoreProfile): Promise<FirestoreDriver> {
    const handle =
      profile.kind === 'live' ? await connectLive(profile) : await connectEmulator(profile);
    return new FirestoreDriver(profile, handle);
  }

  /** Used by legacy Firestore-only code paths (executor, schema sampler). */
  get firestore(): Firestore {
    return this.handle.firestore;
  }

  get profileId(): string {
    return this.handle.profileId;
  }

  async testConnection(): Promise<TestConnectionOutcome> {
    const started = Date.now();
    try {
      // `listCollections()` is the cheapest Admin SDK round-trip that also
      // proves IAM + project match. For the emulator this still hits the
      // server and surfaces connection-refused errors.
      await this.handle.firestore.listCollections();
      return {
        ok: true,
        elapsedMs: Date.now() - started,
        detail:
          this.profile.kind === 'emulator'
            ? `emulator @ ${this.profile.host}:${this.profile.port}`
            : `live (Admin SDK) · ${this.profile.projectId}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: 'FIRESTORE_CONNECT_FAILED',
        message,
        elapsedMs: Date.now() - started,
      };
    }
  }

  async listContainers(): Promise<TableInfo[]> {
    const cols = await this.handle.firestore.listCollections();
    return cols.map((c) => ({ name: c.id, schema: null, tableType: 'collection' }));
  }

  async dispose(): Promise<void> {
    await this.handle.dispose();
  }
}
