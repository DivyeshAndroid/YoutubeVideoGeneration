# Prerequisites

This repository runs a local news-to-YouTube-Short pipeline. Requirements depend on the providers selected in `.env`.

## Required for every configuration

- macOS 13 or newer for the included VoiceStudio, Clipchamp, and LaunchAgent integration. Core Node.js generation can be adapted to Linux.
- Node.js 20 or newer and npm 10 or newer. Node.js 24 is the tested local version.
- Git for cloning and maintaining the repository.
- Internet access for news feeds, Codex, Leonardo/Clipchamp, and YouTube.
- At least 5 GB of free disk space for dependencies, browser profiles, temporary media, and rendered videos.
- A 1080×1920 H.264-capable environment. FFmpeg is supplied by the `ffmpeg-static` npm package.

## Script generation

The default `AI_PROVIDER=codex` requires:

- Codex CLI installed and available as `codex`.
- A valid one-time login from `codex login` that remains available to background jobs.

Alternatively, `AI_PROVIDER=ollama` requires a running Ollama server and the configured `OLLAMA_MODEL` already pulled.

## Image generation

Choose one `IMAGE_MODE`:

- `styled`: no external image service.
- `source`: internet access to publisher pages and permission to reuse their images.
- `leonardo`: Google Chrome, a Leonardo.ai account with available generation tokens, and a saved login in `LEONARDO_USER_DATA_DIR`. The first run may open Chrome for authentication.
- `comfyui`: a running ComfyUI API and the configured SDXL-compatible checkpoint.

For unattended execution, provider authentication must be stored in the dedicated browser profile; a login that exists only in a normal Chrome profile is not visible to headless automation.

## Narration

The default `NARRATION_PROVIDER=voicestudio` requires:

- VoiceStudio installed at `VOICESTUDIO_APP_PATH`.
- A compatible TTS model installed inside VoiceStudio.
- Its local API available at `VOICESTUDIO_BASE_URL`; the pipeline can start the app automatically on macOS.

If VoiceStudio fails, Clipchamp is used automatically. Clipchamp requires Google Chrome, a Microsoft account, and a saved first-run login in `CLIPCHAMP_USER_DATA_DIR`.

For a fully local alternative, choose `NARRATION_PROVIDER=local` and install Piper plus the configured `.onnx` voice. macOS `say` is the final local fallback.

## YouTube upload

Uploading requires:

1. A Google Cloud project with YouTube Data API v3 enabled.
2. An OAuth client of type **Desktop app**.
3. Its JSON file saved as `secrets/youtube-client-secret.json` or the configured equivalent.
4. One successful `npm run youtube-auth`, which creates `secrets/youtube-token.json`.
5. `YOUTUBE_UPLOAD_ENABLED=true` and the intended `YOUTUBE_PRIVACY_STATUS`.

Never commit `.env`, `secrets/`, browser profiles, `work/`, or generated output. They are excluded by `.gitignore`.

## Background execution

The included background service is a per-user macOS LaunchAgent. It requires:

- A logged-in macOS user session.
- The machine to be awake, or configured to wake for scheduled work.
- Valid unattended logins for Codex, Leonardo/Clipchamp, and YouTube.
- Accessibility/browser permissions if a visible browser fallback is needed.

Run `npm run service:install` after completing authentication. Logs are stored in `work/scheduler.log` and `work/scheduler-error.log`.

## Setup sequence

```bash
git clone <repository-url>
cd YoutubeVideoGeneration
npm run setup
codex login
npm run doctor
npm run youtube-auth        # only when uploads are required
npm run generate            # render-only smoke test
npm run run-once            # render and upload if enabled
npm run service:install     # optional recurring background service
```

Review `.env` before the first run. Start with private YouTube uploads and change them to public only after validating the result.
