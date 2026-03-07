FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

EXPOSE 4000

# tsx handles ESM/Bundler moduleResolution without needing tsc compilation
CMD ["sh", "-c", "npm run migrate:up && npx tsx src/index.ts"]
