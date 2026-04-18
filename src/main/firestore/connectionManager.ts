import type { Profile } from '@shared/types/profile';
import type { FirestoreHandle } from './types';
import { connectEmulator, connectLive } from './adminClient';
import { getActiveProfileId, getProfile } from '../profiles/profileStore';

let current: FirestoreHandle | null = null;
let currentProfileId: string | null = null;

async function connectProfile(profile: Profile): Promise<FirestoreHandle> {
  return profile.kind === 'live' ? connectLive(profile) : connectEmulator(profile);
}

export async function disposeCurrent(): Promise<void> {
  if (current) {
    const handle = current;
    current = null;
    currentProfileId = null;
    await handle.dispose();
  }
}

export async function getHandleForActive(): Promise<FirestoreHandle> {
  const activeId = await getActiveProfileId();
  if (!activeId) throw new Error('No active profile is selected.');
  if (current && currentProfileId === activeId) {
    return current;
  }
  await disposeCurrent();
  const profile = await getProfile(activeId);
  if (!profile) throw new Error(`Active profile not found: ${activeId}`);
  current = await connectProfile(profile);
  currentProfileId = activeId;
  return current;
}

export async function onProfileChanged(): Promise<void> {
  // Called after profiles.setActive or when the active profile is edited.
  await disposeCurrent();
}
