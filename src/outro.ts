import type { Scene, VideoContent } from "./types.js";

export const OUTRO_SECONDS = 5;
export const SCENE_TAIL_SECONDS = 0.25;

export function appendSubscribeEnding(content: VideoContent): VideoContent {
  const stories = content.scenes.filter((scene) => scene.kind !== "subscribe");
  const imagePath = [...stories].reverse().find((scene) => scene.imagePath)?.imagePath;
  return {
    ...content,
    scenes: [...stories, {
      kind: "subscribe",
      heading: "SUBSCRIBE",
      body: "Subscribe for more videos. See you in the next Short!",
      durationSeconds: OUTRO_SECONDS,
      imagePath
    }]
  };
}

export function narrationText(scene: Scene): string {
  return scene.kind === "subscribe" ? scene.body : `${scene.heading}. ${scene.body}`;
}
