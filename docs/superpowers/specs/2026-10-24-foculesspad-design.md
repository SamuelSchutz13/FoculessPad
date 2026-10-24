# FoculessPad: design

Data: 2026-10-24 · Autor: Samuel Schutz

## Intenção

Um bloco de notas na web no estilo do [dontpad](https://dontpad.com/). Você abre um endereço como
`/minhas-notas`, escreve, e o texto fica salvo naquele endereço. Não tem cadastro. Quem souber
o endereço lê e edita, e todo mundo que estiver na mesma nota vê as edições **em tempo real**.

O diferencial é que qualquer nota pode receber uma **senha**. Uma nota com senha tem
**criptografia de ponta a ponta**: quem não tem a senha não consegue abrir nem baixar o conteúdo
cifrado, e o servidor nunca vê o texto nem a senha. Se a senha for esquecida, a nota fica perdida
para sempre. Isso foi aceito.

O projeto segue o **mesmo método de desenvolvimento do
[FoculessYT](https://github.com/SamuelSchutz13/FoculessYT)**, **sem o Biome**.

## Objetivos

- Nota por endereço, criada no primeiro acesso, salva automaticamente.
- Edição simultânea em tempo real, sem perder texto quando duas pessoas digitam ao mesmo tempo.
- Senha opcional por nota, com E2E: o servidor guarda apenas dados cifrados e não tem como
  decifrá-los.
- Colocar, trocar e remover a senha de uma nota (trocar e remover exigem a senha atual).
- Proteção contra tentativas de senha em massa.
- Indicador de quantas pessoas estão na nota agora.

## Fora do escopo

Contas e login, texto rico/Markdown renderizado, anexos, histórico de versões, cursores das
outras pessoas, recuperação de senha, várias instâncias da API.

## Anti-objetivos (falha mesmo se "funcionar")

- O servidor ver, em qualquer momento, o texto ou a senha de uma nota protegida.
- Quem não tem a senha receber qualquer byte do conteúdo, mesmo cifrado.
- Perder texto em edições simultâneas ("o último que salva ganha").
- Usar o Biome.

## Restrições: método herdado do FoculessYT

**Repositório:** `https://github.com/SamuelSchutz13/FoculessPad.git`. API na raiz e site em
`web/`, como no FoculessYT.

**API** (raiz): NestJS 12, TypeScript strict, Node 22.13+.
- `src/main.ts`, e `src/app.setup.ts` compartilhado entre o `main` e os testes e2e: helmet, CORS
  (`CORS_ORIGINS`), prefixo `api`, versionamento por URI (`v1`), `ValidationPipe({ whitelist,
  transform })`, `AllExceptionsFilter` global, Swagger em `/docs`.
- `src/config/env.ts` lê o `.env` com `process.loadEnvFile()`, valida as variáveis e falha na
  inicialização se alguma for inválida. Toda variável tem padrão e é documentada em `.env.example`
  e no README.
- `src/modules/<feature>/` com controller, service, module, `dto/` e `*.spec.ts`. Inclui um módulo
  `health`.
- `@nestjs/throttler` global, com o mesmo comentário `shortcut:` sobre o armazenamento ficar em
  memória.
- **Banco:** TypeORM (`@nestjs/typeorm`) com SQLite, um arquivo só. Cada entidade fica no seu
  módulo. Escolha do usuário: TypeORM em vez de Prisma.
- **Testes:** Jest + ts-jest (`*.spec.ts` em `src/`) e e2e com supertest em `test/`, com os mesmos
  scripts do FoculessYT.
- **Lint e formatação, no lugar do Biome:** ESLint (flat config, `typescript-eslint`
  recomendado) + Prettier, com a mesma abrangência que o Biome tinha (só a API, sem `web/`). O
  Prettier replica o formatter antigo: 2 espaços, `printWidth` 100, aspas simples, vírgula final
  em tudo, ponto e vírgula. Scripts `lint`, `lint:fix` e `format`.

**Site** (`web/`): Vue 3 + Vite + TypeScript, Tailwind 4, shadcn-vue (reka-ui), `@lucide/vue`,
`vue-i18n` (pt-BR e en), tema claro/escuro (`lib/theme.ts`), `vue-sonner`, axios (`lib/api.ts`),
fonte Geist, componentes `GithubLink`, `LanguageToggle` e `ThemeToggle`, Vitest. Mesmo visual
pastel do FoculessYT.

**Git:** um commit inicial `chore:`, depois uma branch por parte (`feat/api`, `feat/web`,
`docs/readme`), cada uma entrando por PR em `main`. Conventional Commits. README em inglês
(`README.md`) e pt-BR (`README.pt-BR.md`), no mesmo formato do FoculessYT.

## Como funciona (decisões tomadas)

### Notas e nomes

- Nome da nota: `[a-z0-9_-]` em segmentos separados por `/` (ex.: `faculdade/calculo`),
  normalizado para minúsculas, até 200 caracteres. *(minha decisão)*
- A nota é criada no primeiro acesso. Uma nota aberta e vazia não precisa ser gravada no banco.
- Tamanho máximo por nota: `MAX_PAD_SIZE_KB` (padrão 512). Atualizações ou snapshots acima do
  limite são recusados. *(minha decisão)*

### Tempo real: Yjs

- O documento é um `Y.Text`. O site usa **CodeMirror 6** + `y-codemirror.next`, configurado como
  texto puro (sem números de linha nem destaque de sintaxe), parecido com o dontpad.
  *(minha decisão: um textarea com Yjs feito à mão quebra o cursor e a seleção)*
- WebSocket com `@nestjs/websockets` + `@nestjs/platform-ws`, conectando em `/ws`.
- **Nota aberta:** o servidor mantém um `Y.Doc` por nota em memória enquanto alguém está
  conectado, usa o protocolo de sync do `y-protocols`, e grava o estado no SQLite com debounce
  (ex.: 2 s) e quando a última conexão sai.
- **Presença:** o servidor envia a contagem de conexões da nota sempre que ela muda.

### Senha e E2E

Tudo de criptografia roda no navegador. Senha e chave de criptografia nunca saem dele.

1. **Derivação** (navegador): Argon2id (`hash-wasm`), com m = 64 MiB, t = 3, p = 1, e um salt
   aleatório de 16 bytes por nota, gerando 64 bytes. Os primeiros 32 bytes são a `authKey` e os
   últimos 32 são a `encKey` (AES-256-GCM, importada como chave não extraível da WebCrypto).
2. **Servidor guarda:** `salt`, `SHA-256(authKey)` (a `authKey` já tem alta entropia, e o custo
   de adivinhar a senha está no Argon2 do cliente), uma `keyVersion`, o snapshot cifrado e as
   atualizações cifradas pendentes. Nunca guarda texto legível de uma nota protegida.
3. **Desbloquear:** `GET /pads/:name` responde `{ protected, salt }` e nunca devolve conteúdo de
   uma nota protegida. O cliente deriva as chaves e faz `POST /pads/:name/unlock { authKey }`. O
   servidor compara com `timingSafeEqual` e responde com um **token de sessão**: um HMAC-SHA256
   de `(nome, keyVersion, expiração)` com `APP_SECRET`, válido por `SESSION_TTL_MINUTES`
   (padrão 60).
4. **WebSocket de nota protegida** exige um token válido para aquela nota e aquela `keyVersion`.
   Sem token, a conexão é recusada antes de qualquer dado ser enviado. Os tokens também são
   checados no meio da sessão: se a `keyVersion` mudar, o servidor derruba as conexões.
5. **Formato cifrado:** cada atualização do Yjs vira `iv(12 bytes) || AES-GCM(update)`, com AAD =
   nome da nota (impede copiar o conteúdo cifrado de uma nota para outra). O servidor guarda e
   repassa, sem fazer merge. Ao entrar, o cliente recebe o snapshot mais as atualizações
   pendentes, decifra e aplica.
6. **Compactação:** quando passarem de N atualizações pendentes (ex.: 200), o servidor pede a um
   cliente conectado um snapshot cifrado do estado completo, informando até qual atualização ele
   cobre. Quando o snapshot chega, o servidor troca as atualizações cobertas por ele.
7. **Colocar senha** numa nota aberta: o cliente gera salt e chaves, cifra o estado atual e envia
   `{ salt, authKey, snapshot }`. Numa única transação, o servidor salva tudo isso, apaga o estado
   legível e derruba as conexões abertas, que precisam desbloquear para voltar.
8. **Trocar senha:** exige token válido. O cliente re-cifra o estado com as novas chaves e envia
   tudo. O servidor incrementa a `keyVersion` (o que invalida os tokens antigos), substitui o
   conteúdo e derruba as conexões.
9. **Remover senha:** exige token válido. O cliente envia o estado em texto puro (`Y.encodeStateAsUpdate`),
   e o servidor volta a nota para o modo aberto.
10. **Contra força bruta:** `unlock` com limite por IP (Throttler, `UNLOCK_RATE_LIMIT_PER_MINUTE`,
    padrão 5) e por nota (contador em memória, bloqueio de 15 min após 10 falhas). Os dois levam
    um comentário `shortcut:` dizendo que ficam em memória.
11. As chaves e o token ficam só na memória da aba. Recarregar a página pede a senha de novo.
    *(minha decisão: nada sensível em localStorage)*
12. O tamanho da nota cifrada não é escondido (vazamento aceito).

### Variáveis novas

`PORT`, `CORS_ORIGINS`, `DATABASE_PATH` (padrão `data/foculesspad.sqlite`), `APP_SECRET`
(obrigatória em produção; em dev, se ausente, gera uma aleatória com aviso no log),
`SESSION_TTL_MINUTES`, `MAX_PAD_SIZE_KB`, `RATE_LIMIT_PER_MINUTE`,
`UNLOCK_RATE_LIMIT_PER_MINUTE`. No site: `VITE_API_URL` e `VITE_WS_URL`.

### Telas

- **Home:** campo "nome da nota" + botão abrir, e uma explicação curta.
- **Nota (`/:name+`):** editor ocupando a tela, cabeçalho com nome, status (salvo / conectando),
  contagem de pessoas, botão de cadeado (colocar, trocar ou remover senha) e os toggles de
  idioma, tema e GitHub. Nota protegida sem token mostra só a tela de senha.
- Rotas com `vue-router` (o FoculessYT não precisava dele).

## Testes mínimos exigidos

- API, unit: validação de nome, verificação do token (expirado, `keyVersion` errada, nota errada),
  `timingSafeEqual`, contador de bloqueio.
- API, e2e: nota protegida nunca devolve conteúdo sem token; `unlock` errado devolve 401;
  WebSocket sem token é recusado; colocar senha apaga o estado legível do banco.
- Site: ida e volta de cifrar e decifrar (`encrypt` → `decrypt` = original); AAD de outra nota
  falha; derivação determinística com o mesmo salt.

## Deixado para quem for construir

Layout exato das tabelas do TypeORM, formato binário das mensagens no WebSocket, limiar de
compactação, textos de i18n, detalhes visuais, e como enviar nomes com `/` nas rotas REST
(wildcard ou `encodeURIComponent`).
