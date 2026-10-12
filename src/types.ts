export type Scene = {
  kind?: "subscribe";
  heading: string;
  body: string;
  durationSeconds: number;
  imagePrompt?: string;
  sourceUrl?: string;
  imagePath?: string;
  audioPath?: string;
  audioDurationSeconds?: number;
};

export type NewsSource = { title: string; url: string };

export type VideoContent = {
  title: string;
  description: string;
  tags: string[];
  hashtags?: string[];
  scenes: Scene[];
  sources?: NewsSource[];
};
