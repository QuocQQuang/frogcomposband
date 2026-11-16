@echo off
setlocal EnableExtensions

set "REPO_DIR=%~dp0"
if "%REPO_DIR:~-1%"=="\" set "REPO_DIR=%REPO_DIR:~0,-1%"
set "BASH_EXE=C:\msys64\usr\bin\bash.exe"

if not exist "%BASH_EXE%" (
    echo [ERROR] MSYS2 not found at "%BASH_EXE%".
    exit /b 1
)

echo [INFO] Building frogcomposband-web.exe in "%REPO_DIR%"
"%BASH_EXE%" -lc "set -e; export PATH=/mingw64/bin:/usr/bin:$PATH; REPO_DIR_UNIX=$(cygpath -u \"%REPO_DIR%\"); cd \"$REPO_DIR_UNIX/src\"; /usr/bin/make -f Makefile.web -j4"
if errorlevel 1 (
    echo [ERROR] Web backend build failed.
    exit /b 1
)

echo [OK] Built frogcomposband-web.exe
exit /b 0
