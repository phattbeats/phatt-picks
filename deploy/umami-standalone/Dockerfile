# Single-container Umami analytics (PHA-1277).
#
# Umami needs an external Postgres, which normally means a second container.
# Brandon asked for "all in the same docker container, standalone", so this image
# bundles a local Postgres INTO the official Umami image: one container, one data
# volume (Postgres lives in /var/lib/postgresql/data; Umami itself is stateless).
# Umami stays host-agnostic (events carry a website-id), so the same-origin /stats
# proxy and tracker in the app are unchanged.
FROM ghcr.io/umami-software/umami:postgresql-latest

USER root

# Pinned to v17 so the binaries match the /usr/libexec/postgresql17 PATH below.
# server (initdb/pg_ctl/postgres) + client (psql/createdb/createuser) + contrib
# (pgcrypto, required by Umami's 01_init migration) + su-exec (drop to postgres
# from the root entrypoint).
RUN apk add --no-cache postgresql17 postgresql17-client postgresql17-contrib su-exec

ENV PGDATA=/var/lib/postgresql/data \
    DATABASE_TYPE=postgresql \
    DATABASE_URL=postgresql://umami:umami@127.0.0.1:5432/umami \
    PATH="/usr/libexec/postgresql17:/usr/libexec/postgresql:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN mkdir -p "$PGDATA" /run/postgresql \
 && chown -R postgres:postgres /var/lib/postgresql /run/postgresql

COPY standalone-entrypoint.sh /usr/local/bin/standalone-entrypoint.sh
RUN chmod +x /usr/local/bin/standalone-entrypoint.sh

# Only the Postgres data dir is stateful — this is the one volume to persist.
VOLUME ["/var/lib/postgresql/data"]
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/standalone-entrypoint.sh"]
