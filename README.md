# RMDtxtML

RMDtxtML é um editor Web + Telegram Mini App para criar, visualizar, transferir e publicar Rich Messages da Telegram Bot API 10.3.

## Estado

A linha atual é **1.1.0-rc.1**. O núcleo documental foi migrado para um modelo semântico ProseMirror; Rich HTML deixou de ser a fonte de verdade do documento e passou a ser uma representação de importação/publicação.

## Arquitetura do documento

```text
EditorView / transações
        ↓
Documento semântico schema 2
        ├─ persistência/revisões
        ├─ transferência Web ↔ Telegram
        └─ renderer Rich Message
              ├─ Rich HTML (conteúdo simples)
              └─ Blocks (estrutura avançada)
                    ↓
             Telegram Bot API
```

O schema representa parágrafos, H1–H6, rodapé, citações, listas/tarefas, código, fórmulas, tabelas, imagem, vídeo, áudio, voice note, documento, collage/slideshow, detalhes, mapas, referências, âncoras, custom emoji e botões. Undo/redo e seleção pertencem ao `EditorState` do ProseMirror, não a snapshots de DOM.

Documentos antigos `schema: 1 / format: rich_html` são migrados para `schema: 2 / format: semantic` ao carregar. Revisões antigas também são convertidas. O formato `.rmdtxtml` schema 2 armazena `content.model`, não HTML.

## Build

`docs/editor.js` é um artefato gerado e não é versionado. A fonte do editor está em `client/editor.mjs`.

```bash
npm install
npm run build
npm test
```

O build usa esbuild e versões fixadas dos módulos ProseMirror. O Docker compila o editor antes de executar os gates Node e Playwright; a imagem final recebe apenas o bundle produzido pelo estágio de QA.

## Fronteiras de produção

O cliente não escolhe `chat_id`. Após validar `Telegram.WebApp.initData`, o servidor entrega `destinationId` autorizado e resolve internamente o destino antes de `sendRichMessage`.

`SEND_SCOPE` aceita `none`, `self`, `configured` ou `all`. Destinos configurados podem declarar `user_ids`/`users` por usuário; destinos globais exigem opt-in explícito (`public: true`, `users: "*"` ou `ALLOW_GLOBAL_DESTINATIONS=true`).

Web → Telegram transfere duas representações com responsabilidades diferentes:

- `semantic`: continuidade exata do documento editável;
- `html`: representação Rich HTML validada para publicação/compatibilidade.

Transferências antigas sem modelo semântico continuam importáveis por migração HTML.

## Persistência

O frontend usa IndexedDB com fallback local. O backend usa SQLite e detecta automaticamente `RAILWAY_VOLUME_MOUNT_PATH`.

Para persistência durável no Railway, um Volume deve ser montado em `/data`. Sem volume, o SQLite continua funcional, mas seu estado não sobrevive à substituição do container. `GET /api/health` expõe `storage.persistent`.

## Segurança

- validação HMAC e expiração de `initData` no servidor;
- backend same-origin, sem override via localStorage;
- destinos opacos resolvidos server-side;
- CORS/origin checks, limites de corpo e rate limiting;
- tokens de transferência expiram e têm claim atômico;
- envio idempotente por `requestId` + fingerprint do payload, com conflito explícito quando o mesmo ID é reutilizado para outro conteúdo e estado `uncertain` para falha de transporte;
- timeout nas chamadas à Bot API;
- modelo semântico valida estrutura e atributos antes de renderizar;
- Rich HTML é validado novamente no backend antes de publicação.

## Gate

O gate obrigatório executa:

1. build do bundle semântico;
2. `node --check`;
3. testes Node;
4. Playwright/Chromium;
5. somente então cria o marcador exigido pela imagem final.

Produção expõe `/api/health` para liveness e `/api/ready` para readiness. Com `REQUIRE_PERSISTENT_STORAGE=true`, readiness exige Volume montado; com `REQUIRE_BOT_READY=true`, o processo somente inicia após validar o bot e configurar o menu da Mini App.
