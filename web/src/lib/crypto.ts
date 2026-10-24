import { argon2id } from 'hash-wasm'

const IV_BYTES = 12
const te = new TextEncoder()

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export function toB64url(u8: Uint8Array): string {
  return btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Argon2id -> 64 bytes: first half authenticates to the server, second half encrypts. */
export async function deriveKeys(
  password: string,
  salt: Uint8Array,
): Promise<{ authKey: Uint8Array; encKey: CryptoKey }> {
  const out = await argon2id({
    password,
    salt,
    memorySize: 65536,
    iterations: 3,
    parallelism: 1,
    hashLength: 64,
    outputType: 'binary',
  })
  const encKey = await crypto.subtle.importKey('raw', out.slice(32), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
  return { authKey: out.slice(0, 32), encKey }
}

/** Output is iv(12) || ciphertext; the pad name is bound as AAD. */
export async function encrypt(key: CryptoKey, data: Uint8Array, padName: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(padName) },
    key,
    data as BufferSource,
  )
  const out = new Uint8Array(IV_BYTES + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), IV_BYTES)
  return out
}

export async function decrypt(key: CryptoKey, data: Uint8Array, padName: string): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.slice(0, IV_BYTES), additionalData: te.encode(padName) },
    key,
    data.slice(IV_BYTES),
  )
  return new Uint8Array(pt)
}
