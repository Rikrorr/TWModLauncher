@echo off
REM === TWModLauncher MSVC Build Environment ===
REM Loads Visual Studio 2022 build tools environment, then runs the given command

call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Could not load VS 2022 build environment.
    echo Make sure "Desktop development with C++" workload is installed.
    exit /b 1
)

set CARGO_HTTP_CHECK_REVOKE=false

REM Add Rust toolchain to PATH
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

REM Run the command passed as arguments
%*
