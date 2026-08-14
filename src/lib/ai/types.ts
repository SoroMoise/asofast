import type { AppMetadata } from "@/lib/scrapers";
import type { StorePlatform } from "@/types";

/** ASO copy generated for a single locale. */
export type CopyOutput = {
  title: string;
  subtitle: string;
  promotionalText: string;
  description: string;
  keywords: string[];
};

/** A localized/translated listing for a target locale. */
export type TranslationOutput = {
  locale: string;
  title: string;
  subtitle: string;
  description: string;
  keywords: string[];
};

/** Shape stored in generations.input. */
export type GenerationInput = {
  targetLocale?: string | null;
  notes?: string | null;
  metadata?: Partial<AppMetadata> | null;
};

// --- Screenshots -----------------------------------------------------------

export type CompetitorRef = {
  store: StorePlatform;
  identifier: string;
};

/**
 * Visual style extracted from competitor store screenshots (via vision) and
 * applied to the user's own screenshots. fontFamily is fixed to the curated set.
 */
export type ScreenshotStyle = {
  backgroundColor: string;
  backgroundGradientTo: string | null;
  textColor: string;
  accentColor: string;
  fontFamily: "Poppins";
  fontWeight: "regular" | "semibold" | "bold";
  captionCase: "none" | "upper" | "title";
  captionPlacement: "top" | "bottom";
  deviceFrame: boolean;
};

/** Shape stored in generations.input for a screenshot job. */
export type ScreenshotGenInput = {
  competitors: CompetitorRef[];
  uploadedPaths: string[];
  targetLocale?: string | null;
};

export type ScreenshotFrame = {
  url: string;
  caption: string;
  size: string;
  sourcePath: string;
};

/** Shape stored in generations.output for a screenshot job. */
export type ScreenshotOutput = {
  frames: ScreenshotFrame[];
  style: ScreenshotStyle;
  captions: string[];
};
