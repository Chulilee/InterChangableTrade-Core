# scripts

Operational and development helper scripts.

- `init-db.sql` — ensures the PostgreSQL database exists on first container
  start. Wired into `docker-compose.yml` as a Postgres init script.
