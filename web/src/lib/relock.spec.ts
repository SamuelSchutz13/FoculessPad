import { describe, expect, it, vi } from 'vitest'
import type { PadInfo } from './api'
import { afterLock, type Creds, type Resume } from './relock'

const info: PadInfo = { name: 'a/b', protected: true, salt: 'salt1' }
const encKey = {} as CryptoKey
const creds: Creds = { token: 'old', encKey, authKey: new Uint8Array([1, 2, 3]) }

function fakeApi(pad: PadInfo, unlock: () => Promise<{ token: string; expiresAt: string }>) {
  return { getPad: vi.fn(async () => pad), unlock: vi.fn(unlock) }
}
const ok = async () => ({ token: 'new', expiresAt: '' })

describe('afterLock', () => {
  it('uses our own password change (its 4409) instead of the lock screen', async () => {
    const api = fakeApi(info, ok)
    const mine: Resume = {
      info: { ...info, salt: 'salt2' },
      creds: { token: 'changed', encKey: {} as CryptoKey },
    }
    expect(await afterLock(info, creds, Promise.resolve(mine), api)).toBe(mine)
    expect(api.getPad).not.toHaveBeenCalled()
  })

  it('falls back when our change failed (the lock came from someone else)', async () => {
    const api = fakeApi({ ...info, salt: 'other' }, ok)
    const r = await afterLock(info, creds, Promise.reject(new Error('401')), api)
    expect(r.creds).toBeNull()
  })

  it('token expired, same salt: unlocks again silently, keeping the key (and the doc)', async () => {
    const api = fakeApi(info, ok)
    const r = await afterLock(info, creds, null, api)
    expect(api.unlock).toHaveBeenCalledWith('a/b', 'AQID')
    expect(r.creds).toEqual({ ...creds, token: 'new' })
  })

  it('asks for the password when the silent unlock fails', async () => {
    const api = fakeApi(info, () => Promise.reject(new Error('429')))
    expect((await afterLock(info, creds, null, api)).creds).toBeNull()
  })

  it('asks for the password when the salt changed (someone else set a new one)', async () => {
    const api = fakeApi({ ...info, salt: 'salt2' }, ok)
    expect((await afterLock(info, creds, null, api)).creds).toBeNull()
    expect(api.unlock).not.toHaveBeenCalled()
  })

  it('reconnects open when the password was removed', async () => {
    const open = { name: 'a/b', protected: false, salt: null }
    const r = await afterLock(info, creds, null, fakeApi(open, ok))
    expect(r).toEqual({ info: open, creds: {} })
  })
})
