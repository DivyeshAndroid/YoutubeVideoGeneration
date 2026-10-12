import { getContent } from "./content.js";
import { renderVideo } from "./render.js";
import { uploadVideo } from "./youtube.js";
import { generateSceneImages } from "./images.js";
import { generateNarration } from "./narration.js";
import { appendSubscribeEnding } from "./outro.js";
import { cleanupPipelineRun } from "./cleanup.js";
import type { VideoContent } from "./types.js";

export async function runPipeline(upload = true) {
  let content: VideoContent | undefined;
  try {
    content = await getContent();
    content = await generateSceneImages(content);
    content = appendSubscribeEnding(content);
    content = await generateNarration(content);
    const videoPath = await renderVideo(content);
    console.log(`Video created: ${videoPath}`);
    const videoId = upload ? await uploadVideo(videoPath, content) : "not-requested";
    console.log(`YouTube result: ${videoId}`);
    return { videoPath, videoId };
  } finally {
    await cleanupPipelineRun(content).catch((error) => {
      console.warn("Pipeline cleanup encountered a non-fatal error.", error);
    });
  }
}
