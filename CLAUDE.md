# The Leverage Stack — Claude Code Project Context

## What this is
Automated faceless Instagram + Facebook content pipeline.
Niche: AI Tools & Finance. Brand: @theleveragestack.
Posts 5 Reels/week. Fully automated — Claude does the work.

## Stack
- Node.js 18+ (pipeline orchestrator, API poster)
- FFmpeg at C:/Users/jesse/Documents/ffmpeg/bin/ffmpeg.exe (video assembly)
- VoiceBox local server at 127.0.0.1:17493 (AI voiceover — "LeverageVoice" cloned profile, qwen 1.7B engine; free, no API credits)
- Meta Graph API (Instagram Reels publishing, Facebook cross-post)
- Cloudflare R2 (video hosting for Meta URL requirement)

## Key Files
- `config/channel.json` — brand settings, voice config, affiliate links
- `content/scripts/day-XX.json` — 30-day script library
- `automation/pipeline.js` — generates voiceover + assembles video
- `automation/post.js` — posts from queue to Instagram via Graph API
- `automation/status.js` — pipeline health check
- `docs/meta-setup-guide.md` — one-time Meta Developer App setup

## Workflow
1. Scripts live in content/scripts/ as JSON
2. Run `node automation/pipeline.js` → renders MP4s to content/queue/
3. Run `node automation/post.js` → posts next queued video to Instagram
4. Meta Business Suite auto-cross-posts to Facebook page

## Rules
- NEVER commit .env or any file containing API keys
- NEVER log personal data to external services
- Keep scripts under 500 lines — split if needed
- Health data from WeightLoss project stays in WeightLoss project

## Monetization milestones
- Day 1: Affiliate links in bio (ElevenLabs 55%, Writesonic 30% lifetime)
- 500 followers: Instagram Gifts / Facebook Stars on Reels
- 5,000 followers: Facebook Content Monetization
- 10,000 followers: Instagram Subscriptions, Reels bonuses
