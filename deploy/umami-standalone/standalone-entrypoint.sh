#!/bin/sh
# Boot a local Postgres, then hand off to Umami's own migrate+serve entrypoint.
# Everything runs inside one container (PHA-1277). Postgres listens on 127.0.0.1
# only — it is never exposed outside the container.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

# Alpine keeps the PG server binaries under /usr/libexec/postgresqlNN — make sure
# initdb/pg_ctl/postgres are reachable even if the version dir name changes.
for d in /usr/libexec/postgresql*; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
export PATH

mkdir -p "$PGDATA" /run/postgresql
chown -R postgres:postgres "$PGDATA" /run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[standalone] first run — initializing Postgres data dir"
  # trust auth on localhost only; PG is not network-exposed, so this is safe and
  # avoids a password bootstrap dance. The password in DATABASE_URL is ignored.
  su-exec postgres initdb -D "$PGDATA" -E UTF8 --locale=C \
    --auth-local=trust --auth-host=trust >/dev/null
  su-exec postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=''" -w start
  su-exec postgres createuser -s umami
  su-exec postgres createdb -O umami umami
  su-exec postgres pg_ctl -D "$PGDATA" -m fast -w stop
  echo "[standalone] Postgres initialized (db=umami user=umami)"
fi

echo "[standalone] starting Postgres on 127.0.0.1:5432"
su-exec postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1" -w start

# Forward SIGTERM/SIGINT to a clean Postgres shutdown so the container stops fast.
shutdown() {
  echo "[standalone] shutting down"
  [ -n "${UMAMI_PID:-}" ] && kill "$UMAMI_PID" 2>/dev/null || true
  su-exec postgres pg_ctl -D "$PGDATA" -m fast stop 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

echo "[standalone] launching Umami (runs prisma migrate deploy, then serves :3000)"
# The base image's docker-entrypoint.sh runs migrations against DATABASE_URL
# (our local PG) and then starts the Next.js standalone server.
docker-entrypoint.sh pnpm start-docker &
UMAMI_PID=$!
wait "$UMAMI_PID"
