FROM mcr.microsoft.com/playwright:v1.63.0-noble AS test
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY docs ./docs
COPY test ./test
COPY e2e ./e2e
COPY playwright.config.mjs ./
COPY Dockerfile ./Dockerfile
RUN node --check docs/platform.js
RUN node --check docs/editor.js
RUN node --check docs/document.js
RUN node --check docs/app.js
RUN node --check docs/transfer.js
RUN node --check src/store.mjs
RUN node --check src/server.mjs
RUN node --check src/telegram.mjs
RUN npm test && touch /tmp/rmdtxtml-qa-passed

FROM node:24.21.0-alpine
WORKDIR /app
COPY --from=test /tmp/rmdtxtml-qa-passed /tmp/rmdtxtml-qa-passed
COPY package.json ./
COPY src ./src
COPY docs ./docs
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
