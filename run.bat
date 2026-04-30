@echo off
title SEO Audit Tool
cd /d "%~dp0"

echo.
echo  ==============================
echo   SEO Audit Tool
echo  ==============================
echo.

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  Node.js not found. Installing via winget...
    echo  ^(This only happens once^)
    echo.
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: Could not auto-install Node.js.
        echo  Please install it manually from https://nodejs.org then run this file again.
        echo.
        pause
        exit /b 1
    )
    :: Refresh PATH so node is available immediately
    for /f "tokens=*" %%i in ('where /r "%ProgramFiles%\nodejs" node.exe 2^>nul') do set "NODE_PATH=%%~dpi"
    set "PATH=%NODE_PATH%;%PATH%"
)

:: Install dependencies on first run (or if missing)
if not exist "node_modules" (
    echo  First run — installing dependencies...
    echo  ^(This takes ~1 minute and only happens once^)
    echo.
    call npm install --prefer-offline --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: npm install failed. Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
)

:: Open browser after 4 seconds (server needs a moment to start)
start "" cmd /c "timeout /t 4 >nul && start http://localhost:3000"

echo  Starting server at http://localhost:3000
echo  Your browser will open automatically.
echo.
echo  Press Ctrl+C to stop.
echo.

:: Start Next.js dev server
npm run dev
