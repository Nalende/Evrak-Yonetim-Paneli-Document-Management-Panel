@echo off
chcp 65001 >nul
title Evrak Yonetim Paneli - Portable Sunucu
cd /d "%~dp0"

echo ============================================================================
echo   EVRAK YONETIM PANELI (3D FIZIKSEL BASVURU DOSYASI PLATFORMU)
echo   [ULTRA HAFIF PORTABLE SURUM - KURULUM GEREKTIRMEZ]
echo ============================================================================
echo.

REM 1. Gomulu (Portable) Node.js ve Native kutuphane yolunu tanimla
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" (
    if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    ) else (
        set "NODE_EXE=node"
    )
)

set "PATH=%~dp0runtime;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
set "UV_THREADPOOL_SIZE=2"
set "AUTO_OPEN_BROWSER=1"

REM 2. Eger 3001 portunda eski bir sunucu aciksa cakismayi onlemek icin kapat
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [BILGI] Sunucu baslatiliyor, hazir oldugunda tarayici otomatik acilacak...
echo [ADRES] http://localhost:3001
echo [BILGI] Uygulamayi kapatmak icin bu siyah pencereyi kapatmaniz yeterlidir.
echo.

REM 3. Tek dosya halinde paketlenmis tam bagimsiz sunucuyu calistir
"%NODE_EXE%" --max-old-space-size=512 "%~dp0app\server.mjs"

pause
