# Production container

The production Docker image runs the Node.js API as an unprivileged `app` user.
The writable `/app/uploads/disputes` and `/app/reports` directories belong to
that user. If mounting volumes at those paths, give the container's user write
access to the mounted directories.

The image has a built-in liveness probe: an HTTP request to
`http://127.0.0.1:${PORT:-3000}/api/health` every 30 seconds (substituting the
configured `PORT`), with a 30-second startup
grace period. This checks that the HTTP endpoint responds. The endpoint's JSON
body separately reports PostgreSQL and Redis status (`ok` or `degraded`); the
container probe does **not** treat a degraded dependency status as unhealthy.

When running the image outside Docker Compose, pass `--init` to `docker run`
to reap child processes. The checked-in Compose file uses `init: true`.
The `build-check.yml` GitHub Actions workflow builds the production image and
prints its size in the CI log for each pull request.
