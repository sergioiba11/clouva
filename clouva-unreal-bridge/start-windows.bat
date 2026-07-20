@echo off
setlocal
cd /d "%~dp0"

if not exist .env (
  echo [ERROR] Falta clouva-unreal-bridge\.env
  echo Copia .env.example como .env y completa CLOUVA_APP_URL y CLOUVA_BRIDGE_TOKEN.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Iniciando clouva-unreal-bridge en modo solo lectura...
call npm start
pause
