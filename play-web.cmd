@echo off
setlocal EnableExtensions

set "REPO_DIR=%~dp0"
if "%REPO_DIR:~-1%"=="\" set "REPO_DIR=%REPO_DIR:~0,-1%"

if not exist "%REPO_DIR%\frogcomposband-web.exe" (
    echo [INFO] frogcomposband-web.exe not found, building first...
    call "%REPO_DIR%\build-web.cmd"
    if errorlevel 1 exit /b 1
)

if not exist "%REPO_DIR%\web\public\tiles\32x32.png" (
    echo [INFO] Exporting web sprite sheets...
    python "%REPO_DIR%\tools\export_web_tiles.py"
)

echo [INFO] Starting FrogComposband Web Server at http://127.0.0.1:8080
start "" "http://127.0.0.1:8080"
node "%REPO_DIR%\web\server.mjs"
