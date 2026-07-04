@echo off
rem Daily 6 PM auto-post — invoked by Windows Task Scheduler (task: LeverageStackDailyPost).
rem Posts next queued video to Instagram + Facebook. TikTok stays off until
rem TIKTOK_ENABLED=true is set in .env (app under review; posting manually).
cd /d "C:\Users\jesse\Documents\Projects\TheLeverageStack"
if not exist logs mkdir logs
echo. >> logs\post-daily.log
echo ===== %date% %time% ===== >> logs\post-daily.log
node automation\post.js >> logs\post-daily.log 2>&1
