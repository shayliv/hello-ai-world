FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node . .
RUN npm ci
RUN npm run build --if-present
RUN npm prune --omit=dev
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
