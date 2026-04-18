import type { Firestore } from 'firebase-admin/firestore';
import type { Profile } from '@shared/types/profile';

export interface FirestoreHandle {
  profileId: string;
  projectId: string;
  kind: Profile['kind'];
  firestore: Firestore;
  dispose(): Promise<void>;
}
