#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting QuickTrigger preparation..."

# Run database migration/push
echo "📦 Syncing database schema..."
npx prisma db push --accept-data-loss

# Start the application
echo "🏃 Starting application..."
exec npm start
