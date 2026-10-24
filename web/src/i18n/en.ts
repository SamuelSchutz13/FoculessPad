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
  api: {
    unexpected: 'Unexpected error.',
    unreachable: 'Could not reach the server.',
    status: 'The server answered with error {status}.',
  },
  home: {
    title: 'Write without distractions',
    description: 'Pick a name, open the note and start writing. Nothing but your text.',
    label: 'Note name',
    placeholder: 'college/calculus',
    open: 'Open',
    invalid: 'Use lowercase letters, digits, "-" and "_", with "/" between parts (up to 200).',
  },
  pad: {
    status: {
      connecting: 'Connecting…',
      synced: 'Synced',
      locked: 'Locked',
      error: 'Error',
    },
    people: 'nobody | {n} person | {n} people',
    setPassword: 'Set password',
    managePassword: 'Note password',
    locked: 'The note password changed. Enter the password to continue.',
    tooLarge: 'Note full: the content exceeded the maximum size.',
    connectionError: 'The connection to the note failed.',
    loadError: 'Could not open the note.',
  },
  unlock: {
    title: 'Protected note',
    description: 'Enter the password to open it. It never leaves your browser.',
    password: 'Password',
    submit: 'Unlock',
    deriving: 'Checking…',
    wrong: 'Wrong password.',
    tooMany: 'Too many attempts. Wait a bit and try again.',
  },
  password: {
    titleSet: 'Set password',
    titleManage: 'Note password',
    warning: 'If you forget the password, the note is lost forever: nobody can recover it.',
    password: 'New password',
    confirm: 'Confirm password',
    empty: 'Enter a password.',
    mismatch: 'The passwords do not match.',
    set: 'Set password',
    change: 'Change password',
    remove: 'Remove password',
    removeHint: 'Without a password, anyone with the name reads the note and the server stores plain text.',
    working: 'Applying…',
    setDone: 'Password set.',
    changeDone: 'Password changed.',
    removeDone: 'Password removed.',
  },
}

export default en
