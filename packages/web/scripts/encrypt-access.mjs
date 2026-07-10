import { webcrypto as crypto } from 'node:crypto';
import readline from 'node:readline';

function askMasked(query) {
  return new Promise((resolve) => {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    terminal.question(query, (answer) => {
      terminal.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    terminal._writeToOutput = () => terminal.output.write('*');
  });
}

const password = await askMasked('New FareProof password: ');
if (!password) {
  console.error('A password is required.');
  process.exit(1);
}

const encoder = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt'],
);
const encryptedWithTag = new Uint8Array(
  await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode('fareproof-access-check')),
);
const tag = encryptedWithTag.slice(-16);
const ciphertext = encryptedWithTag.slice(0, -16);
const packed = new Uint8Array(44 + ciphertext.length);
packed.set(salt, 0);
packed.set(iv, 16);
packed.set(tag, 28);
packed.set(ciphertext, 44);

console.log('\nReplace PORT_COMPATIBLE_AUTH_VERIFIER in packages/web/src/auth.ts with:\n');
console.log(`'${Buffer.from(packed).toString('base64')}'\n`);