# FoculessPad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bloco de notas por URL estilo dontpad, com edição em tempo real (Yjs) e senha opcional com criptografia de ponta a ponta.

**Architecture:** API NestJS na raiz (REST para metadados/senha + WebSocket `/ws` para sync), SQLite via TypeORM. Notas abertas: o servidor mantém um `Y.Doc` e faz o merge. Notas protegidas: o servidor só guarda e repassa blobs AES-GCM que o navegador cifra. Site Vue 3 em `web/` com CodeMirror 6 + `y-codemirror.next`.

**Tech Stack:** NestJS 12, TypeORM + better-sqlite3, @nestjs/platform-ws, yjs, y-protocols, lib0, Jest/supertest, ESLint + Prettier · Vue 3, Vite, Tailwind 4, shadcn-vue, vue-router, vue-i18n, CodeMirror 6, hash-wasm, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-foculesspad-design.md`

**Referência de método:** `git clone https://github.com/SamuelSchutz13/FoculessYT.git` num diretório temporário. Quando um passo diz "copiar do FoculessYT", copie o arquivo e troque nomes (`FoculessYT` → `FoculessPad`, `foculess-yt` → `foculess-pad`) e o conteúdo específico de download.

## Global Constraints

- Node 22.13+; TypeScript strict; mesmas versões de dependências do `package.json` do FoculessYT para tudo que já existe lá.
- **Proibido Biome.** Lint = ESLint flat config (`@eslint/js` + `typescript-eslint` recommended + `eslint-config-prettier`), só na API (ignora `web/`, `dist/`, `coverage/`). Prettier: `tabWidth 2`, `printWidth 100`, `singleQuote true`, `trailingComma "all"`, `semi true`.
- Toda env tem padrão, é validada em `src/config/env.ts` (API falha ao iniciar se inválida) e listada em `.env.example` e no README: `PORT=3000`, `CORS_ORIGINS=http://localhost:5173`, `DATABASE_PATH=data/foculesspad.sqlite`, `APP_SECRET` (obrigatória se `NODE_ENV=production`; em dev, ausente → aleatória + `Logger.warn`), `SESSION_TTL_MINUTES=60`, `MAX_PAD_SIZE_KB=512`, `RATE_LIMIT_PER_MINUTE=60`, `UNLOCK_RATE_LIMIT_PER_MINUTE=5`. Site: `VITE_API_URL=http://localhost:3000/api/v1`, `VITE_WS_URL=ws://localhost:3000/ws`.
- Nome de nota: minúsculo, segmentos `[a-z0-9_-]+` separados por `/`, total ≤ 200 chars.
- Argon2id: m = 65536 KiB, t = 3, p = 1, hashLength 64, salt 16 bytes. `authKey` = bytes 0–31, `encKey` = bytes 32–63 (AES-256-GCM, não extraível). Cifrado = `iv(12) || ciphertext`, AAD = `TextEncoder(nome)`.
- Servidor guarda `SHA-256(authKey)`, compara com `crypto.timingSafeEqual`. Nunca grava estado legível de nota protegida; nunca envia conteúdo (nem cifrado) sem token válido.
- Lockout por nota: 10 falhas → bloqueado 15 min. Debounce de persistência 2000 ms. Compactação a partir de 200 updates pendentes.
- Binários em base64url no REST.
- Conventional Commits. Branches: `feat/api` (Tasks 1–3), `feat/web` (Tasks 4–5), `docs/readme` (Task 6), cada uma entra em `main` por PR. **Push e PR só depois de confirmar com o usuário.** Todo commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comentários `shortcut: <limite>, <quando trocar>` em tudo que fica em memória (throttler, lockout, rooms).

## Review Focus

1. **Colocar senha numa nota aberta com gente conectada:** o `Y.Doc` legível em memória tem que ser descartado sem flush; senão o debounce regrava texto puro no banco. → teste em Task 3.
2. **Update cifrado chegando durante a compactação:** updates com `seq > upToSeq` precisam sobreviver à troca pelo snapshot. → teste em Task 3.
3. **Mesmo nome por caminhos diferentes:** `Faculdade/Calculo` no REST (`encodeURIComponent` → `%2F`) e no WS precisam cair na mesma linha do banco. → teste em Task 2.
4. **Token reaproveitado:** token da nota A usado na B, ou token anterior a uma troca de senha, é rejeitado no REST e no WS. → testes em Tasks 2 e 3.
5. **Conteúdo acima do limite:** update/snapshot WS > `MAX_PAD_SIZE_KB` fecha com 4413 sem derrubar o processo; body JSON de `PUT /password` com snapshot no limite é aceito (limite do body = `MAX_PAD_SIZE_KB * 1.4 + 16 KB`). → teste em Task 3 e Task 2.

---

### Task 1: Esqueleto da API (método FoculessYT, sem Biome)

Branch: `git checkout -b feat/api`

**Files:**
- Create: `package.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`, `.gitignore` (+ `data/`), `.gitattributes`, `.env.example`, `eslint.config.mjs`, `.prettierrc`, `src/main.ts`, `src/app.setup.ts`, `src/app.module.ts`, `src/config/env.ts`, `src/common/filters/all-exceptions.filter.ts` (+ `.spec.ts`), `src/modules/health/*`, `test/jest-e2e.json`, `test/app.e2e-spec.ts`, `src/config/env.spec.ts`
- Copiar do FoculessYT: tsconfigs, nest-cli, `.gitattributes`, filtro + spec, health, `test/jest-e2e.json`, `main.ts`, scripts e config `jest` do `package.json`.

**Interfaces:**
- Produces: `env` com `{ port, corsOrigins, databasePath, appSecret, sessionTtlMinutes, maxPadSizeKb, rateLimitPerMinute, unlockRateLimitPerMinute }`; `configureApp(app)`; `AppModule` com `TypeOrmModule.forRoot({ type: 'better-sqlite3', database: env.databasePath, autoLoadEntities: true, synchronize: true })` *(synchronize: shortcut, trocar por migrations quando houver dado real em produção)*.

- [ ] **Step 1:** `package.json` = o do FoculessYT sem `@biomejs/biome`, `ffmpeg-static`, `postinstall`, `yt-dlp:update`, `allowScripts` do ffmpeg; com `"lint": "eslint ."`, `"lint:fix": "eslint . --fix"`, `"format": "prettier --write ."`; deps novas `@nestjs/typeorm typeorm better-sqlite3 @nestjs/websockets @nestjs/platform-ws ws yjs y-protocols lib0`; dev `eslint @eslint/js typescript-eslint eslint-config-prettier prettier @types/ws`; `allowScripts` para `better-sqlite3`. `npm install`.
- [ ] **Step 2: teste falhando** `src/config/env.spec.ts`: `parseEnv({ PORT: 'abc' })` lança erro contendo `PORT`; `parseEnv({})` retorna `port 3000`, `maxPadSizeKb 512`, `sessionTtlMinutes 60`, `unlockRateLimitPerMinute 5`, `appSecret` com ≥ 32 bytes; `parseEnv({ NODE_ENV: 'production' })` lança erro contendo `APP_SECRET`.
- [ ] **Step 3:** `npm test -- env` → FAIL (`parseEnv` não existe).
- [ ] **Step 4:** em `env.ts` exportar `parseEnv(source: NodeJS.ProcessEnv): Env` (helpers `positiveInt`/`list` como no FoculessYT) e `export const env = parseEnv(process.env)` após `loadEnvFile`.
- [ ] **Step 5:** `app.setup.ts` como no FoculessYT (sem `exposedHeaders`), título Swagger `FoculessPad API`, mais `app.useBodyParser('json', { limit: <limite da Review Focus 5> })` e `app.useWebSocketAdapter(new WsAdapter(app))`. Throttler global com `env.rateLimitPerMinute`.
- [ ] **Step 6:** `npm test && npm run test:e2e && npm run lint && npm run build` → tudo verde (e2e de health: `GET /api/v1/health` → 200).
- [ ] **Step 7: Commit** `feat(api): NestJS skeleton with SQLite, ESLint and Prettier`

### Task 2: Módulo de notas (REST, senha, token, lockout)

**Files:**
- Create em `src/modules/pads/`: `pad.entity.ts`, `pad-update.entity.ts`, `pad-name.ts`, `session-token.service.ts`, `unlock-lockout.ts`, `pads.service.ts`, `pads.controller.ts`, `pads.module.ts`, `dto/unlock.dto.ts`, `dto/set-password.dto.ts`, `dto/remove-password.dto.ts`, specs `pad-name.spec.ts`, `session-token.service.spec.ts`, `unlock-lockout.spec.ts`, `pads.service.spec.ts`; `test/pads.e2e-spec.ts`
- Modify: `src/app.module.ts` (importa `PadsModule`)

**Interfaces:**
- Produces:
  - `Pad { name: string (PK); state: Buffer | null; salt: Buffer | null; verifier: Buffer | null; keyVersion: number (default 0); snapshot: Buffer | null; nextSeq: number (default 1); updatedAt: Date }` — protegida ⇔ `verifier !== null`.
  - `PadUpdate { id: number (PK auto); padName: string (index); seq: number; data: Buffer }`.
  - `normalizePadName(raw: string): string` — lança `BadRequestException`.
  - `SessionTokenService.sign(name: string, keyVersion: number): { token: string; expiresAt: number }`; `.verify(token: string | undefined, name: string, keyVersion: number): boolean`. Token = `base64url(JSON {n,v,e}) + '.' + base64url(HMAC-SHA256(appSecret, parte1))`.
  - `UnlockLockout(now = Date.now)`: `isLocked(name): boolean`, `recordFailure(name): void`, `reset(name): void`.
  - `PadsService.getInfo(name) → { name; protected: boolean; salt: string | null }`; `.unlock(name, authKey: Buffer) → { token; expiresAt }`; `.setPassword(name, { salt, authKey, snapshot }: Buffer×3, token?: string) → { token; expiresAt }`; `.removePassword(name, token, state: Buffer) → void`; `.findOrNull(name): Promise<Pad | null>`.
  - `PadsService` aceita um hook `onKeyChange: (name: string) => void` (setado pela Task 3) chamado **depois** do commit de `setPassword`/`removePassword`.
  - Rotas (`:name` = `encodeURIComponent(nome)`): `GET /pads/:name`, `POST /pads/:name/unlock` `{authKey}` (Throttle `unlockRateLimitPerMinute`), `PUT /pads/:name/password` `{salt, authKey, snapshot}` + `Authorization: Bearer` se já protegida, `DELETE /pads/:name/password` `{state}` + Bearer → 204.

- [ ] **Step 1: testes falhando (unit):**
  - `normalizePadName('Faculdade/Calculo') === 'faculdade/calculo'`; lança para `''`, `'a//b'`, `'../x'`, `'a b'`, `'x'.repeat(201)`.
  - token: `verify(sign('a',0).token,'a',0) === true`; `false` para nome `'b'`, `keyVersion 1`, token expirado (relógio avançado `sessionTtlMinutes`+1 min), assinatura alterada, `undefined`.
  - lockout: 9 falhas → `isLocked false`; 10ª → `true`; após 15 min → `false`; `reset` zera.
  - service: `setPassword` numa nota com `state` → linha final tem `state === null`, `verifier = sha256(authKey)`, `keyVersion` +1, `PadUpdate`s apagados, `onKeyChange` chamado; `unlock` com chave errada → `UnauthorizedException` e `recordFailure`; nota bloqueada → `HttpException 429` mesmo com chave certa; `setPassword` em nota protegida sem token válido → 401; `removePassword` → `verifier/salt/snapshot null`, `state` = enviado, `keyVersion` +1.
- [ ] **Step 2:** `npm test -- pads` → FAIL.
- [ ] **Step 3:** implementar arquivos acima; transações com `dataSource.transaction`; comparar com `timingSafeEqual` (tamanhos iguais garantidos pelo DTO: `authKey` decodifica para 32 bytes, `salt` para 16); `snapshot` > `maxPadSizeKb` → 413.
- [ ] **Step 4:** `test/pads.e2e-spec.ts`: `GET /pads/Faculdade%2FCalculo` → `{ name: 'faculdade/calculo', protected: false, salt: null }`; após `PUT password`, `GET` → `protected: true`, `salt` = enviado, **corpo não contém `snapshot` nem `state`**; `unlock` errado → 401; 6º `unlock` no mesmo minuto → 429; token da nota A em `DELETE /pads/b/password` → 401; `PUT password` com snapshot de exatamente `maxPadSizeKb` KB → 200.
- [ ] **Step 5:** `npm test && npm run test:e2e && npm run lint` → verde.
- [ ] **Step 6: Commit** `feat(api): pads with optional end-to-end password`

### Task 3: Tempo real (gateway WS, rooms, compactação)

**Files:**
- Create em `src/modules/pads/`: `protocol.ts`, `rooms.service.ts`, `pads.gateway.ts`, `rooms.service.spec.ts`; `test/realtime.e2e-spec.ts`
- Modify: `pads.module.ts`, `pads.service.ts` (liga `onKeyChange` → `rooms.closeAll(name, 4409)`)

**Interfaces:**
- Produces `protocol.ts` (copiado tal qual para `web/src/lib/protocol.ts` na Task 5): mensagens binárias, 1º varUint = tipo (lib0 `encoding`):
  - `SYNC = 0` — payload y-protocols/sync (só nota aberta)
  - `PRESENCE = 1` — server→client, varUint `count`
  - `ENC_UPDATE = 2` — client→server `varUint8Array data`; server→outros `varUint8Array data`
  - `ENC_INIT = 3` — server→client `varUint8Array snapshot` (vazio se nenhum), varUint `n`, n × `varUint8Array`
  - `COMPACT_REQ = 4` — server→client varUint `upToSeq`
  - `ENC_SNAPSHOT = 5` — client→server varUint `upToSeq`, `varUint8Array data`
  - Close codes: `4400` nome inválido, `4401` sem/token inválido, `4409` senha mudou, `4413` grande demais.
- URL: `/ws?pad=<encodeURIComponent(nome)>&token=<token opcional>`.
- `RoomsService`: `join(name, socket, protectedPad: boolean): Promise<void>`, `leave(socket)`, `closeAll(name, code)`, `presence(name): number`.

- [ ] **Step 1: testes falhando** (`realtime.e2e-spec.ts`, app real em porta efêmera, clientes `ws` + `Y.Doc` com y-protocols):
  - dois clientes numa nota aberta: texto inserido em A aparece em B; após ambos saírem, nova conexão recebe o texto (persistiu); ambos recebem `PRESENCE 2`.
  - nota protegida sem token → close 4401 **sem nenhuma mensagem antes**; token da nota A na nota B → 4401.
  - nota aberta com A conectado e editando; `PUT password` → A recebe close 4409; esperar 2500 ms; linha no banco tem `state === null` (Review Focus 1).
  - protegida: A envia 3 `ENC_UPDATE`, B conecta e recebe `ENC_INIT` com 3 updates na ordem.
  - compactação: com 200 updates pendentes o servidor manda `COMPACT_REQ upToSeq=200`; cliente envia update 201 e depois `ENC_SNAPSHOT(200)`; nova conexão recebe snapshot + exatamente `[update 201]` (Review Focus 2).
  - `ENC_UPDATE` de `maxPadSizeKb` KB + 1 → close 4413; processo segue respondendo `/health`.
- [ ] **Step 2:** `npm run test:e2e -- realtime` → FAIL.
- [ ] **Step 3:** `pads.gateway.ts`: `@WebSocketGateway({ path: '/ws' })` implementando `OnGatewayConnection`; em `handleConnection(socket, req)` lê `pad`/`token` de `req.url`, normaliza, valida token com `keyVersion` atual, chama `rooms.join`; mensagens via `socket.on('message')` (binário cru, não `@SubscribeMessage`). Checar origem contra `env.corsOrigins`.
- [ ] **Step 4:** `rooms.service.ts`: room aberta = `Y.Doc` carregado de `pad.state`, `doc.on('update')` → broadcast `SYNC` + flush debounced 2000 ms (`Y.encodeStateAsUpdate`), flush imediato quando a room esvazia. Room protegida = só sockets; `ENC_UPDATE` grava `PadUpdate { seq: pad.nextSeq++ }` e repassa aos outros; ao atingir 200 pendentes manda `COMPACT_REQ` a um socket; `ENC_SNAPSHOT(upToSeq)` grava snapshot e apaga `seq ≤ upToSeq` numa transação. `closeAll` cancela o debounce e **descarta o Doc sem flush** antes de fechar os sockets. Comentário `shortcut: rooms em memória, uma instância só; trocar por Redis pub/sub ao escalar`.
- [ ] **Step 5:** `npm test && npm run test:e2e && npm run lint && npm run build` → verde.
- [ ] **Step 6: Commit** `feat(api): real-time sync over WebSocket with Yjs`
- [ ] **Step 7:** perguntar ao usuário antes de `git push -u origin feat/api` e abrir o PR; merge em `main`.

### Task 4: Esqueleto do site + criptografia

Branch: `git checkout main && git checkout -b feat/web`

**Files:**
- Copiar do FoculessYT `web/` inteiro exceto `src/lib/download.ts`, `src/views/HomeView.vue`, `src/lib/api.spec.ts`, componentes `progress`/`select` não usados.
- Create: `web/src/router.ts`, `web/src/lib/crypto.ts`, `web/src/lib/crypto.spec.ts`, `web/src/lib/pad-name.ts` (+ `.spec.ts`, mesmas regras e casos da Task 2)
- Modify: `web/package.json` (+ `vue-router yjs y-protocols lib0 codemirror @codemirror/state @codemirror/view y-codemirror.next hash-wasm`), `web/src/main.ts` (usa router), `web/.env.example` (+ `VITE_WS_URL`), `web/src/env.d.ts`

**Interfaces:**
- Produces:
  - `deriveKeys(password: string, salt: Uint8Array): Promise<{ authKey: Uint8Array; encKey: CryptoKey }>`
  - `encrypt(key: CryptoKey, data: Uint8Array, padName: string): Promise<Uint8Array>`; `decrypt(key, data, padName): Promise<Uint8Array>` (lança em falha)
  - `randomSalt(): Uint8Array` (16 bytes); `toB64url(u8): string`; `fromB64url(s): Uint8Array`
  - Rotas: `/` → `HomeView`, `/:name(.*)+` → `PadView` (prop `name`)

- [ ] **Step 1: testes falhando** (`crypto.spec.ts`, Vitest; Argon2 de 64 MiB é lento — timeout 30 s): `decrypt(encrypt(x,'a'),'a')` = `x`; `decrypt(encrypt(x,'a'),'b')` rejeita; dois `encrypt` do mesmo `x` diferem (IV aleatório); `deriveKeys('s', salt)` duas vezes → mesma `authKey` com 32 bytes; salt diferente → `authKey` diferente; `fromB64url(toB64url(u8))` = `u8`.
- [ ] **Step 2:** `npm test` (em `web/`) → FAIL.
- [ ] **Step 3:** implementar com `argon2id` do `hash-wasm` (`outputType: 'binary'`) e `crypto.subtle.importKey('raw', …, 'AES-GCM', false, ['encrypt','decrypt'])`.
- [ ] **Step 4:** `npm test && npm run build` (em `web/`) → verde.
- [ ] **Step 5: Commit** `feat(web): Vue skeleton and end-to-end crypto`

### Task 5: Telas da nota

**Files:**
- Create: `web/src/lib/protocol.ts` (cópia da Task 3), `web/src/lib/pad-provider.ts` (+ `.spec.ts`), `web/src/components/PadEditor.vue`, `web/src/components/UnlockForm.vue`, `web/src/components/PasswordDialog.vue`, `web/src/components/ui/dialog/*` (via `npx shadcn-vue add dialog`), `web/src/views/HomeView.vue`, `web/src/views/PadView.vue`
- Modify: `web/src/lib/api.ts` (`getPad`, `unlock`, `setPassword`, `removePassword`, todos com `encodeURIComponent(name)`), `web/src/i18n/pt-BR.ts`, `web/src/i18n/en.ts`, `web/src/i18n/i18n.spec.ts`

**Interfaces:**
- Consumes: Task 3 protocol/close codes; Task 4 crypto e rotas.
- Produces: `new PadProvider({ url: string; name: string; doc: Y.Doc; token?: string; encKey?: CryptoKey })` com `onPresence(cb: (n: number) => void)`, `onStatus(cb: (s: 'connecting' | 'synced' | 'locked' | 'error') => void)`, `destroy()`. Aberta: y-protocols sync. Protegida: `doc.on('update')` (origem ≠ provider) → `encrypt` → `ENC_UPDATE`; `ENC_INIT`/`ENC_UPDATE` → `decrypt` → `Y.applyUpdate(doc, u, provider)`; `COMPACT_REQ(n)` → `ENC_SNAPSHOT(n, encrypt(Y.encodeStateAsUpdate(doc)))`. Close 4401/4409 → status `locked` (sem reconectar); outros closes → reconecta com backoff até 10 s.

- [ ] **Step 1: teste falhando** `pad-provider.spec.ts` com um WebSocket falso: em modo protegido, `ENC_INIT` com 2 updates cifrados → `doc.getText('content').toString()` igual ao original; close 4409 → `onStatus('locked')` e nenhuma nova conexão; edição local gera um `ENC_UPDATE` que **não contém o texto em claro** (procurar os bytes do texto no payload).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** `PadProvider`; `PadEditor.vue` = CodeMirror (`EditorView` + `yCollab(doc.getText('content'), null)`, sem gutters, `EditorView.lineWrapping`, tema pelos tokens de `style.css`).
- [ ] **Step 4:** `PadView.vue`: `getPad(name)`; protegida sem chaves → `UnlockForm` (senha → `deriveKeys(salt)` → `unlock`; 401 → toast "senha incorreta", 429 → toast "muitas tentativas"); depois cria `Y.Doc` + `PadProvider` + `PadEditor`. Cabeçalho: nome, status, `n` pessoas, cadeado → `PasswordDialog` (colocar: aviso "se esquecer a senha a nota é perdida para sempre" + confirmação de senha; trocar; remover), `LanguageToggle`, `ThemeToggle`, `GithubLink`. Ao receber `locked` depois de trocar a própria senha, reconecta com o token novo. `HomeView.vue`: campo de nome (normaliza com `normalizePadName`, erro inline se inválido) + botão abrir.
- [ ] **Step 5:** textos novos nos dois idiomas; `i18n.spec.ts` (já existente no FoculessYT) garante que as chaves de pt-BR e en batem.
- [ ] **Step 6:** `npm test && npm run build` → verde. Rodar API + site e conferir à mão em duas abas: digitação simultânea, colocar senha (a outra aba vai pra tela de senha), recarregar pede senha, senha errada mostra toast.
- [ ] **Step 7: Commit** `feat(web): pad editor with real-time sync and password lock`; perguntar antes de push/PR.

### Task 6: README

Branch: `docs/readme`

**Files:** Create `README.md`, `README.pt-BR.md` no formato do FoculessYT (logo, badges NestJS/Vue/TypeScript/Node/Yjs/Swagger, nota sobre E2E e "senha esquecida = nota perdida", funcionalidades, começando, tabela de variáveis da Global Constraints, tabela de scripts com `lint`/`format` de ESLint/Prettier, seção "Como a senha funciona" resumindo a seção E2E da spec).

- [ ] **Step 1:** escrever os dois READMEs; conferir que toda variável de `.env.example` e `web/.env.example` está na tabela.
- [ ] **Step 2: Commit** `docs: README in English and Portuguese`; perguntar antes de push/PR.
