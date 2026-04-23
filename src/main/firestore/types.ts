import type { Firestore } from 'firebase-admin/firestore';
import type { ProfileKind } from '@shared/types/profile';

export interface FirestoreHandle {
  profileId: string;
  projectId: string;
  kind: ProfileKind;
  firestore: Firestore;
  dispose(): Promise<void>;
}
