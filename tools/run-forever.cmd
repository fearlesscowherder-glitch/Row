@echo off
rem Keeps the dashboard running: starts server.mjs and restarts it if it stops.
rem Started hidden at Windows logon by tools\start-hidden.vbs (Task Scheduler task "Row Dashboard").
cd /d "%~dp0.."
if not exist logs mkdir logs
set "NODE=node"
where node >nul 2>&1 || set "NODE=%LOCALAPPDATA%\hermes\node\node.exe"
:loop
echo [%date% %time%] starting >> logs\server.log
"%NODE%" server.mjs >> logs\server.log 2>&1
echo [%date% %time%] stopped (exit %errorlevel%), restarting in 15s >> logs\server.log
ping -n 16 127.0.0.1 >nul
goto loop
