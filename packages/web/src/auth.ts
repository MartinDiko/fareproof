const PORT_COMPATIBLE_AUTH_VERIFIER =
  'Nrr8CgZFHY14IT+4xFjC3uYTqjsXryAPzTS1+QdTSxr+ExrsfnlPeGoudbvbpjtu1gYPIay026P+nzDPVPT4Ad/8UVewoCH7ZeYrWSIxjHGIkn3P';

export const FAREPROOF_AUTH_VERIFIER =
  import.meta.env.VITE_FAREPROOF_AUTH_VERIFIER || PORT_COMPATIBLE_AUTH_VERIFIER;

export async function verifyAccessPassword(
  password: string,
  verifier = FAREPROOF_AUTH_VERIFIER,
): Promise<void> {
  if (!password || !verifier) throw new Error('Password is required.');
  const packed = Uint8Array.from(atob(verifier), (character) => character.charCodeAt(0));
  if (packed.length <= 44) throw new Error('Access verifier is invalid.');

  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const tag = packed.slice(28, 44);
  const ciphertext = packed.slice(44);
  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(tag, ciphertext.length);

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
    ['decrypt'],
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextWithTag),
  );
  if (!plaintext.length) throw new Error('Access verifier is invalid.');
  plaintext.fill(0);
}