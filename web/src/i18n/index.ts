import { createI18n } from 'vue-i18n'
import en from './en'
import ptBR from './pt-BR'

export const locales = ['pt-BR', 'en'] as const
export type Locale = (typeof locales)[number]

const STORAGE_KEY = 'locale'

/** Saved choice first, then the browser language; English for anything but Portuguese. */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (locales.includes(saved as Locale)) return saved as Locale
  } catch {
    // Storage blocked (private mode): fall back to the browser language.
  }
  return globalThis.navigator?.language?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'pt-BR',
  messages: { 'pt-BR': ptBR, en },
})

export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  // Screen readers and the browser's own spell-check/translate use <html lang>.
  document.documentElement.lang = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Not persisted; the choice still applies to this visit.
  }
}
