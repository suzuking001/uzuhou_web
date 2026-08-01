@echo off
setlocal EnableExtensions
title Vortex Lab - WebGPU CFD

set "SOURCE_DIR=%~dp0"
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"
set "APP_DIR=%LOCALAPPDATA%\VortexLabWebGPU"
set "USE_CODEX=0"

echo.
echo ========================================
echo   Vortex Lab - WebGPU CFD Launcher
echo ========================================
echo.

rem Use a normal npm installation when available.
where npm.cmd >nul 2>nul
if not errorlevel 1 goto prepare_local_copy

rem Fall back to the Node.js runtime bundled with Codex Desktop.
set "CODEX_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "CODEX_BIN_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback"
set "CODEX_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
if not exist "%CODEX_NODE_DIR%\node.exe" goto node_not_found
if not exist "%CODEX_PNPM%" goto node_not_found
set "PATH=%CODEX_NODE_DIR%;%CODEX_BIN_DIR%;%PATH%"
set "USE_CODEX=1"

:prepare_local_copy
echo [1/3] Preparing a local runtime copy...
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
robocopy "%SOURCE_DIR%" "%APP_DIR%" /MIR /XD ".git" "node_modules" "dist" /XF "start-vortex-lab.bat" "*.log" /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copy_failed
cd /d "%APP_DIR%"

if exist "node_modules\vite\bin\vite.js" goto start_server

echo [2/3] Installing dependencies. This is needed only once...
if "%USE_CODEX%"=="1" goto install_with_codex
call npm.cmd ci
if errorlevel 1 goto install_failed
goto start_server

:install_with_codex
call "%CODEX_PNPM%" dlx npm@11.5.2 ci
if errorlevel 1 goto install_failed

:start_server
if /I "%~1"=="--check" goto check_success
echo [3/3] Starting Vortex Lab...
echo The browser will open automatically.
echo Keep this window open while using Vortex Lab.
echo.
if "%USE_CODEX%"=="1" goto start_with_codex
call npm.cmd run dev -- --open
goto server_stopped

:start_with_codex
call "%CODEX_PNPM%" dlx npm@11.5.2 run dev -- --open
goto server_stopped

:check_success
echo [3/3] Launcher check completed successfully.
exit /b 0

:node_not_found
echo [ERROR] Node.js and npm were not found.
echo Install Node.js 22 LTS from https://nodejs.org/
echo Then double-click this file again.
echo.
pause
exit /b 1

:copy_failed
echo [ERROR] Files could not be copied to:
echo %APP_DIR%
echo.
pause
exit /b 1

:install_failed
echo.
echo [ERROR] Dependency installation failed.
echo Local runtime directory: %APP_DIR%
echo Check the messages above and your network connection.
echo.
pause
exit /b 1

:server_stopped
echo.
echo Vortex Lab has stopped.
pause
exit /b 0
