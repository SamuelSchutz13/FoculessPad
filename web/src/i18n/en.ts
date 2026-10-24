import type ptBR from './pt-BR'

// Typed against the Portuguese messages so a missing or misspelled key fails the type-check.
const en: typeof ptBR = {
  app: {
    footer: 'Real-time notes. With a password, the server only stores encrypted content.',
    homeTitle: 'Notepad',
    github: 'Source code on GitHub',
  },
  theme: {
    toDark: 'Switch to dark mode',
    toLight: 'Switch to light mode',
  },
}

export default en
