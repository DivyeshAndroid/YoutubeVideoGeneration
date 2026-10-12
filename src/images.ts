import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { VideoContent } from "./types.js";
import { LeonardoImageService } from "./leonardo.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const workflow = (prompt: string, prefix: string) => ({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: config.COMFYUI_CHECKPOINT } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "text, letters, logo, watermark, blurry, low quality, distorted face, extra fingers", clip: ["1", 1] } },
  "4": { class_type: "EmptyLatentImage", inputs: { width: 768, height: 1344, batch_size: 1 } },
  "5": { class_type: "KSampler", inputs: { seed: Math.floor(Math.random() * 2_147_483_647), steps: config.COMFYUI_STEPS, cfg: 6, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
  "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
  "7": { class_type: "SaveImage", inputs: { filename_prefix: prefix, images: ["6", 0] } }
});

const htmlEntity = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(?:x27|39);/gi, "'");

type LeonardoVisualStrategy = "safe-editorial" | "technology-photo" | "data-visualization" | "science-documentary" | "general-editorial";

function leonardoPrompt(content: VideoContent, sceneIndex: number): { prompt: string; strategy: LeonardoVisualStrategy } {
  const scene = content.scenes[sceneIndex];
  const context = `${content.title} ${scene.heading} ${scene.body} ${scene.imagePrompt ?? ""}`;
  const base = scene.imagePrompt || `${scene.heading}. ${scene.body}`;
  if (/\b(war|attack|killed|death|dead|explosion|weapon|military|conflict|riot|disaster|crash|victim|election|president|minister|politician)\b/i.test(context)) {
    return {
      strategy: "safe-editorial",
      prompt: `${base}. Symbolic factual editorial illustration, respectful and non-graphic, no identifiable public-figure likeness, no injury detail, no weapons in focus, cinematic lighting, clear central subject.`
    };
  }
  if (/\b(stock|market|economy|finance|investment|revenue|earnings|inflation|data|statistics|growth|decline)\b/i.test(context)) {
    return {
      strategy: "data-visualization",
      prompt: `${base}. Premium cinematic 3D data visualization with abstract charts and market motion, factual editorial mood, clean depth, no numbers or readable labels.`
    };
  }
  if (/\b(science|space|climate|weather|energy|medical|health|research|satellite|ocean|environment)\b/i.test(context)) {
    return {
      strategy: "science-documentary",
      prompt: `${base}. High-fidelity science documentary visualization, physically plausible environment, cinematic natural lighting, factual editorial composition.`
    };
  }
  if (/\b(ai|artificial intelligence|technology|software|robot|chip|computer|startup|device|internet|cyber|app)\b/i.test(context)) {
    return {
      strategy: "technology-photo",
      prompt: `${base}. Photorealistic cinematic technology editorial photograph, believable modern environment, diverse people where relevant, crisp lighting, authentic materials.`
    };
  }
  return {
    strategy: "general-editorial",
    prompt: `${base}. High-quality cinematic editorial image, factual visual storytelling, clear subject, strong depth and natural lighting.`
  };
}

function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) image sources are allowed");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) throw new Error("Private network image URLs are not allowed");
  return url;
}

async function downloadSourceImage(sourceUrl: string, outputPath: string): Promise<void> {
  const articleUrl = assertPublicUrl(sourceUrl);
  const articleResponse = await fetch(articleUrl, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; YouTubeNewsRenderer/1.0)", accept: "text/html" } });
  if (!articleResponse.ok) throw new Error(`article returned HTTP ${articleResponse.status}`);
  const finalArticleUrl = assertPublicUrl(articleResponse.url);
  if (finalArticleUrl.hostname.endsWith("news.google.com")) throw new Error("Google News did not resolve to the publisher page");
  const html = (await articleResponse.text()).slice(0, 2_000_000);
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i
  ];
  const match = patterns.map((pattern) => html.match(pattern)).find(Boolean);
  if (!match?.[1]) throw new Error("article has no Open Graph or Twitter image");
  const imageUrl = assertPublicUrl(new URL(htmlEntity(match[1]), finalArticleUrl).toString());
  const imageResponse = await fetch(imageUrl, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; YouTubeNewsRenderer/1.0)", accept: "image/*" } });
  if (!imageResponse.ok) throw new Error(`image returned HTTP ${imageResponse.status}`);
  const size = Number(imageResponse.headers.get("content-length") ?? 0);
  if (size > 15_000_000) throw new Error("source image exceeds 15 MB");
  const data = Buffer.from(await imageResponse.arrayBuffer());
  if (data.length > 15_000_000 || data.length < 1024) throw new Error("source image size is invalid");
  await fs.writeFile(outputPath, data);
}

export async function generateSceneImages(content: VideoContent): Promise<VideoContent> {
  if (config.SCENE_IMAGE_DIR) {
    for (const [index, scene] of content.scenes.entries()) {
      const imagePath = path.join(config.SCENE_IMAGE_DIR, `scene-${index}.png`);
      try {
        await fs.access(imagePath);
        scene.imagePath = imagePath;
      } catch {
        console.warn(`No supplied image found for scene ${index + 1}: ${imagePath}`);
      }
    }
    return content;
  }
  if (!config.GENERATE_IMAGES || config.IMAGE_MODE === "styled") return content;
  const imageDir = path.resolve("work", "generated-images", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(imageDir, { recursive: true });
  const leonardo = ["source", "leonardo"].includes(config.IMAGE_MODE) ? new LeonardoImageService({
    executablePath: config.LEONARDO_CHROME_PATH,
    userDataDir: config.LEONARDO_USER_DATA_DIR,
    profileDirectory: config.LEONARDO_PROFILE_DIRECTORY,
    headless: config.LEONARDO_HEADLESS,
    interactiveAuthentication: config.LEONARDO_INTERACTIVE_AUTH,
    timeoutMs: config.LEONARDO_TIMEOUT_MS,
    authenticationTimeoutMs: config.LEONARDO_AUTH_TIMEOUT_MS,
    generatorUrl: config.LEONARDO_GENERATOR_URL,
    maxAttempts: config.LEONARDO_MAX_ATTEMPTS
  }) : undefined;
  const generateLeonardoScene = async (index: number) => {
    const scene = content.scenes[index];
    const imagePath = path.join(imageDir, `scene-${index}.png`);
    const selected = leonardoPrompt(content, index);
    console.log(`Generating Leonardo image ${index + 1}/${content.scenes.length} [auto model, ${selected.strategy}]: ${scene.heading}`);
    await leonardo!.generate({
      prompt: `${selected.prompt} No text, no logo, no watermark, original composition with safe margins for vertical 9:16 cropping.`,
      destinationPath: imagePath
    });
    scene.imagePath = imagePath;
  };
  try {
  for (const [index, scene] of content.scenes.entries()) {
    if (config.IMAGE_MODE === "source") {
      scene.imagePath = undefined;
      const imagePath = path.join(imageDir, `scene-${index}.source`);
      try {
        if (!scene.sourceUrl) throw new Error("Scene has no publisher source URL");
        console.log(`Fetching source image ${index + 1}/${content.scenes.length}: ${scene.heading}`);
        await downloadSourceImage(scene.sourceUrl, imagePath);
        scene.imagePath = imagePath;
      } catch (error) {
        console.warn(`Source image unavailable for scene ${index + 1}; using Leonardo fallback.`, error);
        await generateLeonardoScene(index);
      }
      continue;
    }
    if (leonardo) {
      await generateLeonardoScene(index);
      continue;
    }
    if (!scene.imagePrompt) continue;
    console.log(`Generating local image ${index + 1}/${content.scenes.length}: ${scene.heading}`);
    const prefix = `youtube-news-${randomUUID()}`;
    let queued: Response;
    try {
      queued = await fetch(`${config.COMFYUI_BASE_URL}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow(`${scene.imagePrompt}. Editorial news illustration, cinematic vertical 9:16 composition`, prefix) }) });
    } catch (error) {
      throw new Error(`Cannot reach ComfyUI at ${config.COMFYUI_BASE_URL}. Start ComfyUI with its API enabled.`, { cause: error });
    }
    if (!queued.ok) throw new Error(`ComfyUI rejected the workflow: ${queued.status} ${await queued.text()}`);
    const { prompt_id } = await queued.json() as { prompt_id: string };
    let info: { filename: string; subfolder?: string; type?: string } | undefined;
    for (let attempt = 0; attempt < 180 && !info; attempt++) {
      await wait(1000);
      const history = await (await fetch(`${config.COMFYUI_BASE_URL}/history/${prompt_id}`)).json() as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
      info = Object.values(history[prompt_id]?.outputs ?? {}).flatMap((output) => output.images ?? [])[0];
    }
    if (!info) throw new Error(`ComfyUI timed out for scene ${index + 1}`);
    const params = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder ?? "", type: info.type ?? "output" });
    const imageResponse = await fetch(`${config.COMFYUI_BASE_URL}/view?${params}`);
    if (!imageResponse.ok) throw new Error(`Could not download ComfyUI output: ${imageResponse.status}`);
    const imagePath = path.join(imageDir, `scene-${index}.png`);
    await fs.writeFile(imagePath, Buffer.from(await imageResponse.arrayBuffer()));
    scene.imagePath = imagePath;
  }
  } catch (error) {
    await fs.rm(imageDir, { recursive: true, force: true });
    throw error;
  } finally {
    await leonardo?.close();
  }
  return content;
}
