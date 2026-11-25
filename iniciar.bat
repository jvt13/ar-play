@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale Node.js 18 ou superior. & pause & exit /b 1)
echo Abra http://localhost:8080 no navegador.
node server.mjs
pause
