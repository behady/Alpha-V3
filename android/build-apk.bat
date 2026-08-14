@echo off
REM ===========================================================================
REM  Builds the Alpha Dental Android app and leaves AlphaDental.apk next to
REM  this file. Just double-click it. Takes a minute or two.
REM ===========================================================================

setlocal

REM Gradle needs Java 21. The Java bundled with Android Studio is too new and the
REM system Java is too old, so point at the copy in Downloads.
REM It must be Java 21 exactly. Android Studio ships Java 25, which the Android
REM plugin rejects outright, and the system Java is 11, which is too old.
REM
REM The second path is the copy this project used to use. Something gutted it on
REM 2026-08-14 (only bin and lib remained), so it is kept only as a fallback.
set "JAVA_HOME=C:\Users\PC\.jdks\jbr-21.0.11"
if not exist "%JAVA_HOME%\bin\java.exe" set "JAVA_HOME=C:\Users\PC\Downloads\jdk21_extracted\jdk-21.0.12+8"

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

if not exist "firebase.properties" (
    echo.
    echo   firebase.properties is missing.
    echo   It tells the app which Firebase project to talk to.
    echo   See README.md - "If firebase.properties goes missing".
    echo.
    pause
    exit /b 1
)

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

REM Copy whatever release APK was produced. The filename carries the version
REM number, so hardcoding it here would silently leave an old APK in place after
REM every version bump.
del /q "AlphaDental.apk" 2>nul
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
