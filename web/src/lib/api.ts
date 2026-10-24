import axios, { AxiosError } from 'axios'
import { i18n } from '@/i18n'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1',
})

export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000/ws'

const { t } = i18n.global

export interface PadInfo {
  name: string
  protected: boolean
  /** base64url, null on open pads. */
  salt: string | null
}

export interface Session {
  token: string
  /** ms since the epoch. */
  expiresAt: number
}

// encodeURIComponent: "a/b" travels as one path segment (a%2Fb), like the API expects.
const path = (name: string) => `/pads/${encodeURIComponent(name)}`
const bearer = (token?: string) => (token ? { Authorization: `Bearer ${token}` } : {})

export async function getPad(name: string): Promise<PadInfo> {
  return (await api.get<PadInfo>(path(name))).data
}

/** All binaries are base64url. */
export async function unlock(name: string, authKey: string): Promise<Session> {
  return (await api.post<Session>(`${path(name)}/unlock`, { authKey })).data
}

export async function setPassword(
  name: string,
  body: { salt: string; authKey: string; snapshot: string },
  token?: string,
): Promise<Session> {
  return (await api.put<Session>(`${path(name)}/password`, body, { headers: bearer(token) })).data
}

export async function removePassword(name: string, state: string, token?: string): Promise<void> {
  await api.delete(`${path(name)}/password`, { data: { state }, headers: bearer(token) })
}

export function errorStatus(error: unknown): number | undefined {
  return error instanceof AxiosError ? error.response?.status : undefined
}

/** One line to show the user. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof AxiosError)) return t('api.unexpected')
  if (!error.response) return t('api.unreachable')
  return t('api.status', { status: error.response.status })
}
