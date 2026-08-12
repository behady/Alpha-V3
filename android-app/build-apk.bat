@echo off
REM ===========================================================================
REM  Builds the Alpha Dental Android app and leaves the .apk next to this file.
REM
REM  Just double-click this file. It takes about a minute.
REM ===========================================================================

setlocal

REM Gradle needs Java 21. The Java that ships with Android Studio is too new
REM for it, so we point at the copy in the Downloads folder.
set "JAVA_HOME=C:\Users\PC\Downloads\jdk21_extracted\jdk-21.0.12+8"

if not exist "%JAVA_HOME%\bin\java.exe" (
    echo.
    echo   Java 21 was not found at:
    echo   %JAVA_HOME%
    echo.
    echo   Edit this file and change JAVA_HOME to wherever Java 21 lives.
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"

echo.
echo   Building Alpha Dental...
echo.

call gradlew.bat assembleRelease --console=plain
if errorlevel 1 (
    echo.
    echo   BUILD FAILED - see the messages above.
    echo.
    pause
    exit /b 1
)

REM Copy whatever release APK the build just produced. The filename carries the
REM version number, so naming it here means every version bump silently breaks
REM this line and leaves an old AlphaDental.apk sitting next to a fresh build.
for %%F in ("app\build\outputs\apk\release\AlphaDental-release-*.apk") do (
    copy /y "%%F" "AlphaDental.apk" >nul
)

if not exist "AlphaDental.apk" (
    echo.
    echo   BUILD FAILED - no release APK was produced.
    echo.
    pause
    exit /b 1
)

echo.
echo   ==================================================================
echo    Done. The app is here:
echo    %~dp0AlphaDental.apk
echo.
echo    Copy that file to an Android phone and tap it to install.
echo   ==================================================================
echo.
pause
