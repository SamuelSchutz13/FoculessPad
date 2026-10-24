import { errorStatus, getPad, type PadInfo, unlock } from './api'
import { toB64url } from './crypto'

/** What a PadProvider needs (empty for an open pad), kept in memory only. */
export interface Creds {
  token?: string
  encKey?: CryptoKey
  /** Kept to get a fresh token when ours expires (4401) without asking for the password. */
  authKey?: Uint8Array
}

export interface Resume {
  info: PadInfo
  /** Reconnect with these on the SAME Y.Doc (its unsent edits get resent); null: ask for the password. */
  creds: Creds | null
}

/**
 * Decides what follows a `locked` status.
 * - Our own password change in flight: its result (the 4409 was ours).
 * - Pad is now open: reconnect open.
 * - Same salt (password unchanged, token expired): unlock again with the kept authKey.
 * - Otherwise (someone else changed it, or the silent unlock failed): ask for the password.
 */
export async function afterLock(
  info: PadInfo,
  creds: Creds,
  change: Promise<Resume> | null,
  api = { getPad, unlock },
): Promise<Resume> {
  if (change) {
    try {
      return await change
    } catch {
      // Our change failed, so the lock came from someone else: fall through.
    }
  }
  const fresh = await api.getPad(info.name)
  if (!fresh.protected) return { info: fresh, creds: {} }
  if (creds.authKey && creds.encKey && fresh.salt === info.salt) {
    try {
      const { token } = await api.unlock(fresh.name, toB64url(creds.authKey))
      return { info: fresh, creds: { ...creds, token } }
    } catch {
      // Wrong now, throttled or offline: the lock screen handles all of those.
    }
  }
  return { info: fresh, creds: null }
}

/**
 * Runs a request that needs the session token. The open socket never renews it, so after
 * SESSION_TTL_MINUTES the server answers 401: unlock again with the kept authKey, report the
 * new token, and retry once. Any other failure (or a failed unlock) is thrown to the caller.
 */
export async function withFreshToken<T>(
  name: string,
  creds: Creds,
  request: (token?: string) => Promise<T>,
  onToken: (token: string) => void,
  api = { unlock },
): Promise<T> {
  try {
    return await request(creds.token)
  } catch (error) {
    if (errorStatus(error) !== 401 || !creds.authKey) throw error
  }
  const { token } = await api.unlock(name, toB64url(creds.authKey))
  onToken(token)
  return request(token)
}
