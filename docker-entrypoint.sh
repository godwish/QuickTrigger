#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting QuickTrigger..."

# Start the application
# Note: The application automatically handles database initialization
# and schema syncing during the bootstrap phase.
echo "🏃 Running entrypoint script as $(whoami)"
exec npm start
