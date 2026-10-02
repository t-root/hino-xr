@echo off
rem Chi tim Python roi chay run.py. Toan bo buoc con lai nam trong run.py.
cd /d "%~dp0"

if not defined SystemRoot set "SystemRoot=C:\Windows"
set "PATH=%SystemRoot%\System32;%PATH%"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    where python >nul 2>nul && set "PY=python"
)
if not defined PY (
    echo [LOI] Khong tim thay Python.
    echo Cai Python 3 o https://www.python.org roi chay lai file nay.
    echo.
    pause
    exit /b 1
)

%PY% run.py %*
