@echo off
setlocal EnableExtensions

set "REPO_DIR=%~dp0"
set "BASH_EXE=C:\msys64\usr\bin\bash.exe"

if not exist "%BASH_EXE%" (
    echo [ERROR] MSYS2 not found at "%BASH_EXE%".
    echo Install MSYS2 from https://www.msys2.org/
    echo Then install toolchain with:
    echo   pacman -S --needed base-devel mingw-w64-x86_64-toolchain
    exit /b 1
)

if "%~1"=="" (
    set "MAKE_ARGS=-j4"
) else (
    set "MAKE_ARGS=%*"
)

echo [INFO] Building in "%REPO_DIR%"
echo [INFO] make args: %MAKE_ARGS%

"%BASH_EXE%" -lc "set -e; if [ ! -x /usr/bin/make ]; then echo '[ERROR] Missing /usr/bin/make. Run: pacman -S --needed base-devel' >&2; exit 2; fi; if [ ! -x /mingw64/bin/gcc ]; then echo '[ERROR] Missing /mingw64/bin/gcc. Run: pacman -S --needed mingw-w64-x86_64-toolchain' >&2; exit 3; fi; export PATH=/mingw64/bin:/usr/bin:$PATH; REPO_DIR_UNIX=$(cygpath -u \"$REPO_DIR\"); cd \"$REPO_DIR_UNIX\"; /usr/bin/make %MAKE_ARGS%"
if errorlevel 1 (
    echo [ERROR] Build failed.
    exit /b 1
)

echo [OK] Build finished.
exit /b 0
