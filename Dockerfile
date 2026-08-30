FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev
COPY --chown=node:node platform ./platform
COPY --chown=node:node storage ./storage
COPY --chown=node:node world ./world
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
