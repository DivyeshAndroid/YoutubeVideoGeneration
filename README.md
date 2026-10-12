# Automated YouTube Video Generator

A cross-platform Node.js pipeline for Windows and macOS that turns structured content or freshly researched trending news into an illustrated vertical YouTube Short of up to 60 seconds, then optionally uploads it on a recurring schedule.

## Quick start

```bash
npm run setup
npm run doctor
npm run generate
```

The generated MP4 and matching metadata JSON are written to `output/`. No OpenAI key or paid AI service is required.

See [PREREQUISITES.md](PREREQUISITES.md) for the complete machine, account, authentication, provider, YouTube, and background-service requirements.

## Low-hardware AI setup

The default script engine is the installed Codex CLI. It uses your existing Codex/ChatGPT sign-in and does not require an OpenAI API key or a large model on your computer. RSS supplies the factual news inputs, and `codex exec` returns the script through a strict JSON schema.

- **Script and hashtags:** Codex CLI in non-interactive mode.
- **Images:** Article Open Graph images by default, with automatic Leonardo generation when publisher images are unavailable. ComfyUI remains optional.
- **Narration:** macOS `say` works without a model download. Piper with `en_US-lessac-high` remains an optional quality upgrade.
- **Current news:** keyless Google News RSS; internet access is needed only to download headlines, not to run the AI models.

Authenticate Codex once if it is not already signed in:

```bash
codex login
```

For unattended scheduled runs, the saved Codex login must remain valid. Managed ChatGPT Business and Enterprise workspaces can alternatively use a Codex access token. Set `AI_PROVIDER=ollama` only if you later decide to run a local model.

Check the required command and optional media providers before enabling trending mode:

```bash
npm run doctor
```

## Content modes

- **Local:** keep `CONTENT_MODE=local` and edit `content/example.json`.
- **Trending news:** set `CONTENT_MODE=trending`, `NEWS_TOPIC`, and `NEWS_REGION`. Each run aggregates current coverage from Google News RSS and GDELT, plus Hacker News for technology-like topics, asks Codex CLI for a source-backed script, and stores sources in the metadata and YouTube description.

For trending mode, adjust `NEWS_LOOKBACK_HOURS`, `NEWS_PROVIDERS`, `NEWS_MAX_ITEMS`, `MAX_SCENES`, `HASHTAG_COUNT`, and `GENERATE_IMAGES` to control recency, sources, pacing, discovery metadata, and image cost. The providers run independently, so one outage does not stop the flow; results are normalized, deduplicated, and ranked by freshness, topic relevance, and independent publisher corroboration. The hottest supported development leads both the script and its specific, non-clickbait title. `VIDEO_DURATION_SECONDS` is the maximum output duration (60 seconds by default); shorter narration produces a shorter video. Hashtags are selected for current relevance and discoverability, but no hashtag can guarantee virality. AI-generated news can still be wrong; keep uploads private and review the video, hashtags, and source list before publishing.

The configured production flow creates a five-story roundup: exactly five distinct developments ordered hottest first, one scene and one source per story. With `IMAGE_MODE=leonardo`, every scene receives a unique generated 9:16 editorial visual based on that story's image prompt; publisher images are not reused.

### Image modes

- `IMAGE_MODE=source` downloads the article's `og:image` or Twitter image and uses it for the scene tied to that exact source URL. If the source URL or publisher image is unavailable, Leonardo generates that scene's visual using the existing editorial strategy and retry logic. If Leonardo also fails, the run stops rather than rendering a missing image.
- `IMAGE_MODE=styled` makes no image downloads and uses the built-in animated design.
- `IMAGE_MODE=comfyui` generates each scene locally from its narration-derived image prompt.
- `IMAGE_MODE=leonardo` generates scene images from their prompts through Leonardo's web application.

### Leonardo image generation

The Leonardo service uses a persistent Chrome profile and runs headlessly during normal operation. If the Leonardo session expires, it opens a normal non-automated Chrome window so Google, Apple, Microsoft, Canva, or email authentication can work. Complete sign-in and then close that window; the service resumes generation headlessly with the saved session.

Generate one image directly from text:

```bash
npm run leonardo-image -- "A cinematic city skyline at sunrise, vertical composition" output/city.png
```

The image is downloaded and converted to the format indicated by the destination extension (`.png`, `.jpg`, or `.webp`). The production configuration uses Leonardo's auto-preset, the selected style ID, fast mode, one image, and the configured 1:1 generation canvas. The renderer crops the result into its vertical scene canvas. Leonardo generation can consume account tokens or credits.

Generation is managed with bounded retries. The service detects visible moderation, credit, rate-limit, authentication, and generic generation errors. Retryable failures receive a shorter, neutral, non-graphic editorial prompt; authentication and exhausted-credit failures stop immediately with an actionable error. Failed attempts save a screenshot, page HTML, prompt, URL, and error under `work/leonardo-diagnostics/`.

Model selection uses Leonardo's supported `auto-preset` workflow. Before submission, each news scene is classified as safe editorial, technology photography, data visualization, science documentary, or general editorial. That strategy is encoded into the prompt so Leonardo can select the best current underlying model automatically. Sensitive news uses symbolic, non-graphic illustration rather than a deceptive photorealistic likeness; technology stories favor realistic photography, financial stories use abstract data visuals, and science stories use plausible documentary visualization.

Source images can be copyrighted. The pipeline includes article attribution in the description, but attribution does not itself grant reuse rights. Use `source` only for publishers or assets whose licenses allow reuse; otherwise choose `styled` or a properly licensed image source.

## Upload-quality output

The default render profile is optimized for YouTube Shorts: 1080×1920, 30 FPS, H.264 High Profile at CRF 18, AAC stereo at 48 kHz/192 kbps, `faststart` metadata, normalized speech, and a subtle Ken Burns movement on every still image. Every segment contains an audio stream—even when narration is unavailable—so concatenation and YouTube ingestion remain reliable. Increase quality with a lower `VIDEO_CRF` (larger file), or render faster with `VIDEO_PRESET=medium`.

## Narration

After the script and images are generated, VoiceStudio converts each scene's heading and body into speech. If VoiceStudio cannot start or generate audio, the run automatically switches to the Clipchamp automation service. Scene-level files keep each image aligned with its narration, while the final render joins them into one continuous audio track. The YouTube description automatically discloses the generated voice.

VoiceStudio is the default narration provider. Set optional exact `CLIPCHAMP_LANGUAGE` and `CLIPCHAMP_VOICE_NAME` values for its automatic Clipchamp fallback. Speech remains at the configured speed. If the combined narration exceeds the configured video duration, the pipeline rephrases and regenerates the longest scene until the narration fits instead of speeding up the voice.

Normal runs are headless by default. For the first run only, set `CLIPCHAMP_HEADLESS=false` and sign in in the Chrome window; the login is reused from `work/clipchamp-profile`. You can also create one voice file directly:

```bash
npm run clipchamp-voice -- "Text to narrate" output/voice.mp3 "English (United States)" "Jenny"
```

Clipchamp is a browser UI rather than a stable public text-to-speech API, so Microsoft UI changes may require locator updates in `src/clipchamp.ts`.

For an offline fallback, set `NARRATION_PROVIDER=local` and configure `PIPER_COMMAND` and `PIPER_MODEL`. On macOS, the built-in `say` voice is used if Piper is unavailable.

For neural presenter narration, install `python -m pip install -r requirements-tts.txt` and set `NARRATION_PROVIDER=edge`, `EDGE_TTS_PYTHON=python`, `EDGE_TTS_VOICE=en-US-GuyNeural`, and `EDGE_TTS_RATE=+0%`. Set `EDGE_TTS_PYTHON` to your virtual environment's Python executable when using one. This provider requires internet access and sends narration text to Microsoft's online speech service. It supports voice and pace selection, but does not expose Azure's explicit newscast style. Generation stops on a speech failure so it cannot silently produce an unvoiced video.

### Windows configuration

The Windows example enables trending news, neural presenter narration, publisher images with Leonardo fallback, and generation at the start of every hour in Asia/Kolkata. Uploading remains disabled. To configure a fresh checkout in PowerShell:

```powershell
npm.cmd ci
python -m venv work/edge-tts-venv
work/edge-tts-venv/Scripts/python.exe -m pip install -r requirements-tts.txt
Copy-Item .env.windows.example .env
npm.cmd run doctor
npm.cmd run service:install
```

Complete Leonardo sign-in in the project's Chrome profile through to the image generator, then close the window. Normal runs reuse that session. The Windows scheduled task runs hidden, restarts at sign-in, and writes its output to `work/logs/scheduler.log`. Use `npm.cmd run generate` for a local preview without uploading. Run the image fallback tests with `node --import tsx --test tests/images.test.ts`.

On Windows, a bare `CODEX_COMMAND=codex` also discovers the desktop app's installed executable when Codex is absent from the background task's PATH. An explicit executable path is respected. The background runner builds the project and captures stdout and stderr directly, including timestamped job starts, completions, and failures. Run `node scripts/scheduler-runner.mjs --run-once` for an immediate local job logged to `work/logs/job-now.log`.

Unattended jobs fail with a logged authentication error if Leonardo's saved session is missing, instead of repeatedly opening login windows. Complete setup through a manual `npm run leonardo-image` command before relying on unattended image generation.

To run a job with an interactive sign-in window, use `node scripts/scheduler-runner.mjs --run-once --authenticate`. It opens a new window in the project's saved Chrome profile. Finish sign-in through to Leonardo's generator and close that window to resume the job. Hourly jobs remain non-interactive.

To reuse a Chrome profile reserved for testing, close its Chrome windows and run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/import-chrome-profile.ps1 -ProfileDirectory "Profile 6"` with that profile's actual directory name. The script imports its session storage, cookies, and preferences into `work/leonardo-divyesh`. Set `LEONARDO_USER_DATA_DIR=work/leonardo-divyesh` and `LEONARDO_PROFILE_DIRECTORY=Profile 6` in `.env`. A Google/Chrome account sign-in alone does not establish a Leonardo session; verify that the selected profile reaches Leonardo's generator before running unattended jobs.

For Chrome for Testing, set `PLAYWRIGHT_BROWSERS_PATH` to the project's `work/browsers` directory and run `node node_modules/playwright-core/cli.js install chromium --no-shell`. With regular Chrome closed, add `-FullProfile -DestinationRoot <project-path>\work\chrome-for-testing-profile` to the import command. Set `LEONARDO_USER_DATA_DIR=work/chrome-for-testing-profile`, select the copied `LEONARDO_PROFILE_DIRECTORY`, and set `LEONARDO_CHROME_PATH` to the downloaded browser's executable. Copied profiles are local files under ignored `work/`; browser-encrypted login cookies may still require a fresh sign-in in Chrome for Testing.

With `NARRATION_PROVIDER=voicestudio`, the service calls VoiceStudio's local API and starts a standard macOS or Windows installation automatically when needed. Choose a saved clone or designed voice with `VOICESTUDIO_PROFILE_ID`; leave it blank to use VoiceStudio's default. `VOICESTUDIO_LANGUAGE`, `VOICESTUDIO_INSTRUCT`, `VOICESTUDIO_SPEED` (1.25× by default), and `VOICESTUDIO_STEPS` control pronunciation, delivery, speed, and quality. A VoiceStudio failure disables further retries during that run and sends the current and remaining scenes to Clipchamp.

Generate one WAV file directly:

```bash
npm run voicestudio-voice -- "Text to narrate" output/voice.wav [profile-id]
```

VoiceStudio must have a compatible TTS model installed. If local API authentication is enabled in VoiceStudio, set `VOICESTUDIO_API_KEY`.

## Connect YouTube

1. In Google Cloud, enable **YouTube Data API v3**.
2. Create an OAuth client of type **Desktop app** and download its JSON file to `secrets/youtube-client-secret.json`.
3. Run `npm run youtube-auth` and open the printed authorization URL.
4. Test safely with `YOUTUBE_PRIVACY_STATUS=private` and `YOUTUBE_UPLOAD_ENABLED=true`.
5. Run `npm run run-once`.

Uploads are disabled by default. The generated OAuth token is stored under `secrets/`, which is excluded from Git.

## Run recurringly

### World News And Repeat Protection

Trending runs read Dainik Bhaskar's public international page first, preserving its editorial listing order. Locked articles and stale stories are excluded. When fewer than five unseen stories remain, the reader tries BBC World, the Guardian World, and Al Jazeera's public RSS feeds, then the existing Google News/GDELT/Hacker News providers configured by `NEWS_PROVIDERS`. `NEWS_LOOKBACK_HOURS` applies to every source; listing order is an editorial priority signal, not a measured global popularity ranking.

`NEWS_HISTORY_FILE` defaults to `work/news-history.json`. Completed videos are recorded before upload, including render-only videos. Existing video metadata in `output/` also seeds and recovers the history. Keep the history file when moving machines or removing old outputs. URL/title checks and a multilingual AI event comparison reject previously covered stories, including reworded headlines and reports from other publishers. Duplicate-check errors stop generation; they never disable protection. A process lock prevents overlapping manual and scheduled jobs from selecting the same stories.

If all sources yield fewer than five unseen recent events, that scheduled run is skipped and the next scheduled run tries again. No repeated or invented news is used to fill the video.

Set `CRON_SCHEDULE` and `TIMEZONE` in `.env`, then:

```bash
npm run scheduler
```

For a machine that restarts, run this command using a process manager such as `pm2`, a macOS LaunchAgent, or systemd. The scheduler prevents overlapping runs.

### Background service

Install the included LaunchAgent to keep the scheduler running independently of Codex and Terminal. It starts at login, restarts after failures, reads `CRON_SCHEDULE` and `TIMEZONE` from `.env`, and writes logs under `work/`:

```bash
npm run service:install
```

Remove it with `npm run service:uninstall`. The active production configuration runs every four hours in Asia/Kolkata, anchored at 3:00, 7:00, 11:00, 15:00, 19:00, and 23:00 so the evening peak is included.

On Windows, open PowerShell in the repository and install the per-user Task Scheduler job:

```powershell
npm run service:install
```

Remove it with `npm run service:uninstall`. Chrome and VoiceStudio are detected in their standard Windows installation locations; set `CLIPCHAMP_CHROME_PATH`, `LEONARDO_CHROME_PATH`, or `VOICESTUDIO_APP_PATH` only for custom locations.

## Commands

- `npm run generate` — render only; never upload.
- `npm run run-once` — render, then upload only if explicitly enabled.
- `npm run youtube-auth` — perform one-time YouTube OAuth authorization.
- `npm run scheduler` — keep running and execute on the configured cron schedule.
- `npm run check` — TypeScript validation.
- `npm run doctor` — verify Ollama, ComfyUI, and the Piper voice model.
- `npm run clipchamp-voice -- <text> <destination> [language] [voice]` — generate and download one Clipchamp voice file.
- `npm run voicestudio-voice -- <text> <destination> [profile-id]` — generate one audio file with the local VoiceStudio app.
- `npm run leonardo-image -- <prompt> <destination>` — generate and download one Leonardo image.

After every pipeline run—successful or failed—the service removes that run's temporary narration, generated-image, and render-intermediate directories and quits VoiceStudio. Final videos and metadata in `output/`, logs, credentials, and reusable browser profiles are retained. Browser automation contexts are closed by their respective services without closing unrelated Chrome tabs.

Keep the first real uploads `private` until you have reviewed the complete output and metadata.
