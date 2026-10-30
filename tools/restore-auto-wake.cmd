@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo ===== 体检 bridge 自动唤醒 =====
node tools\verify-host.mjs
if not errorlevel 1 goto ok

echo.
echo 被覆盖了，正在按 pnpm patch 重装（不改代码、不动 client.js）...
set "PROFILE=%DSH_HOME%\profiles\desktop"
if "%DSH_HOME%"=="" set "PROFILE=D:\DSH\profiles\desktop"
if not exist "%PROFILE%\package.json" (
  echo 找不到 profile：%PROFILE%
  goto fail
)
cd /d "%PROFILE%"
call pnpm install --force
if errorlevel 1 goto fail

cd /d "%~dp0.."
echo.
node tools\verify-host.mjs
if errorlevel 1 goto fail

:ok
echo.
echo 检查通过。重启 DSH 才会加载新代码。
pause
exit /b 0

:fail
echo.
echo 恢复失败 —— 先别重启 DSH，把上面的报错发出来。
pause
exit /b 1
