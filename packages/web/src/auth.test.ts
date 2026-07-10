import { describe, expect, it } from 'vitest';
import { verifyAccessPassword } from './auth';

async function createVerifier(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const encryptedWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode('fareproof-access-check'),
    ),
  );
  const tag = encryptedWithTag.slice(-16);
  const ciphertext = encryptedWithTag.slice(0, -16);
  const packed = new Uint8Array(44 + ciphertext.length);
  packed.set(salt, 0);
  packed.set(iv, 16);
  packed.set(tag, 28);
  packed.set(ciphertext, 44);
  return btoa(String.fromCharCode(...packed));
}

describe('verifyAccessPassword', () => {
  it('unlocks a verifier encrypted with the supplied password', async () => {
    const verifier = await createVerifier('correct-password');

    await expect(verifyAccessPassword('correct-password', verifier)).resolves.toBeUndefined();
  });

  it('rejects a different password', async () => {
    const verifier = await createVerifier('correct-password');

    await expect(verifyAccessPassword('wrong-password', verifier)).rejects.toThrow();
  });
});