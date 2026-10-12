import { pbkdf2 } from './vendor/noble-hashes-1.7.1/pbkdf2.js';
import { sha256 } from './vendor/noble-hashes-1.7.1/sha256.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function decodeBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new TypeError('Invalid base64url value.');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function constantEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function passwordVerifier(password, salt, iterations) {
  // Hosted Workers can impose a native PBKDF2 limit absent in local Workerd.
  // Use the same portable standard derivation for initialization, login and
  // password rotation, retaining stored work factors and 32-byte hashes.
  return pbkdf2(sha256, encoder.encode(password), decodeBase64url(salt), {
    c: iterations, dkLen: 32,
  });
}

export async function encrypt(keyBytes, keyId, binding, plaintext) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: encoder.encode('myts-credential-v1:' + binding), tagLength: 128,
  }, key, encoder.encode(plaintext));
  return JSON.stringify({ version: 1, key_id: keyId, iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) });
}

export async function decrypt(keyBytes, keyId, binding, envelope) {
  const parsed = JSON.parse(envelope);
  if (parsed.version !== 1 || parsed.key_id !== keyId) throw new TypeError('Credential key does not match.');
  const iv = decodeBase64url(parsed.iv);
  if (iv.length !== 12) throw new TypeError('Invalid credential nonce.');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  return decoder.decode(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv, additionalData: encoder.encode('myts-credential-v1:' + binding), tagLength: 128,
  }, key, decodeBase64url(parsed.ciphertext)));
}
