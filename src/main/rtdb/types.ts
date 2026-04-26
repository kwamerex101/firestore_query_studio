import type { Database } from 'firebase-admin/database';
import type { ProfileKind } from '@shared/types/profile';

export interface RtdbHandle {
  profileId: string;
  projectId: string;
  kind: ProfileKind;
  database: Database;
  /**
   * Restores `FIREBASE_DATABASE_EMULATOR_HOST` to its previous value when
   * set by this handle (emulator only).
   */
  dispose(): Promise<void>;
}
