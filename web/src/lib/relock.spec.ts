import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import type { PadInfo } from './api'
import { afterLock, type Creds, type Resume, withFreshToken } from './relock'

const info: PadInfo = { name: 'a/b', protected: true, salt: 'salt1' }
const encKey = {} as CryptoKey
const creds: Creds = { token: 'old', encKey, authKey: new Uint8Array([1, 2, 3]) }

function fakeApi(pad: PadInfo, unlock: () => Promise<{ token: string; expiresAt: number }>) {
  return { getPad: vi.fn(async () => pad), unlock: vi.fn(unlock) }
}
const ok = async () => ({ token: 'new', expiresAt: 0 })

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

describe('withFreshToken', () => {
  const status = (n: number) =>
    new AxiosError('fail', String(n), undefined, undefined, { status: n } as AxiosResponse)

  it('passes the current token and does not unlock when the request succeeds', async () => {
    const unlock = vi.fn(ok)
    const request = vi.fn(async (token?: string) => token)
    expect(await withFreshToken('a/b', creds, request, vi.fn(), { unlock })).toBe('old')
    expect(unlock).not.toHaveBeenCalled()
  })

  it('401 (token expired): unlocks again with the kept authKey and retries once', async () => {
    const unlock = vi.fn(ok)
    const onToken = vi.fn()
    const request = vi
      .fn<(token?: string) => Promise<string>>()
      .mockRejectedValueOnce(status(401))
      .mockResolvedValueOnce('done')
    expect(await withFreshToken('a/b', creds, request, onToken, { unlock })).toBe('done')
    expect(unlock).toHaveBeenCalledWith('a/b', 'AQID')
    expect(onToken).toHaveBeenCalledWith('new')
    expect(request.mock.calls).toEqual([['old'], ['new']])
  })

  it('fails with the unlock error when the silent unlock fails', async () => {
    const wrong = status(401)
    const unlock = vi.fn(() => Promise.reject(wrong))
    const request = vi.fn(() => Promise.reject(status(401)))
    await expect(withFreshToken('a/b', creds, request, vi.fn(), { unlock })).rejects.toBe(wrong)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not retry other errors, or without a kept authKey', async () => {
    const unlock = vi.fn(ok)
    const e500 = status(500)
    await expect(
      withFreshToken('a/b', creds, () => Promise.reject(e500), vi.fn(), { unlock }),
    ).rejects.toBe(e500)
    const e401 = status(401)
    await expect(
      withFreshToken('a/b', { token: 'old' }, () => Promise.reject(e401), vi.fn(), { unlock }),
    ).rejects.toBe(e401)
    expect(unlock).not.toHaveBeenCalled()
  })
})
