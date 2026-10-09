FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3080 DB_PATH=/app/data/payments.sqlite RELEASES_DIR=/app/data/releases
WORKDIR /app
COPY package.json schema.sql ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data/releases && chown -R node:node /app/data
USER node
EXPOSE 3080
CMD ["node","src/main.mjs"]
