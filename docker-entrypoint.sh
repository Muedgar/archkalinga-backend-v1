#!/bin/sh
set -e

echo "▶ Running database migrations..."
npm run migration:run

echo "▶ Starting ArchKalinga API..."
exec npm run start:prod
