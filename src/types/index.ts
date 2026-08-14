export type StorePlatform = "appstore" | "playstore";
export type GenerationType = "copy" | "translation" | "screenshot";
export type GenerationStatus = "pending" | "running" | "done" | "error";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type AppRef = {
  store: StorePlatform;
  identifier: string;
  name: string;
  developer: string | null;
  icon: string | null;
};

export type SourceCaption = {
  path: string;
  caption: string;
};

export type ScreenshotFrame = {
  url: string;
  caption: string;
  sourcePath: string;
  size?: string;
};

export type Project = {
  id: string;
  user_id: string;
  name: string;
  store: StorePlatform;
  store_identifier: string;
  source_locale: string;
  app_name: string | null;
  developer_name: string | null;
  icon_url: string | null;
  competitors: AppRef[];
  target_locales: string[];
  features: string[];
  screenshot_style: string | null;
  screenshot_captions: SourceCaption[];
  screenshot_captions_tablet: SourceCaption[];
  privacy_policy_url: string;
  whats_new: string | null;
  competitor_keywords_en: { keyword: string; competitors: number; occurrences: number }[];
  competitor_keywords_key: string | null;
  screenshot_bg_color: string | null;
  screenshot_text_color: string | null;
  created_at: string;
  updated_at: string;
};

export type Listing = {
  id: string;
  project_id: string;
  locale: string;
  title: string;
  subtitle: string;
  short_description: string;
  description: string;
  keywords: string;
  keyword_base: { keyword: string; competitors: number; occurrences: number }[];
  screenshots: ScreenshotFrame[];
  screenshots_tablet: ScreenshotFrame[];
  whats_new: string | null;
  created_at: string;
  updated_at: string;
};

export type Generation = {
  id: string;
  project_id: string;
  type: GenerationType;
  status: GenerationStatus;
  input: Json;
  output: Json | null;
  target_locale: string | null;
  created_at: string;
  updated_at: string;
};

export type CreditLedger = never;

export type ProjectInsert = Omit<
  Project,
  "id" | "created_at" | "updated_at"
>;
export type GenerationInsert = Omit<
  Generation,
  "id" | "status" | "output" | "created_at" | "updated_at"
>;
export type ListingInsert = Omit<
  Listing,
  "id" | "created_at" | "updated_at"
>;
