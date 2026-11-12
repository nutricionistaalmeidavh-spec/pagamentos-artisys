FROM node:24-alpine
WORKDIR /app
COPY commerce/package.json ./package.json
COPY commerce/src ./src
COPY commerce/public ./public
COPY commerce/catalog.json ./catalog.json
ENV HOST=0.0.0.0
ENV PORT=8789
ENV LICENSE_DB_PATH=/data/commerce.sqlite
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8789
CMD ["node","src/server.mjs"]
