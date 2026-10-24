import { describe, expect, it } from 'vitest'
import { decrypt, deriveKeys, encrypt, fromB64url, randomSalt, toB64url } from './crypto'

const data = new TextEncoder().encode('olá, mundo')

describe('crypto', () => {
  it('round-trips encrypt/decrypt', async () => {
    const { encKey } = await deriveKeys('s', randomSalt())
    expect(await decrypt(encKey, await encrypt(encKey, data, 'a'), 'a')).toEqual(data)
  })

  it('rejects decrypt under another pad name', async () => {
    const { encKey } = await deriveKeys('s', randomSalt())
    await expect(decrypt(encKey, await encrypt(encKey, data, 'a'), 'b')).rejects.toThrow()
  })

  it('uses a random IV', async () => {
    const { encKey } = await deriveKeys('s', randomSalt())
    expect(await encrypt(encKey, data, 'a')).not.toEqual(await encrypt(encKey, data, 'a'))
  })

  it('derives a stable 32-byte authKey, different per salt', async () => {
    const salt = randomSalt()
    expect(salt).toHaveLength(16)
    const a = await deriveKeys('s', salt)
    const b = await deriveKeys('s', salt)
    const c = await deriveKeys('s', randomSalt())
    expect(a.authKey).toHaveLength(32)
    expect(a.authKey).toEqual(b.authKey)
    expect(a.authKey).not.toEqual(c.authKey)
  })

  it('round-trips base64url', () => {
    const u8 = new Uint8Array([0, 251, 255, 62, 63, 1])
    expect(toB64url(u8)).not.toMatch(/[+/=]/)
    expect(fromB64url(toB64url(u8))).toEqual(u8)
  })
})
