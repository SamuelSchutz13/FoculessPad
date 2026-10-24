import { describe, expect, it } from 'vitest'
import type { PadStatus } from '@/lib/pad-provider'
import { i18n, locales } from '.'
import en from './en'
import ptBR from './pt-BR'

/** "a.b.c" for every leaf string. */
function keys(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([k, v]) =>
    typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('messages', () => {
  it('pt-BR and en have the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(ptBR).sort())
  })

  const statuses: PadStatus[] = ['connecting', 'synced', 'locked', 'error']
  it.each(locales)('%s labels every provider status', (locale) => {
    for (const s of statuses) expect(i18n.global.te(`pad.status.${s}`, locale)).toBe(true)
  })
})
