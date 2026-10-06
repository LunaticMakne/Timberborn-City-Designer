@echo off
setlocal
cd /d "%~dp0"
title Timberborn City Designer

rem Reuse only a server serving this app; never silently switch ports.
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173' -TimeoutSec 5; if ($r.Content -match '<title>Timberborn[^<]*City Designer</title>') { exit 0 }; exit 2 } catch { exit 1 }"
if errorlevel 2 goto port_busy
if not errorlevel 1 (
  start "" "http://localhost:5173"
  exit /b 0
)

where node.exe >nul 2>nul
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node
if not exist "node_modules\vite\bin\vite.js" goto missing_packages

echo Starting http://localhost:5173
echo Keep this window open while using the designer.
echo To stop the server, press Ctrl+C or close this window.
call npm.cmd run dev -- --port 5173 --strictPort --open http://localhost:5173
if errorlevel 1 (
  echo.
  echo Could not start the server. Check the error above.
  pause
  exit /b 1
)
exit /b 0

:port_busy
echo Port 5173 is already serving another application.
echo Close that application or check the address before trying again.
pause
exit /b 1

:missing_node
echo Node.js and npm are required. Install Node.js 24, then try again.
pause
exit /b 1

:missing_packages
echo Dependencies are missing. Run npm.cmd install in this folder first:
echo "%CD%"
pause
exit /b 1
