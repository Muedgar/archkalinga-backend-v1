#!/bin/sh
set -e

echo "▶ Running database migrations..."
node ./node_modules/.bin/typeorm -d ./dist/config/db/db.config.js migration:run

echo "▶ Starting ArchKalinga API..."
exec node dist/main
