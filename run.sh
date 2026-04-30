#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo " =============================="
echo "  SEO Audit Tool"
echo " =============================="
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
    echo " Node.js not found. Please install it from https://nodejs.org"
    echo " Then run this script again."
    exit 1
fi

# Install dependencies on first run
if [ ! -d "node_modules" ]; then
    echo " First run — installing dependencies (~1 min)..."
    echo ""
    npm install --prefer-offline --no-audit --no-fund || { echo " npm install failed."; exit 1; }
    echo ""
fi

# Open browser after server starts
(sleep 4 && open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null) &

echo " Starting server at http://localhost:3000"
echo " Your browser will open automatically."
echo ""
echo " Press Ctrl+C to stop."
echo ""

npm run dev
