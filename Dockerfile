FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY docs ./docs
COPY test ./test
RUN node --check docs/platform.js \
 && node --check docs/editor.js \
 && node --check docs/document.js \
 && node --check docs/app.js \
 && node --check docs/transfer.js \
 && node --check src/server.mjs \
 && node --check src/telegram.mjs \
 && npm test
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
