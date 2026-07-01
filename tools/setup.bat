@echo off
echo.
echo  cmartwise Lesson Recorder - Setup
echo  ==================================
echo.
echo  Installing required packages...
echo.

python -m pip install faster-whisper pyaudiowpatch numpy scipy --quiet

echo.
echo  Done! All packages installed.
echo.
echo  First run will download the Whisper model (~1.5 GB).
echo  This only happens once - subsequent runs are instant.
echo.
pause
