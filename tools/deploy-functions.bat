@echo off
echo.
echo  cmartwise — Deploy Edge Functions
echo  ===================================
echo.

cd /d "C:\IKA-BUSINESS\PROJECTS\cmartwise-website"

echo  Step 1: Installing Supabase CLI...
call npm install -g supabase 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  Trying npx instead...
)

echo.
echo  Step 2: Logging in to Supabase (browser will open)...
call npx supabase login

echo.
echo  Step 3: Deploying generate-test function...
call npx supabase functions deploy generate-test --project-ref zsgnggtwfxyqzvrnlaqg --no-verify-jwt

echo.
echo  Step 4: Deploying evaluate-speaking function...
call npx supabase functions deploy evaluate-speaking --project-ref zsgnggtwfxyqzvrnlaqg --no-verify-jwt

echo.
echo  Step 5: Deploying process-lesson function...
call npx supabase functions deploy process-lesson --project-ref zsgnggtwfxyqzvrnlaqg

echo.
echo  Step 6: Deploying translate function...
call npx supabase functions deploy translate --project-ref zsgnggtwfxyqzvrnlaqg

echo.
echo  Step 7: Deploying enrich-vocab function...
call npx supabase functions deploy enrich-vocab --project-ref zsgnggtwfxyqzvrnlaqg

echo.
echo  Step 8: Deploying process-direct-notes function...
call npx supabase functions deploy process-direct-notes --project-ref zsgnggtwfxyqzvrnlaqg --no-verify-jwt

echo.
echo  Done! All six functions deployed.
echo.
echo  IMPORTANT: Set your Anthropic API key in Supabase:
echo  Dashboard ^> Edge Functions ^> Manage secrets ^> Add ANTHROPIC_API_KEY
echo.
pause
