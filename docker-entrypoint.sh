#!/bin/sh
set -e

# Run pending migrations before starting the server. The migration runner
# (scripts/migrate.ts) tracks applied migrations in a schema_migrations
# table and is idempotent — safe to run on every container start,
# including across restarts and (with the caveat noted in the README's
# deployment section) concurrent replicas racing on first boot.
#
# This is what lets a one-click deploy (Render, Railway, Fly, etc.) come
# up fully migrated with zero manual `npm run migrate` step required.
echo "Running database migrations..."
node --import tsx scripts/migrate.ts up

echo "Starting application..."
exec "$@"
