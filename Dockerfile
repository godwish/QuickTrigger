# Build Stage
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies for building
RUN apt-get update && apt-get install -y openssl python3 build-essential && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

# Generate Prisma client
RUN npx prisma generate

COPY . .

# Build both server and web
RUN npm run build

# Runtime Stage
FROM node:22-slim

WORKDIR /app

# Install runtime dependencies (OpenSSL is needed for Prisma)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Create .runtime directory and set ownership BEFORE copying files
RUN mkdir -p /app/.runtime && chown -R node:node /app

# Copy built files
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/docker-entrypoint.sh ./

# Set environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000

# Ensure entrypoint is executable
RUN chmod +x docker-entrypoint.sh

# Switch to non-root user
USER node

EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
