#!/bin/bash

# Navigate to project directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "🍎 Starting Apple Music Offline Downloader..."
echo "🎵 Opening http://localhost:3300 in your browser..."

# Open browser after a brief delay
(sleep 1 && open "http://localhost:3300") &

# Start Express server
node src/server.js
