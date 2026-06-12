#!/bin/sh
set -e

# /data is a bind mount on Unraid (and most prod hosts), so its on-disk owner
# is whoever made the host directory (often nobody:users / 99:100), not the
# in-image nextjs user. Take ownership at boot so SQLite can open the DB,
# then drop privileges before running the app.
if [ -d /data ]; then
  chown -R nextjs:nodejs /data 2>/dev/null || true
fi

exec su-exec nextjs:nodejs "$@"
