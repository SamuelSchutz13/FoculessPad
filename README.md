<p align="center">
  <img src="web/public/favicon.svg" alt="" width="72" />
</p>

<h1 align="center">FoculessPad</h1>

<p align="center">
  <b>English</b> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  A real-time notepad in the style of dontpad: open an address, write, share it. No sign-up, and any note can get an end-to-end encrypted password.
</p>

<p align="center">
  <img alt="NestJS 12" src="https://img.shields.io/badge/NestJS-12-e0234e?logo=nestjs&logoColor=white" />
  <img alt="Vue 3" src="https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Node.js 22.13+" src="https://img.shields.io/badge/Node.js-22.13%2B-5fa04e?logo=nodedotjs&logoColor=white" />
  <img alt="Yjs" src="https://img.shields.io/badge/realtime-Yjs-ffb000" />
  <img alt="Swagger" src="https://img.shields.io/badge/docs-Swagger-85ea2d?logo=swagger&logoColor=black" />
</p>

> [!NOTE]
> **Protected notes are end-to-end encrypted.** Encryption runs in your browser. The server never sees the text or the password of a protected note, only encrypted bytes (and their size). Notes without a password are stored as plain text, so anyone who knows the address can read and edit them.

> [!WARNING]
> **Forgot the password, lost the note.** There is no recovery: the server cannot decrypt anything. Keep the password somewhere safe.

## Features

- **A note per address**: open `/my-notes` (or `/college/calculus`) and it is created on first access and saved automatically.
- **Real-time editing** with [Yjs](https://yjs.dev): everyone on the same note sees the edits as they happen, and simultaneous typing never overwrites anyone.
- **Presence**: shows how many people are on the note right now.
- **Optional password per note**, with end-to-end encryption. Set, change or remove it (changing and removing need the current password).
- **Brute-force protection**: per-IP limit on unlock attempts and a temporary lock on the note.
- **Website** in English and Portuguese, with pastel **light and dark modes**.
- **Documented API** with Swagger at `/docs`.

## Getting started

All you need is [Node.js](https://nodejs.org) **22.13 or newer**.

```sh
git clone https://github.com/SamuelSchutz13/FoculessPad.git
cd FoculessPad

# terminal 1: API (http://localhost:3000, docs at /docs)
npm install
npm run start:dev

# terminal 2: website (http://localhost:5173)
cd web
npm install
npm run dev
```

Open **http://localhost:5173**.

### Configuration

Every variable has a default, except `APP_SECRET` in production. To change one, copy `.env.example` to `.env`, at the root for the API or in `web/` for the website.

| Where   | Variable                       | Default                        | Description                                                                       |
| ------- | ------------------------------ | ------------------------------ | --------------------------------------------------------------------------------- |
| API     | `PORT`                         | `3000`                         | API port                                                                          |
| API     | `CORS_ORIGINS`                 | `http://localhost:5173`        | Allowed website origins, comma-separated                                          |
| API     | `DATABASE_PATH`                | `data/foculesspad.sqlite`      | SQLite file                                                                       |
| API     | `APP_SECRET`                   | random in dev                  | Signs unlock tokens. Required when `NODE_ENV=production` (32+ characters advised) |
| API     | `SESSION_TTL_MINUTES`          | `60`                           | How long an unlocked session lasts                                                |
| API     | `MAX_PAD_SIZE_KB`              | `512`                          | Largest content per note (see below)                                              |
| API     | `RATE_LIMIT_PER_MINUTE`        | `60`                           | Requests per minute, per IP                                                       |
| API     | `UNLOCK_RATE_LIMIT_PER_MINUTE` | `5`                            | Unlock attempts per minute, per IP                                                |
| Website | `VITE_API_URL`                 | `http://localhost:3000/api/v1` | API address                                                                       |
| Website | `VITE_WS_URL`                  | `ws://localhost:3000/ws`       | WebSocket address                                                                 |

An invalid value (e.g. `PORT=abc`) stops the API from starting, with a message naming the variable. Without `APP_SECRET` in development the API generates a random one and logs a warning; unlock sessions then reset on every restart.

**Limits.** Each note's content is capped at `MAX_PAD_SIZE_KB`. For protected notes the server may store up to twice that (the encrypted snapshot plus encrypted edits waiting to be compacted). A connection that sends more than 60 sync messages per second is closed; the website batches typing every ~50 ms, so normal use stays far below that.

### Scripts

| Folder | Command              | What it does                                       |
| ------ | -------------------- | -------------------------------------------------- |
| root   | `npm run start:dev`  | API with hot reload                                |
| root   | `npm run build`      | Builds the API into `dist/`                        |
| root   | `npm run start:prod` | Runs the API build                                 |
| root   | `npm test`           | API unit tests                                     |
| root   | `npm run test:e2e`   | API end-to-end (HTTP and WebSocket) tests          |
| root   | `npm run lint`       | ESLint (`lint:fix` also fixes what it can)         |
| root   | `npm run format`     | Prettier, writing the changes                      |
| `web`  | `npm run dev`        | Website in development mode                        |
| `web`  | `npm test`           | Website tests (crypto, note names, sync provider)  |
| `web`  | `npm run type-check` | Type checking                                      |
| `web`  | `npm run build`      | Type checking and production build into `web/dist` |

## How the password works

Everything below runs in the browser; the password and the encryption key never leave it.

1. **Keys.** The password goes through Argon2id (64 MiB, 3 passes, 1 lane) with a random 16-byte salt per note, producing 64 bytes. The first 32 are the `authKey` (proves you know the password) and the last 32 are the `encKey` (AES-256-GCM, imported as a non-extractable key).
2. **What the server stores.** The salt, `SHA-256(authKey)`, an encrypted snapshot and the encrypted edits not yet compacted. Never readable text.
3. **Unlocking.** The site asks for the note and gets only `{ protected, salt }`, no content. It derives the keys and sends the `authKey`; the server compares its hash in constant time and answers with a session token (HMAC of note, key version and expiry, valid for `SESSION_TTL_MINUTES`). Without a token the server sends no content at all, not even encrypted, over REST or WebSocket.
4. **Editing.** Each Yjs update becomes `iv (12 bytes) || AES-GCM(update)`, with the note name as additional authenticated data, so encrypted content cannot be copied into another note. The server only stores and relays it.
5. **Compaction.** After 200 pending edits the server asks a connected browser for an encrypted snapshot of the whole note and swaps the covered edits for it.
6. **Setting, changing, removing.** Setting a password encrypts the current state in the browser; the server saves it in one transaction, erases the readable state and disconnects everyone, who must unlock to come back. Changing re-encrypts with new keys and invalidates old tokens. Removing sends the plain state back and the note becomes open again.
7. **Brute force.** 5 unlock attempts per minute per IP (`UNLOCK_RATE_LIMIT_PER_MINUTE`), and a note locks for 15 minutes after 10 wrong passwords.
8. **In the tab only.** Keys and token live in the tab's memory: reloading asks for the password again. Nothing sensitive goes to `localStorage`.

> [!IMPORTANT]
> The server does see the **size** of a protected note, because the encrypted bytes are as big as the text. That leak is accepted.

## How it works

```
web/   Vue 3 + Vite + CodeMirror 6 + Yjs  →  REST (/api/v1) + WebSocket (/ws)  →  NestJS API  →  SQLite (TypeORM)
```

- **Open notes**: the server keeps one Yjs document per note in memory while someone is connected, and writes it to SQLite after 2 s of quiet and when the last person leaves.
- **Note names**: lowercase, segments of `a-z 0-9 _ -` separated by `/`, up to 200 characters. `College/Calculus` and `college/calculus` are the same note.
- **Errors**: every error response has the same shape, with `message` always a list.

  ```json
  { "statusCode": 401, "error": "Unauthorized", "message": ["Wrong password"] }
  ```

- **API protection**: rate limiting per IP (`429`), security headers with helmet, and CORS restricted to the configured origins.

### Endpoints (`/api/v1`)

| Method | Route                  | Purpose                                      |
| ------ | ---------------------- | -------------------------------------------- |
| GET    | `/health`              | Health check                                 |
| GET    | `/pads/:name`          | `{ protected, salt }`, never the content     |
| POST   | `/pads/:name/unlock`   | Sends the `authKey`, returns a session token |
| PUT    | `/pads/:name/password` | Sets or changes the password                 |
| DELETE | `/pads/:name/password` | Removes the password                         |

Binary values are base64url. Names with `/` go through `encodeURIComponent`. The content itself travels over the WebSocket at `/ws`. Full details at `/docs`.

### Project structure

```
src/                          API (NestJS)
  main.ts, app.module.ts      bootstrap and module registration
  app.setup.ts                prefix, versioning, validation, CORS, helmet, Swagger (also used by e2e)
  config/env.ts               reading and validating .env
  common/filters/             single error shape (+ tests)
  modules/health/             health check
  modules/pads/               notes: REST, WebSocket gateway, rooms, tokens, lockout (+ tests)
test/                         end-to-end tests
web/                          website (Vue): views, components, lib/crypto.ts, lib/pad-provider.ts
```

## Known limitations

- **Single API instance.** Rate limits, the password lockout and the live rooms are in memory. With more than one instance they would not be shared; move them to Redis first.
- Behind a proxy you need to enable `trust proxy`, or every visitor shares one IP for the rate limits.
- Notes without a password are open to anyone who guesses the address, so pick a hard-to-guess name or set a password.
- No accounts, history, attachments, rich text, other people's cursors or password recovery.
- On Windows, network filters such as AdGuard intercept `localhost` and can make e2e tests fail now and then with `ECONNRESET`. Add `node.exe` to its exceptions.

## Credits

- Real time: [Yjs](https://yjs.dev) and [CodeMirror](https://codemirror.net). Encryption: WebCrypto and [hash-wasm](https://github.com/Daninet/hash-wasm) (Argon2id).
- API: [NestJS](https://nestjs.com). Website: [Vue](https://vuejs.org), [Vite](https://vite.dev) and [Tailwind CSS](https://tailwindcss.com).
- UI components: [shadcn-vue](https://www.shadcn-vue.com) and [Reka UI](https://reka-ui.com). Icons: [Lucide](https://lucide.dev).
- Font: [Geist](https://vercel.com/font) by Vercel (SIL Open Font License), served by the website itself.
- Inspired by [dontpad](https://dontpad.com). Same structure as [FoculessYT](https://github.com/SamuelSchutz13/FoculessYT).
