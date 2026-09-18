# RMDtxtML

RMDtxtML 1.0.0 é um editor Web + Telegram Mini App para criar, visualizar, transferir e publicar Rich Messages da Telegram Bot API 10.3.

## Arquitetura

O documento canônico vive no frontend e passa por editor, sanitização, preview e persistência local. A transferência Web → Telegram usa token opaco de curta duração. Operações autenticadas validam `Telegram.WebApp.initData` no servidor. O cliente recebe somente `destinationId` e rótulo; o backend resolve o `chat_id` autorizado internamente antes de chamar `sendRichMessage`.

O runtime de produção usa Node.js 24.21, SQLite e Railway. O Docker mantém Chromium/Playwright apenas no estágio de QA; a imagem final é Node Alpine.

## Segurança

- backend de produção fixo no mesmo origin; não existe override via localStorage;
- validação HMAC e expiração de `initData` no servidor;
- destinos de publicação opacos e resolvidos server-side;
- CORS/origin checks, limites de corpo e rate limiting;
- tokens de transferência expiram e são consumidos atomicamente;
- cada envio usa `requestId`; sucesso é idempotente e falha de transporte indeterminada não é repetida cegamente;
- chamadas à Bot API têm timeout;
- Rich HTML é validado antes de transferência e publicação.

## Persistência

O backend usa automaticamente `RAILWAY_VOLUME_MOUNT_PATH` quando um Railway Volume está anexado. Em produção durável, monte um volume em `/data`.

Sem volume o serviço continua funcional, mas SQLite fica no filesystem efêmero do container; `GET /api/health` expõe `storage.persistent` para tornar isso observável.

## Configuração

Obrigatórias no ambiente atual:

- `BOT_TOKEN`
- `APP_URL`
- `ALLOWED_ORIGINS`
- `INIT_DATA_MAX_AGE`
- `SEND_SCOPE`
- `TRANSFER_TTL_SECONDS`

Operação:

- `TRANSFER_RATE_LIMIT`
- `CLAIM_RATE_LIMIT`
- `SEND_RATE_LIMIT`
- `APP_VERSION`

Destinos adicionais podem ser declarados por `AUTHORIZED_DESTINATIONS` como JSON de objetos `{"label":"...","chat_id":"..."}`; `ALLOWED_CHAT_IDS` permanece aceito para uma lista simples server-side.

## Gate de release

O estágio de QA executa `node --check`, todos os testes Node e Playwright/Chromium. A imagem de runtime só pode ser construída depois que esse estágio cria o marcador `/tmp/rmdtxtml-qa-passed`. Railway usa `/api/health` como healthcheck.
