import cron from "node-cron";
import { config } from "./config.js";
import { runPipeline } from "./pipeline.js";
import { authorizeYouTube } from "./youtube.js";
import { doctor } from "./doctor.js";
import { downloadClipchampVoice } from "./clipchamp.js";
import { generateLeonardoImage } from "./leonardo.js";
import { generateVoiceStudioAudio } from "./voicestudio.js";

const command = process.argv[2] ?? "generate";

if (command === "generate") {
  await runPipeline(false);
} else if (command === "run-once") {
  await runPipeline(true);
} else if (command === "youtube-auth") {
  await authorizeYouTube();
} else if (command === "doctor") {
  await doctor();
} else if (command === "clipchamp-voice") {
  const [text, destinationPath, language, voiceName] = process.argv.slice(3);
  if (!text || !destinationPath) {
    throw new Error("Usage: clipchamp-voice <text> <destination-path> [language] [voice-name]");
  }
  const output = await downloadClipchampVoice({ text, destinationPath, language, voiceName }, {
    executablePath: config.CLIPCHAMP_CHROME_PATH,
    userDataDir: config.CLIPCHAMP_USER_DATA_DIR,
    headless: config.CLIPCHAMP_HEADLESS,
    timeoutMs: config.CLIPCHAMP_TIMEOUT_MS
  });
  console.log(`Clipchamp voice saved to ${output}`);
} else if (command === "leonardo-image") {
  const [prompt, destinationPath] = process.argv.slice(3);
  if (!prompt || !destinationPath) {
    throw new Error("Usage: leonardo-image <prompt> <destination-path>");
  }
  const output = await generateLeonardoImage({ prompt, destinationPath }, {
    executablePath: config.LEONARDO_CHROME_PATH,
    userDataDir: config.LEONARDO_USER_DATA_DIR,
    headless: config.LEONARDO_HEADLESS,
    timeoutMs: config.LEONARDO_TIMEOUT_MS,
    authenticationTimeoutMs: config.LEONARDO_AUTH_TIMEOUT_MS,
    generatorUrl: config.LEONARDO_GENERATOR_URL,
    maxAttempts: config.LEONARDO_MAX_ATTEMPTS
  });
  console.log(`Leonardo image saved to ${output}`);
} else if (command === "voicestudio-voice") {
  const [text, destinationPath, profileId] = process.argv.slice(3);
  if (!text || !destinationPath) {
    throw new Error("Usage: voicestudio-voice <text> <destination-path> [profile-id]");
  }
  const output = await generateVoiceStudioAudio({
    text,
    destinationPath,
    profileId: profileId ?? config.VOICESTUDIO_PROFILE_ID,
    language: config.VOICESTUDIO_LANGUAGE,
    instruct: config.VOICESTUDIO_INSTRUCT,
    speed: config.VOICESTUDIO_SPEED,
    steps: config.VOICESTUDIO_STEPS
  }, {
    baseUrl: config.VOICESTUDIO_BASE_URL,
    apiKey: config.VOICESTUDIO_API_KEY,
    timeoutMs: config.VOICESTUDIO_TIMEOUT_MS,
    autoStart: config.VOICESTUDIO_AUTOSTART,
    executablePath: config.VOICESTUDIO_APP_PATH,
    startupTimeoutMs: config.VOICESTUDIO_STARTUP_TIMEOUT_MS
  });
  console.log(`VoiceStudio audio saved to ${output}`);
} else if (command === "scheduler") {
  if (!cron.validate(config.CRON_SCHEDULE)) throw new Error(`Invalid CRON_SCHEDULE: ${config.CRON_SCHEDULE}`);
  let running = false;
  cron.schedule(config.CRON_SCHEDULE, async () => {
    if (running) return console.warn("Previous pipeline is still running; skipping this occurrence.");
    running = true;
    try { await runPipeline(true); } catch (error) { console.error(error); } finally { running = false; }
  }, { timezone: config.TIMEZONE });
  console.log(`Scheduler active: ${config.CRON_SCHEDULE} (${config.TIMEZONE})`);
} else {
  throw new Error(`Unknown command: ${command}`);
}
