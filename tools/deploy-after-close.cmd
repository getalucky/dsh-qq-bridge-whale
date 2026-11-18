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
echo 检查 billion-context 是否已移除……
if exist "%DSH_HOME%\profiles\desktop\node_modules\billion-context" (
  echo 还在，补跑一次 pnpm install --force
  node "%DSH_HOME%\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install --dir "%DSH_HOME%\profiles\desktop" --prefer-offline --force
)
if exist "%DSH_HOME%\profiles\desktop\node_modules\billion-context" (
  echo [FAIL] billion-context 还在 node_modules 里，别开 DSH，先看上面的输出。
) else (
  echo [OK] billion-context 已移除，原生压缩恢复。
)
echo.
echo 装完了，去看上面的结果，没问题就可以开 DSH 了。
pause
