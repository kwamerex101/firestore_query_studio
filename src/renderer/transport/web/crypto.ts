import { getDb, SettingsKeys } from './db';

/**
 * Web Crypto wrapper used to keep sensitive values (today: just the LLM API
 * key) out of plaintext in IndexedDB.
 *
 * Threat model caveat: the AES-GCM key is generated with
 * `extractable: false` and stored as a `CryptoKey` object in IndexedDB.
 * Modern browsers persist `CryptoKey` objects opaquely, but a determined
 * attacker with local access to your browser profile can still decrypt the
 * data. This is WEAKER than the OS keychain the Electron shell uses, and
 * the UI must make that explicit via a BYOK security banner (see the
 * `web-auth` task). For real multi-tenant secret storage, fall back to an
 * OAuth flow or a cloud proxy — do NOT rely on this for anything you
 * wouldn't check into the repo.
 */

async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await getDb();
  const existing = (await db.get('settings', SettingsKeys.deviceKey)) as
    | CryptoKey
    | undefined;
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    // Non-extractable so the raw bytes can't be exfiltrated even if some
    // other script on the page accesses the `CryptoKey` object.
    false,
    ['encrypt', 'decrypt'],
  );
  await db.put('settings', key as unknown as never, SettingsKeys.deviceKey);
  return key;
}

export interface EncryptedBlob {
  iv: number[];
  ciphertext: number[];
}

export async function encryptString(plaintext: string): Promise<EncryptedBlob> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc,
  );
  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(cipher)),
  };
}

export async function decryptString(blob: EncryptedBlob): Promise<string> {
  const key = await getOrCreateKey();
  const iv = new Uint8Array(blob.iv);
  const ciphertext = new Uint8Array(blob.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plain);
}

export function isEncryptedBlob(v: unknown): v is EncryptedBlob {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as { iv?: unknown }).iv) &&
    Array.isArray((v as { ciphertext?: unknown }).ciphertext)
  );
}
