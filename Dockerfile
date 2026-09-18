FROM mcr.microsoft.com/playwright:v1.63.0-noble AS test
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY docs ./docs
COPY test ./test
COPY e2e ./e2e
COPY playwright.config.mjs ./
RUN node --check docs/platform.js \
 && node --check docs/editor.js \
 && node --check docs/document.js \
 && node --check docs/app.js \
 && node --check docs/transfer.js \
 && node --check src/store.mjs \
 && node --check src/server.mjs \
 && node --check src/telegram.mjs \
 && npm test \
 && touch /tmp/rmdtxtml-qa-passed

FROM node:22-alpine
WORKDIR /app
COPY --from=test /tmp/rmdtxtml-qa-passed /tmp/rmdtxtml-qa-passed
COPY package.json ./
COPY src ./src
COPY docs ./docs
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
