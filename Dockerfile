FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=7860

# Hugging Face Spaces requirement: user with UID 1000 (built-in 'node' user)
USER node

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node --from=builder /app/dist ./dist

EXPOSE 7860

CMD ["node", "dist/index.js"]
