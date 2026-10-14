import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { config } from "./config.js";
import type { VideoContent } from "./types.js";
import { ClipchampVoiceService } from "./clipchamp.js";
import { rephraseSceneForDuration } from "./content.js";
import { VoiceStudioService } from "./voicestudio.js";
import { narrationText, SCENE_TAIL_SECONDS } from "./outro.js";

const ffmpeg = ffmpegPath as unknown as string;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function runWithInput(command: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
    child.stdin.end(input);
  });
}

function windowsSpeech(text: string, destination: string): Promise<void> {
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$voice.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::Adult)",
    "if ($voice.Voice.Gender -ne [System.Speech.Synthesis.VoiceGender]::Female) { throw 'No female Windows voice is available' }",
    `$voice.Rate = ${Math.max(-10, Math.min(10, Math.round((config.VOICESTUDIO_SPEED - 1) * 10)))}`,
    `$voice.SetOutputToWaveFile('${destination.replace(/'/g, "''")}')`,
    "$inputText = [Console]::In.ReadToEnd()",
    "$voice.Speak($inputText)",
    "$voice.Dispose()"
  ].join("; ");
  return runWithInput("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], text);
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-i", file, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", () => {
      const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      const last = matches.at(-1);
      if (!last) return reject(new Error(`Could not measure narration duration: ${file}`));
      resolve(Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]));
    });
  });
}

export async function generateNarration(content: VideoContent): Promise<VideoContent> {
  const narrationDir = path.resolve("work", "narration", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(narrationDir, { recursive: true });
  // Clipchamp is also kept ready as the automatic fallback for VoiceStudio.
  const clipchamp = ["clipchamp", "voicestudio"].includes(config.NARRATION_PROVIDER) ? new ClipchampVoiceService({
    executablePath: config.CLIPCHAMP_CHROME_PATH,
    userDataDir: config.CLIPCHAMP_USER_DATA_DIR,
    headless: config.CLIPCHAMP_HEADLESS,
    timeoutMs: config.CLIPCHAMP_TIMEOUT_MS
  }) : undefined;
  const voiceStudio = config.NARRATION_PROVIDER === "voicestudio" ? new VoiceStudioService({
    baseUrl: config.VOICESTUDIO_BASE_URL,
    apiKey: config.VOICESTUDIO_API_KEY,
    timeoutMs: config.VOICESTUDIO_TIMEOUT_MS,
    autoStart: config.VOICESTUDIO_AUTOSTART,
    executablePath: config.VOICESTUDIO_APP_PATH,
    startupTimeoutMs: config.VOICESTUDIO_STARTUP_TIMEOUT_MS
  }) : undefined;
  let voiceStudioUnavailable = false;
  const generateEdgeScene = async (index: number) => {
    const scene = content.scenes[index];
    const output = path.join(narrationDir, `scene-${index}.mp3`);
    const textFile = path.join(narrationDir, `scene-${index}.txt`);
    await fs.writeFile(textFile, narrationText(scene), "utf8");
    await run(config.EDGE_TTS_PYTHON, [
      "-m", "edge_tts", "--file", textFile, "--voice", config.EDGE_TTS_VOICE,
      `--rate=${config.EDGE_TTS_RATE}`, "--write-media", output
    ]);
    if ((await fs.stat(output)).size < 1024) throw new Error("Edge TTS returned an empty audio file");
    scene.audioPath = output;
    scene.audioDurationSeconds = await probeDuration(output);
  };
  const generateClipchampScene = async (index: number) => {
    const scene = content.scenes[index];
    const output = path.join(narrationDir, `scene-${index}.mp3`);
    await clipchamp!.synthesize({
      text: narrationText(scene),
      destinationPath: output,
      language: config.CLIPCHAMP_LANGUAGE,
      voiceName: config.CLIPCHAMP_VOICE_NAME
    });
    scene.audioPath = output;
    scene.audioDurationSeconds = await probeDuration(output);
  };
  const generateVoiceStudioScene = async (index: number) => {
    const scene = content.scenes[index];
    const output = path.join(narrationDir, `scene-${index}.wav`);
    await voiceStudio!.synthesize({
      text: narrationText(scene),
      destinationPath: output,
      language: config.VOICESTUDIO_LANGUAGE,
      profileId: config.VOICESTUDIO_PROFILE_ID,
      instruct: config.VOICESTUDIO_INSTRUCT,
      speed: config.VOICESTUDIO_SPEED,
      steps: config.VOICESTUDIO_STEPS
    });
    scene.audioPath = output;
    scene.audioDurationSeconds = await probeDuration(output);
  };
  const generateServiceScene = async (index: number) => {
    if (config.NARRATION_PROVIDER === "edge") {
      await generateEdgeScene(index);
      return;
    }
    if (voiceStudio && !voiceStudioUnavailable) {
      try {
        await generateVoiceStudioScene(index);
        return;
      } catch (error) {
        voiceStudioUnavailable = true;
        console.warn("VoiceStudio is unavailable; using Clipchamp for this run.", error);
      }
    }
    await generateClipchampScene(index);
  };
  try {
    for (const [index, scene] of content.scenes.entries()) {
      const narration = narrationText(scene);
      const output = path.join(narrationDir, `scene-${index}.aac`);
      console.log(`Generating narration ${index + 1}/${content.scenes.length}: ${scene.heading}`);

      try {
        if (clipchamp || config.NARRATION_PROVIDER === "edge") {
          await generateServiceScene(index);
        } else {
          const wav = path.join(narrationDir, `scene-${index}.wav`);
          try {
            await fs.access(config.PIPER_MODEL);
            await runWithInput(config.PIPER_COMMAND, ["--model", config.PIPER_MODEL, "--output_file", wav], narration);
            await run(ffmpeg, ["-y", "-i", wav, "-c:a", "aac", "-b:a", config.AUDIO_BITRATE, output]);
          } catch (piperError) {
            console.warn("Piper is unavailable; trying the operating-system voice fallback.", piperError);
            if (process.platform !== "darwin" && process.platform !== "win32") throw piperError;
            const fallbackWav = path.join(narrationDir, `scene-${index}.system.wav`);
            if (process.platform === "win32") {
              await windowsSpeech(narration, fallbackWav);
            } else {
              await run("/usr/bin/say", ["-v", "Samantha", "--file-format=WAVE", "--data-format=LEI16@22050", "-o", fallbackWav, narration]);
            }
            if ((await fs.stat(fallbackWav)).size < 8192) {
              throw new Error("Operating-system speech synthesis returned an empty audio file");
            }
            await run(ffmpeg, ["-y", "-i", fallbackWav, "-c:a", "aac", "-b:a", config.AUDIO_BITRATE, output]);
          }
        }

        if (!clipchamp && config.NARRATION_PROVIDER !== "edge" && (await fs.stat(output)).size > 1024) {
          scene.audioPath = output;
          scene.audioDurationSeconds = await probeDuration(output);
        }
      } catch (error) {
        if (config.NARRATION_PROVIDER === "edge") throw error;
        console.warn(`Narration unavailable for scene ${index + 1}; silence will be used.`, error);
      }
    }

    if (clipchamp || voiceStudio || config.NARRATION_PROVIDER === "edge") {
      const maxRephrases = content.scenes.length * 2;
      const narrationBudget = config.VIDEO_DURATION_SECONDS - content.scenes.length * SCENE_TAIL_SECONDS;
      for (let attempt = 0; attempt < maxRephrases; attempt += 1) {
        const totalDuration = content.scenes.reduce((sum, scene) => sum + (scene.audioDurationSeconds ?? 0), 0);
        if (totalDuration <= narrationBudget) {
          const provider = config.NARRATION_PROVIDER === "edge" ? "Edge TTS" : voiceStudio && !voiceStudioUnavailable ? "VoiceStudio" : "Clipchamp";
          console.log(`${provider} narration duration: ${totalDuration.toFixed(2)}s at configured speed.`);
          break;
        }

        const candidates = content.scenes
          .map((scene, index) => ({ index, duration: scene.audioDurationSeconds ?? 0 }))
          .filter((candidate) => candidate.duration > 3 && content.scenes[candidate.index].kind !== "subscribe")
          .sort((a, b) => b.duration - a.duration);
        const longest = candidates[0];
        if (!longest) throw new Error("Narration exceeds the video duration and no scene can be shortened further");

        const overflow = totalDuration - narrationBudget;
        const targetDuration = Math.max(3, longest.duration - overflow - 0.5);
        const scene = content.scenes[longest.index];
        console.log(`Narration is ${overflow.toFixed(2)}s too long; rephrasing scene ${longest.index + 1} for ${targetDuration.toFixed(1)}s at 1x speed.`);
        const shortened = await rephraseSceneForDuration(scene, targetDuration);
        scene.heading = shortened.heading;
        scene.body = shortened.body;
        await generateServiceScene(longest.index);

        if (attempt === maxRephrases - 1) {
          const finalDuration = content.scenes.reduce((sum, item) => sum + (item.audioDurationSeconds ?? 0), 0);
          if (finalDuration > narrationBudget) {
            throw new Error(`Could not reduce narration below ${config.VIDEO_DURATION_SECONDS}s at 1x speed; final duration is ${finalDuration.toFixed(2)}s`);
          }
        }
      }
    }
  } finally {
    await clipchamp?.close();
    if (!content.scenes.some((scene) => scene.audioPath)) {
      await fs.rm(narrationDir, { recursive: true, force: true });
    }
  }
  return content;
}
