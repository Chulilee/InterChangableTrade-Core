# Contributing to InterChangableTrade-Core

Thanks for your interest in contributing! InterChangableTrade-Core is the
backend that connects the InterChangableTrade ecosystem to the Stellar network
and Soroban smart contracts. Contributions of all kinds — code, tests,
documentation, and issue reports — are welcome.

## Code of Conduct

This project and everyone participating in it is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to
uphold it. Please report unacceptable behaviour as described there.

## Getting Started

1. **Fork and clone** the repository.
2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure your environment:**

   ```bash
   cp .env.example .env
   ```

   The defaults target the Stellar **testnet** (Horizon + Soroban RPC). You do
   not need a funded account for read-only work; write invocations and
   deployments require `SOROBAN_SOURCE_SECRET` to be set.

4. **Start the datastores** (PostgreSQL + Redis):

   ```bash
   docker compose up -d postgres redis
   ```

5. **Run the app in watch mode:**

   ```bash
   npm run start:dev
   ```

   Interactive OpenAPI docs are served at `http://localhost:3000/api/docs`.

## Development Workflow

We use a standard fork-and-pull-request workflow against the `main` branch.

1. Create a topic branch: `git checkout -b feat/short-description` (or
   `fix/…`, `docs/…`, `chore/…`).
2. Make your change, keeping it focused. One logical change per pull request.
3. Ensure the project builds, lints, and tests pass locally (see below).
4. Open a pull request against `main` and fill in the template.

### Before you push — the checklist CI enforces

```bash
npm run lint          # ESLint + Prettier, auto-fixes where it can
npx tsc --noEmit      # TypeScript type-check
npm run build         # Compile to dist/
npm test              # Unit tests (Jest)
```

All four must pass. The CI pipeline (`.github/workflows/build-check.yml`) runs
the same steps on every push and pull request to `main`.

## Coding Standards

- **Language:** TypeScript, targeting the NestJS conventions already used in
  `src/modules/*`.
- **Formatting:** Prettier (`.prettierrc`) — run `npm run format` or let
  `npm run lint` fix it.
- **Structure:** Each feature lives in its own module under `src/modules/`,
  with `dto/`, `entities/`, and `services/` subfolders as needed. Shared code
  goes in `libs/common` (import via the `@app/common` alias).
- **Stellar/Soroban:** All chain access flows through the services in
  `src/modules/stellar`. Do not talk to Horizon or the Soroban RPC directly
  from feature modules — use the gateway and Soroban client services so that
  rate limiting, connection pooling, and typed error classification stay
  centralized.
- **Tests:** New services and business logic should ship with `*.spec.ts`
  unit tests. Mock the network boundary (see
  `src/modules/stellar/soroban/contract-state.service.spec.ts` for the
  pattern) so tests run without a live network.

## Commit Messages

Write clear, human-readable commit messages in the imperative mood:

```
feat(marketplace): add partial-fill support to trade listings

Explain what changed and why, not how. Reference issues with "Closes #NN"
when a commit resolves one.
```

Prefixes we use: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

## Reporting Bugs & Requesting Features

Please use the issue templates:

- **Bug report** — for something that is broken.
- **Feature request** — for a new capability or improvement.

For anything security-related, **do not open a public issue** — follow the
process in [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), the same license that covers this project.
