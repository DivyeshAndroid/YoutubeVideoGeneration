import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { z } from "zod";
import { config } from "./config.js";
import type { Scene, VideoContent } from "./types.js";
import { fetchLatestNews } from "./news.js";

const outputJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "description", "tags", "hashtags", "scenes", "sources"],
  properties: {
    title: { type: "string" }, description: { type: "string" },
    tags: { type: "array", items: { type: "string" } }, hashtags: { type: "array", items: { type: "string" } },
    scenes: { type: "array", minItems: 5, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["heading", "body", "durationSeconds", "imagePrompt", "sourceUrl"], properties: {
      heading: { type: "string" }, body: { type: "string" }, durationSeconds: { type: "number" }, imagePrompt: { type: "string" }, sourceUrl: { type: "string" }
    } } },
    sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } }
  }
} as const;

const schema = z.object({
  title: z.string().min(1), description: z.string().min(1), tags: z.array(z.string()).default([]), hashtags: z.array(z.string()).optional(),
  sources: z.array(z.object({ title: z.string().min(1), url: z.string().url() })).optional(),
  scenes: z.array(z.object({ heading: z.string().min(1), body: z.string().min(1), durationSeconds: z.number().min(3).max(30), imagePrompt: z.string().optional(), sourceUrl: z.string().url().optional() })).min(1)
});

async function runCodex(prompt: string, responseSchema: object = outputJsonSchema): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-codex-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "answer.json");
  await fs.writeFile(schemaPath, JSON.stringify(responseSchema));
  const args = ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--output-schema", schemaPath, "--output-last-message", outputPath, "-c", `model_reasoning_effort=\"${config.CODEX_REASONING_EFFORT}\"`];
  if (config.CODEX_MODEL) args.push("--model", config.CODEX_MODEL);
  args.push("-");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.CODEX_COMMAND, args, { cwd: process.cwd(), stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", (error) => reject(new Error(`Cannot run Codex CLI command '${config.CODEX_COMMAND}'.`, { cause: error })));
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Codex CLI exited with code ${code}. Run 'codex login' and try again.`)));
    child.stdin.end(prompt);
  });
  return fs.readFile(outputPath, "utf8");
}

async function runOllama(prompt: string, responseSchema: object = outputJsonSchema): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      model: config.OLLAMA_MODEL, stream: false, format: responseSchema, options: { temperature: 0.2, num_ctx: 16384 },
      messages: [{ role: "system", content: "You are a careful news editor. Output only schema-valid JSON. Never invent facts or URLs." }, { role: "user", content: prompt }]
    }) });
  } catch (error) {
    throw new Error(`Cannot reach Ollama at ${config.OLLAMA_BASE_URL}.`, { cause: error });
  }
  if (!response.ok) throw new Error(`Ollama failed: ${response.status} ${await response.text()}`);
  const result = await response.json() as { message?: { content?: string } };
  if (!result.message?.content) throw new Error("Ollama returned no script content.");
  return result.message.content;
}

export async function getContent(): Promise<VideoContent> {
  if (config.CONTENT_MODE === "local") return schema.parse(JSON.parse(await fs.readFile(config.CONTENT_FILE, "utf8")));
  const headlines = await fetchLatestNews();
  const prompt = `Using only the supplied news coverage, create one factual vertical YouTube Short covering exactly five distinct hot-news developments about ${config.NEWS_TOPIC}, focused on ${config.NEWS_REGION}. The coverage is ordered by freshness, relevance, and independent publisher corroboration. Select the five strongest distinct stories and preserve that hottest-first order: scene 1 is the hottest, then scenes 2 through 5. Never use multiple scenes for the same event. Write a concise roundup title such as "Top 5 AI & Tech News Today" while making it specific to the actual coverage; make it compelling but never use unsupported "breaking" language, exaggeration, or clickbait. The complete narration must fit within ${config.VIDEO_DURATION_SECONDS} seconds and use 125-145 words across exactly five scenes. Give each story a short factual hook, attribute its claim, and do not merge unrelated facts within a scene. Prefer claims corroborated by different publishers. Treat Hacker News as a discovery signal, not independent factual confirmation. Create ${config.HASHTAG_COUNT} relevant hashtags including #Shorts. Every scene must have a unique cinematic vertical image prompt depicting that scene's specific story, with no text, logos, trademark imitation, or misleading imagery, plus a sourceUrl copied exactly from the supplied coverage supporting that scene. Include the five selected sources in the sources array and use only URLs present below.\n\nNEWS COVERAGE (HOTTEST FIRST):\n${JSON.stringify(headlines, null, 2)}`;
  const result = config.AI_PROVIDER === "codex" ? await runCodex(prompt) : await runOllama(prompt);
  const content = schema.parse(JSON.parse(result));
  if (content.scenes.length !== 5) throw new Error(`Trending news generation must return exactly 5 scenes; received ${content.scenes.length}`);
  return content;
}

const shortenedSceneSchema = {
  type: "object",
  additionalProperties: false,
  required: ["heading", "body"],
  properties: {
    heading: { type: "string" },
    body: { type: "string" }
  }
} as const;

const shortenedSceneValidator = z.object({
  heading: z.string().min(1),
  body: z.string().min(1)
});

export async function rephraseSceneForDuration(scene: Scene, targetSeconds: number): Promise<Pick<Scene, "heading" | "body">> {
  const currentText = `${scene.heading}. ${scene.body}`;
  const currentWords = currentText.trim().split(/\s+/).length;
  const wordBudget = Math.max(8, Math.floor(targetSeconds * 2.15));
  const prompt = `Rephrase this narration to fit within ${targetSeconds.toFixed(1)} seconds at normal 1x speech speed. Use no more than ${wordBudget} words total across heading and body. Preserve every important fact and the original meaning. Do not add facts, commentary, labels, or timing notes. Make it natural spoken English and concise. The current narration has ${currentWords} words.\n\n${JSON.stringify({ heading: scene.heading, body: scene.body })}`;
  const result = config.AI_PROVIDER === "codex"
    ? await runCodex(prompt, shortenedSceneSchema)
    : await runOllama(prompt, shortenedSceneSchema);
  return shortenedSceneValidator.parse(JSON.parse(result));
}
