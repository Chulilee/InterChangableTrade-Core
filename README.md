# InterChangableTrade-Core

> Backend services powering the InterChangableTrade ecosystem.

## Overview

InterChangableTrade-Core provides the application services that connect the frontend with the Stellar blockchain. It exposes APIs, manages business logic, indexes blockchain events, and integrates with Soroban smart contracts.

## Features (MVP)

- REST API
- Authentication
- User management
- Marketplace service
- Asset indexing
- Transaction history
- Stellar integration
- Soroban contract interaction

## Technology Stack

- NestJS
- TypeScript
- PostgreSQL
- Redis
- Stellar SDK

## Project Structure

```
src/
  config/                 Typed configuration, env validation, DB config
  redis/                  Global Redis (ioredis) provider
  modules/
    auth/                 JWT auth, guards, register/login
    users/                User management
    marketplace/          Asset trade listings
    assets/               Stellar asset indexing
    transactions/         Transaction history
    stellar/              Stellar (Horizon) + Soroban integration
  main.ts                 Bootstrap, Swagger, global pipes/filters
libs/
  common/                 Shared entities, DTOs, interceptors, filters (@app/common)
scripts/                  Database init and helper scripts
```

## Getting Started

```bash
git clone https://github.com/InterChangableTrade/InterChangableTrade-Core.git

cd InterChangableTrade-Core

npm install

# Configure environment (copy and edit)
cp .env.example .env

# Start Postgres + Redis (and optionally the app) via Docker
docker compose up -d postgres redis

npm run start:dev
```

The API is served under the `/api` prefix, with interactive OpenAPI docs at
`http://localhost:3000/api/docs`.

## Scripts

```bash
npm run start:dev     # Watch-mode development server
npm run build         # Compile to dist/
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests
npm run lint          # Lint and auto-fix
```

## Docker

```bash
docker compose up --build    # Build and run app + Postgres + Redis
```

## Related Repositories

- InterChangableTrade-Fricks
- InterChangableTrade-Protocol

## Contributing

Community contributions are always welcome.

## License

Apache-2.0
