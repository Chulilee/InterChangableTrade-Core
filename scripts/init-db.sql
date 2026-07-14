-- Local development database bootstrap.
-- docker-compose runs this automatically on first startup of the postgres
-- container. TypeORM handles schema creation (synchronize) in development, so
-- this only needs to guarantee the database exists.

SELECT 'CREATE DATABASE interchangabletrade'
WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'interchangabletrade'
)\gexec
