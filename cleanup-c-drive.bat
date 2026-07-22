@echo off
setlocal EnableDelayedExpansion
:: ===========================================================================
::  cleanup-c-drive.bat
::  Reclaims the Windows Update download cache (~9 GB) and the Delivery
::  Optimization cache. Both are regenerable SYSTEM caches - Windows rebuilds
::  them as needed. No personal files, documents, or installed apps are touched.
::
::  HOW TO RUN:  right-click this file  ->  "Run as administrator"
::  (It will also self-elevate: if you double-click it, it re-launches with a
::   UAC prompt automatically.)
:: ===========================================================================

:: --- self-elevate to Administrator ----------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ===========================================================================
echo   Windows cache cleanup  (Administrator)
echo ===========================================================================
echo.

:: --- free space BEFORE ------------------------------------------------------
for /f "tokens=3" %%a in ('dir C:\ ^| find "bytes free"') do set BEFORE=%%a
echo Free space before: %BEFORE% bytes
echo.

:: --- stop the services that lock the caches --------------------------------
echo Stopping Windows Update services...
net stop wuauserv >nul 2>&1
net stop bits      >nul 2>&1
net stop dosvc     >nul 2>&1
echo   done.
echo.

:: --- clear the Windows Update download cache (~9 GB) ------------------------
echo Clearing Windows Update download cache...
del /f /s /q "C:\Windows\SoftwareDistribution\Download\*" >nul 2>&1
for /d %%p in ("C:\Windows\SoftwareDistribution\Download\*") do rd /s /q "%%p" >nul 2>&1
echo   done.
echo.

:: --- clear the Delivery Optimization cache ---------------------------------
echo Clearing Delivery Optimization cache...
powershell -NoProfile -Command "try { Delete-DeliveryOptimizationCache -Force -ErrorAction Stop } catch { }" >nul 2>&1
del /f /s /q "C:\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache\*" >nul 2>&1
echo   done.
echo.

:: --- restart the services ---------------------------------------------------
echo Restarting services...
net start bits      >nul 2>&1
net start wuauserv  >nul 2>&1
net start dosvc     >nul 2>&1
echo   done.
echo.

:: --- free space AFTER -------------------------------------------------------
for /f "tokens=3" %%a in ('dir C:\ ^| find "bytes free"') do set AFTER=%%a
echo Free space after:  %AFTER% bytes
echo.
echo ===========================================================================
echo   Cleanup complete.
echo.
echo   TIP: if the disk keeps refilling, Windows has pending updates it is
echo   re-downloading. Open  Settings ^> Windows Update ^> Pause updates
echo   for a week to stop it, then run this script once more.
echo ===========================================================================
echo.
pause
