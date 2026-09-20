export type VideoProjectStatus =
  | "draft" | "queued" | "generating" | "processing" | "compositing"
  | "completed" | "failed" | "cancelled";

export type VideoProject = {
  id: string;
  title: string;
  description: string | null;
  masterPrompt: string;
  stylePrompt: string;
  provider: string;
  model: string;
  quality: "economy" | "fast" | "cinematic";
  aspectRatio: "16:9" | "9:16";
  targetDurationSeconds: number;
  maintainStyle: boolean;
  maintainCharacter: boolean;
  useFrameContinuity: boolean;
  generateClipAudio: boolean;
  projectMode: "video" | "visualizer";
  visualizerReactivity: number;
  audioAnalysisStatus: "idle" | "queued" | "analyzing" | "completed" | "failed";
  audioAnalysis: AudioAnalysis | null;
  audioAnalysisError: string | null;
  referenceAssets: VideoFrame[];
  audioUrl: string | null;
  status: VideoProjectStatus;
  progress: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VideoFrame = {
  url: string;
  storagePath?: string | null;
  mimeType?: string | null;
};

export type VideoClip = {
  id: string;
  sequenceIndex: number;
  status: string;
  prompt: string;
  provider: string;
  model: string;
  aspectRatio: string;
  quality: string;
  durationSeconds: number;
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;
  outputUrl: string | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  attemptCount: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type AudioAnalysis = {
  version?: number;
  durationSeconds?: number;
  bpm?: number;
  confidence?: number;
  beatPhaseSeconds?: number;
  beats?: number[];
  downbeats?: number[];
  waveform?: number[];
  sections?: Array<{
    start: number;
    end: number;
    energy: number;
    label: "low" | "medium" | "high";
  }>;
  events?: Array<{
    time: number;
    type: "beat" | "downbeat" | "drop" | "break";
    strength: number;
  }>;
};
