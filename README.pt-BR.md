<p align="center">
  <img src="web/public/favicon.svg" alt="" width="72" />
</p>

<h1 align="center">FoculessPad</h1>

<p align="center">
  <a href="README.md">English</a> · <b>Português (Brasil)</b>
</p>

<p align="center">
  Um bloco de notas em tempo real no estilo do dontpad: abra um endereço, escreva, compartilhe. Sem cadastro, e qualquer nota pode ter uma senha com criptografia de ponta a ponta.
</p>

<p align="center">
  <img alt="NestJS 12" src="https://img.shields.io/badge/NestJS-12-e0234e?logo=nestjs&logoColor=white" />
  <img alt="Vue 3" src="https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Node.js 22.13+" src="https://img.shields.io/badge/Node.js-22.13%2B-5fa04e?logo=nodedotjs&logoColor=white" />
  <img alt="Yjs" src="https://img.shields.io/badge/tempo%20real-Yjs-ffb000" />
  <img alt="Swagger" src="https://img.shields.io/badge/docs-Swagger-85ea2d?logo=swagger&logoColor=black" />
</p>

> [!NOTE]
> **Notas protegidas têm criptografia de ponta a ponta.** A criptografia roda no seu navegador. O servidor nunca vê o texto nem a senha de uma nota protegida, só bytes cifrados (e o tamanho deles). Notas sem senha ficam salvas em texto puro, então quem souber o endereço pode ler e editar.

> [!WARNING]
> **Esqueceu a senha, perdeu a nota.** Não existe recuperação: o servidor não consegue decifrar nada. Guarde a senha em um lugar seguro.

## Funcionalidades

- **Uma nota por endereço**: abra `/minhas-notas` (ou `/faculdade/calculo`) e ela é criada no primeiro acesso e salva automaticamente.
- **Edição em tempo real** com [Yjs](https://yjs.dev): todo mundo na mesma nota vê as edições na hora, e digitar ao mesmo tempo nunca apaga o texto de ninguém.
- **Presença**: mostra quantas pessoas estão na nota agora.
- **Senha opcional por nota**, com criptografia de ponta a ponta. Dá para colocar, trocar e remover (trocar e remover pedem a senha atual).
- **Proteção contra força bruta**: limite de tentativas por IP e bloqueio temporário da nota.
- **Site** em português e inglês, com **modos claro e escuro** em tons pastel.
- **API documentada** com Swagger em `/docs`.

## Começando

Você só precisa do [Node.js](https://nodejs.org) **22.13 ou mais novo**.

```sh
git clone https://github.com/SamuelSchutz13/FoculessPad.git
cd FoculessPad

# terminal 1: API (http://localhost:3000, docs em /docs)
npm install
npm run start:dev

# terminal 2: site (http://localhost:5173)
cd web
npm install
npm run dev
```

Abra **http://localhost:5173**.

### Configuração

Toda variável tem um padrão, exceto `APP_SECRET` em produção. Para mudar alguma, copie `.env.example` para `.env`, na raiz para a API ou em `web/` para o site.

| Onde | Variável                       | Padrão                         | Descrição                                                                                            |
| ---- | ------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| API  | `PORT`                         | `3000`                         | Porta da API                                                                                         |
| API  | `CORS_ORIGINS`                 | `http://localhost:5173`        | Origens do site permitidas, separadas por vírgula                                                    |
| API  | `DATABASE_PATH`                | `data/foculesspad.sqlite`      | Arquivo SQLite                                                                                       |
| API  | `APP_SECRET`                   | aleatória em dev               | Assina os tokens de desbloqueio. Obrigatória com `NODE_ENV=production` (32+ caracteres recomendados) |
| API  | `SESSION_TTL_MINUTES`          | `60`                           | Quanto tempo dura uma sessão desbloqueada                                                            |
| API  | `MAX_PAD_SIZE_KB`              | `512`                          | Maior conteúdo por nota (veja abaixo)                                                                |
| API  | `RATE_LIMIT_PER_MINUTE`        | `60`                           | Requisições por minuto, por IP                                                                       |
| API  | `UNLOCK_RATE_LIMIT_PER_MINUTE` | `5`                            | Tentativas de desbloqueio por minuto, por IP                                                         |
| Site | `VITE_API_URL`                 | `http://localhost:3000/api/v1` | Endereço da API                                                                                      |
| Site | `VITE_WS_URL`                  | `ws://localhost:3000/ws`       | Endereço do WebSocket                                                                                |

Um valor inválido (ex.: `PORT=abc`) impede a API de iniciar, com uma mensagem dizendo qual variável. Sem `APP_SECRET` em desenvolvimento, a API gera uma aleatória e avisa no log; as sessões desbloqueadas zeram a cada reinício.

**Limites.** O conteúdo de cada nota é limitado a `MAX_PAD_SIZE_KB`. Em notas protegidas o servidor pode guardar até o dobro (o snapshot cifrado mais as edições cifradas esperando compactação). Uma conexão a uma nota aberta (sem senha) que manda mais de 60 mensagens de sincronização por segundo é fechada; o site agrupa a digitação a cada ~50 ms, então o uso normal fica bem abaixo disso.

### Scripts

| Pasta | Comando              | O que faz                                           |
| ----- | -------------------- | --------------------------------------------------- |
| raiz  | `npm run start:dev`  | API com hot reload                                  |
| raiz  | `npm run build`      | Compila a API em `dist/`                            |
| raiz  | `npm run start:prod` | Roda a build da API                                 |
| raiz  | `npm test`           | Testes unitários da API                             |
| raiz  | `npm run test:e2e`   | Testes end-to-end da API (HTTP e WebSocket)         |
| raiz  | `npm run lint`       | ESLint (`lint:fix` também corrige o que der)        |
| raiz  | `npm run format`     | Prettier, gravando as mudanças                      |
| `web` | `npm run dev`        | Site em modo de desenvolvimento                     |
| `web` | `npm test`           | Testes do site (criptografia, nomes, sincronização) |
| `web` | `npm run type-check` | Checagem de tipos                                   |
| `web` | `npm run build`      | Checagem de tipos e build de produção em `web/dist` |

## Como a senha funciona

Tudo abaixo roda no navegador; a senha e a chave de criptografia nunca saem dele.

1. **Chaves.** A senha passa pelo Argon2id (64 MiB, 3 passadas, 1 lane) com um salt aleatório de 16 bytes por nota, gerando 64 bytes. Os primeiros 32 são a `authKey` (prova que você sabe a senha) e os últimos 32 são a `encKey` (AES-256-GCM, importada como chave não extraível).
2. **O que o servidor guarda.** O salt, `SHA-256(authKey)`, um snapshot cifrado e as edições cifradas ainda não compactadas. Nunca texto legível.
3. **Desbloquear.** O site pede a nota e recebe só `{ protected, salt }`, sem conteúdo. Ele deriva as chaves e envia a `authKey`; o servidor compara o hash em tempo constante e responde com um token de sessão (HMAC de nota, versão da chave e expiração, válido por `SESSION_TTL_MINUTES`). Sem token o servidor não envia conteúdo nenhum, nem cifrado, por REST ou WebSocket.
4. **Edição.** Cada atualização do Yjs vira `iv (12 bytes) || AES-GCM(atualização)`, com o nome da nota como dado autenticado adicional, então o conteúdo cifrado não pode ser copiado para outra nota. O servidor só guarda e repassa.
5. **Compactação.** Depois de 200 edições pendentes o servidor pede a um navegador conectado um snapshot cifrado da nota inteira e troca as edições cobertas por ele.
6. **Colocar, trocar, remover.** Colocar senha cifra o estado atual no navegador; o servidor grava tudo numa única transação, apaga o estado legível e derruba todo mundo, que precisa desbloquear para voltar. Trocar re-cifra com chaves novas e invalida os tokens antigos. Remover devolve o estado em texto puro e a nota volta a ser aberta.
7. **Força bruta.** 5 tentativas de desbloqueio por minuto por IP (`UNLOCK_RATE_LIMIT_PER_MINUTE`), e a nota fica bloqueada por 15 minutos depois de 10 senhas erradas.
8. **Só na aba.** As chaves e o token ficam na memória da aba: recarregar a página pede a senha de novo. Nada sensível vai para o `localStorage`.

> [!IMPORTANT]
> O servidor vê o **tamanho** de uma nota protegida, porque os bytes cifrados têm o tamanho do texto. Esse vazamento é aceito.

## Como funciona

```
web/   Vue 3 + Vite + CodeMirror 6 + Yjs  →  REST (/api/v1) + WebSocket (/ws)  →  API NestJS  →  SQLite (TypeORM)
```

- **Notas abertas**: o servidor mantém um documento Yjs por nota na memória enquanto alguém está conectado, e grava no SQLite depois de 2 s sem edições e quando a última pessoa sai.
- **Nomes de nota**: minúsculos, segmentos de `a-z 0-9 _ -` separados por `/`, até 200 caracteres. `Faculdade/Calculo` e `faculdade/calculo` são a mesma nota.
- **Erros**: toda resposta de erro tem o mesmo formato, com `message` sempre uma lista.

  ```json
  { "statusCode": 401, "error": "Unauthorized", "message": ["Wrong password"] }
  ```

- **Proteção da API**: limite de requisições por IP (`429`), cabeçalhos de segurança com helmet e CORS restrito às origens configuradas.

### Endpoints (`/api/v1`)

| Método | Rota                   | Para quê                                      |
| ------ | ---------------------- | --------------------------------------------- |
| GET    | `/health`              | Verificação de saúde                          |
| GET    | `/pads/:name`          | `{ protected, salt }`, nunca o conteúdo       |
| POST   | `/pads/:name/unlock`   | Envia a `authKey`, devolve um token de sessão |
| PUT    | `/pads/:name/password` | Coloca ou troca a senha                       |
| DELETE | `/pads/:name/password` | Remove a senha                                |

Valores binários vão em base64url. Nomes com `/` passam por `encodeURIComponent`. O conteúdo em si trafega pelo WebSocket em `/ws`. Detalhes completos em `/docs`.

### Estrutura do projeto

```
src/                          API (NestJS)
  main.ts, app.module.ts      inicialização e registro dos módulos
  app.setup.ts                prefixo, versionamento, validação, CORS, helmet, Swagger (usado também no e2e)
  config/env.ts               leitura e validação do .env
  common/filters/             formato único de erro (+ testes)
  modules/health/             verificação de saúde
  modules/pads/               notas: REST, gateway WebSocket, salas, tokens, bloqueio (+ testes)
test/                         testes end-to-end
web/                          site (Vue): telas, componentes, lib/crypto.ts, lib/pad-provider.ts
```

## Limitações conhecidas

- **Uma única instância da API.** Limites de requisição, bloqueio por senha errada e salas ao vivo ficam na memória. Com mais de uma instância eles não seriam compartilhados; mova para o Redis antes.
- Atrás de um proxy é preciso ativar `trust proxy`, senão todos os visitantes dividem um IP nos limites.
- Notas sem senha ficam abertas para quem adivinhar o endereço; escolha um nome difícil de adivinhar ou coloque uma senha.
- Sem contas, histórico, anexos, texto rico, cursores das outras pessoas nem recuperação de senha.
- No Windows, filtros de rede como o AdGuard interceptam o `localhost` e podem fazer os testes e2e falharem de vez em quando com `ECONNRESET`. Adicione o `node.exe` às exceções dele.

## Créditos

- Tempo real: [Yjs](https://yjs.dev) e [CodeMirror](https://codemirror.net). Criptografia: WebCrypto e [hash-wasm](https://github.com/Daninet/hash-wasm) (Argon2id).
- API: [NestJS](https://nestjs.com). Site: [Vue](https://vuejs.org), [Vite](https://vite.dev) e [Tailwind CSS](https://tailwindcss.com).
- Componentes de UI: [shadcn-vue](https://www.shadcn-vue.com) e [Reka UI](https://reka-ui.com). Ícones: [Lucide](https://lucide.dev).
- Fonte: [Geist](https://vercel.com/font) da Vercel (SIL Open Font License), servida pelo próprio site.
- Inspirado no [dontpad](https://dontpad.com). Mesma estrutura do [FoculessYT](https://github.com/SamuelSchutz13/FoculessYT).
