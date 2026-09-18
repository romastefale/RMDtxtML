# RMDtxtML

Editor Web + Telegram Mini App para Telegram Rich Messages.

## Runtime

- Node.js 22
- Rich HTML canônico
- SQLite para estado de backend
- Railway como runtime atual

## Persistência no Railway

O backend usa `RAILWAY_VOLUME_MOUNT_PATH` automaticamente quando um Railway Volume está anexado. Para produção, anexe um volume ao serviço e monte em `/data`.

Sem volume, o serviço continua funcional, mas transferências, rate limits e chaves de idempotência não sobrevivem a uma substituição do container. `GET /api/health` informa `storage.persistent`.

## Variáveis

Obrigatórias no ambiente atual:

- `BOT_TOKEN`
- `APP_URL`
- `ALLOWED_ORIGINS`
- `INIT_DATA_MAX_AGE`
- `SEND_SCOPE`
- `TRANSFER_TTL_SECONDS`

Controles operacionais:

- `TRANSFER_RATE_LIMIT` — criações de transferência por IP/minuto
- `CLAIM_RATE_LIMIT` — tentativas de claim por IP/minuto
- `SEND_RATE_LIMIT` — envios por usuário Telegram/minuto

## Segurança e entrega

O servidor valida `Telegram.WebApp.initData` antes de operações autenticadas. Transferências são tokens opacos, expiram e são consumidas atomicamente uma única vez.

Cada envio usa um `requestId`. Resultado confirmado é armazenado e reaproveitado em retries. Rejeições explícitas da Bot API liberam o identificador para nova tentativa. Falhas de transporte com resultado desconhecido ficam em estado `uncertain` e não são reenviadas automaticamente, evitando duplicação acidental.

## Gate

O build verifica sintaxe dos módulos Web/backend e executa `npm test` antes do deploy. O Railway usa `/api/health` como healthcheck.
