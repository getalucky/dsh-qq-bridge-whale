@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo ===== 体检 bridge 自动唤醒 =====
node tools\verify-host.mjs
if not errorlevel 1 goto ok

echo.
echo 被覆盖了，正在从仓库拷回 lib（版本一致才拷，不动 client.js）...
node tools\repair-bridge.mjs
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
