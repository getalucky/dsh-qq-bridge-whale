@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title wait-for-dsh-then-deploy
echo 正在等 DeepSeek Harness 退出，全关掉后自动开始装。这个窗口别关。
:wait
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if errorlevel 1 goto install
timeout /t 3 /nobreak >nul
goto wait
:install
echo DSH 已退出，开始部署。
node tools\deploy.mjs
echo.
echo 装完了，去看上面的结果，没问题就可以开 DSH 了。
pause
