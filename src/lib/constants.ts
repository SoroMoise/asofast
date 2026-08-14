import type {
  GenerationStatus,
  GenerationType,
  StorePlatform,
} from "@/types";

/** Enum values mirrored from db/migrations (keep in sync with the SQL enums). */
export const STORE_PLATFORMS: readonly StorePlatform[] = ["appstore", "playstore"];
export const GENERATION_TYPES: readonly GenerationType[] = ["copy", "translation", "screenshot"];
export const GENERATION_STATUSES: readonly GenerationStatus[] = ["pending", "running", "done", "error"];

export const STORE_LABELS: Record<StorePlatform, string> = {
  appstore: "App Store",
  playstore: "Google Play",
};

export const STORE_IDENTIFIER_LABELS: Record<StorePlatform, string> = {
  appstore: "App ID",
  playstore: "Package name",
};

export const GENERATION_TYPE_LABELS: Record<GenerationType, string> = {
  copy: "ASO copy",
  translation: "Translation",
  screenshot: "Screenshot",
};

export const GENERATION_STATUS_LABELS: Record<GenerationStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  error: "Error",
};

/** Fonctionnalités clés d'un projet (éditeur page projet + validation serveur). */
export const MAX_FEATURES = 8;
export const MAX_FEATURE_LENGTH = 100;
