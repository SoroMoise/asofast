"use client";

import Image, { type StaticImageData } from "next/image";
import * as React from "react";

import {
  reorderScreenshots,
  updateProjectScreenshotColors,
} from "@/app/(app)/actions";
import goodAndroid from "@/app/examples/good_android.png";
import goodIos from "@/app/examples/good_ios.png";
import wrongAndroid from "@/app/examples/wrong_android.jpg";
import wrongIos from "@/app/examples/wrong_ios.jpg";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { SortableItem, SortableList } from "@/components/dashboard/sortable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  IconCheck,
  IconChevronDown,
  IconGrip,
  IconImage,
  IconUpload,
  IconX,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { HEX } from "@/lib/ai/generation/screenshot/color-overrides";
import { compressImage, formatBytes, SCREENSHOT_MAX_EDGE } from "@/lib/images/compress";
import { cn } from "@/lib/utils";
import type { StorePlatform } from "@/types";

type Device = "phone" | "tablet";

const MAX_SHOTS = 10;

type Upload = { path: string; name: string; url: string };
type StorageFile = { name: string; path: string };

async function listFiles(prefix: string): Promise<StorageFile[]> {
  const res = await fetch(`/api/files/${prefix}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { files?: StorageFile[] };
  return data.files ?? [];
}

async function uploadFile(path: string, blob: Blob): Promise<void> {
  const res = await fetch(`/api/files/${path}`, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": blob.type || "application/octet-stream" },
  });
  if (!res.ok) throw new Error("Upload failed.");
}

async function deleteFile(path: string): Promise<void> {
  const res = await fetch(`/api/files/${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed.");
}

function UploadBlock({
  inputId,
  label,
  prefix,
  emptyHint,
  projectId,
  device,
  order,
  onCount,
}: {
  inputId: string;
  label: string;
  prefix: string;
  emptyHint: string;
  projectId: string;
  device: Device;
  order: string[];
  onCount?: (count: number) => void;
}) {
  const orderRef = React.useRef<string[]>(order);
  const { busy: pageBusy } = useProjectBusy();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "compressing" | "uploading">("idle");
  const [savings, setSavings] = React.useState<
    { before: number; after: number; count: number } | null
  >(null);
  const blocked = busy || pageBusy;

  const applyOrder = React.useCallback((list: Upload[]): Upload[] => {
    const rank = new Map(orderRef.current.map((p, i) => [p, i]));
    const sorted = [...list].sort((a, b) => {
      const ra = rank.get(a.path);
      const rb = rank.get(b.path);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.name.localeCompare(b.name);
    });
    orderRef.current = sorted.map((u) => u.path);
    return sorted;
  }, []);

  const refreshUploads = React.useCallback(async () => {
    const files = await listFiles(prefix);
    const sliced = files.slice(0, MAX_SHOTS);
    setUploads(
      applyOrder(
        sliced.map((f) => ({
          path: f.path,
          name: f.name,
          url: `/api/files/${f.path}`,
        }))
      )
    );
    setLoaded(true);
  }, [prefix, applyOrder]);

  async function handleReorder(newIds: string[]) {
    const prev = uploads;
    const map = new Map(uploads.map((u) => [u.path, u]));
    const reordered = newIds
      .map((id) => map.get(id))
      .filter((u): u is Upload => Boolean(u));
    orderRef.current = newIds;
    setUploads(reordered);
    setBusy(true);
    setError(null);
    try {
      const res = await reorderScreenshots({ projectId, device, order: newIds });
      if (res.error) {
        orderRef.current = prev.map((u) => u.path);
        setUploads(prev);
        setError(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    void refreshUploads();
  }, [refreshUploads]);

  const onCountRef = React.useRef(onCount);
  onCountRef.current = onCount;
  React.useEffect(() => {
    if (loaded) onCountRef.current?.(uploads.length);
  }, [loaded, uploads.length]);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setSavings(null);
    try {
      const room = Math.max(0, MAX_SHOTS - uploads.length);
      const picked = files.slice(0, room);

      setPhase("compressing");
      const compressed = await Promise.all(
        picked.map((file) => compressImage(file, { maxEdge: SCREENSHOT_MAX_EDGE }))
      );
      const before = picked.reduce((sum, f) => sum + f.size, 0);
      const after = compressed.reduce((sum, out) => sum + out.finalBytes, 0);

      const stamp = Date.now();
      setPhase("uploading");
      await Promise.all(
        compressed.map((out, i) => {
          const base = picked[i].name.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_");
          return uploadFile(`${prefix}/${stamp}-${i}-${base}.${out.ext}`, out.blob);
        })
      );
      if (after < before) setSavings({ before, after, count: picked.length });
      await refreshUploads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPhase("idle");
      setBusy(false);
    }
  }

  async function handleDeleteUpload(path: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteFile(path);
      await refreshUploads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId} className="flex items-center gap-2">
        {label} ({uploads.length}/{MAX_SHOTS})
        {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
      </Label>
      {uploads.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          Drag the handle to reorder (applied to generation and publishing).
        </p>
      ) : null}
      {!loaded ? (
        <div className="flex gap-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 w-16 shrink-0 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : uploads.length > 0 ? (
        <SortableList
          ids={uploads.map((u) => u.path)}
          onReorder={handleReorder}
          strategy="horizontal"
          disabled={blocked}
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {uploads.map((u) => (
            <SortableItem
              key={u.path}
              id={u.path}
              disabled={blocked}
              className="relative shrink-0"
            >
              {({ attributes, listeners, isDragging }) => (
                <>
                  <img
                    src={u.url}
                    alt={u.name}
                    draggable={false}
                    className="h-32 w-auto rounded-md border"
                  />
                  <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    aria-label={`Move ${u.name}`}
                    className={cn(
                      "absolute bottom-1 left-1 flex h-6 w-6 touch-none items-center justify-center rounded-full bg-background/90 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isDragging ? "cursor-grabbing" : "cursor-grab"
                    )}
                  >
                    <IconGrip className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteUpload(u.path)}
                    disabled={blocked}
                    aria-label={`Delete ${u.name}`}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </SortableItem>
          ))}
        </SortableList>
      ) : (
        <p className="max-w-prose text-sm text-muted-foreground">{emptyHint}</p>
      )}
      {uploads.length < MAX_SHOTS ? (
        <div>
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={handleFiles}
            disabled={blocked}
            className="sr-only"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked || !loaded}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconUpload className="h-3.5 w-3.5" /> Upload captures
          </Button>
        </div>
      ) : null}
      {phase === "compressing" ? (
        <p className="text-xs text-muted-foreground">Compressing…</p>
      ) : savings ? (
        <p className="text-xs text-muted-foreground">
          Compressed {savings.count} image{savings.count > 1 ? "s" : ""}:{" "}
          {formatBytes(savings.before)} → {formatBytes(savings.after)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const DEFAULT_SWATCH = { bg: "#4f46e5", text: "#ffffff" };

function ColorField({
  id,
  label,
  value,
  fallback,
  disabled,
  onChange,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  fallback: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} — color picker`}
          value={HEX.test(value) ? value : fallback}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 disabled:opacity-50"
        />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder="#4f46e5 (auto if empty)"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          className="max-w-[12rem] font-mono"
        />
      </div>
    </div>
  );
}

function ScreenshotColors({
  projectId,
  initialBg,
  initialText,
}: {
  projectId: string;
  initialBg: string;
  initialText: string;
}) {
  const { busy: pageBusy } = useProjectBusy();
  const [bg, setBg] = React.useState(initialBg);
  const [text, setText] = React.useState(initialText);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const saved = React.useRef({ bg: initialBg, text: initialText });

  const commit = React.useCallback(async () => {
    const nextBg = bg.trim();
    const nextText = text.trim();
    if (nextBg === saved.current.bg && nextText === saved.current.text) return;
    setStatus("saving");
    setError(null);
    const res = await updateProjectScreenshotColors({
      projectId,
      bgColor: nextBg,
      textColor: nextText,
    });
    if (res.error) {
      setStatus("error");
      setError(res.error);
      return;
    }
    saved.current = { bg: nextBg, text: nextText };
    setStatus("saved");
  }, [bg, text, projectId]);

  const disabled = pageBusy || status === "saving";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Screenshot colors</p>
        <p className="max-w-prose text-xs text-muted-foreground">
          Choose a background and headline color, or leave empty to match your
          competitors automatically. A background color renders as a solid fill.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <ColorField
          id="screenshot-bg-color"
          label="Background color"
          value={bg}
          fallback={DEFAULT_SWATCH.bg}
          disabled={disabled}
          onChange={setBg}
          onCommit={commit}
        />
        <ColorField
          id="screenshot-text-color"
          label="Headline text color"
          value={text}
          fallback={DEFAULT_SWATCH.text}
          disabled={disabled}
          onChange={setText}
          onCommit={commit}
        />
      </div>
      {status === "saving" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Spinner className="h-3.5 w-3.5" /> Saving…
        </p>
      ) : status === "saved" ? (
        <p className="flex items-center gap-1 text-xs text-tertiary" role="status">
          <IconCheck className="h-3.5 w-3.5" /> Saved
        </p>
      ) : status === "error" && error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type ExampleTone = "good" | "bad";

function ExamplePanel({
  tone,
  image,
  alt,
  title,
  items,
}: {
  tone: ExampleTone;
  image: StaticImageData;
  alt: string;
  title: string;
  items: string[];
}) {
  const good = tone === "good";
  const Icon = good ? IconCheck : IconX;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-background p-3",
        good ? "border-success/40" : "border-destructive/40"
      )}
    >
      <span
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          good ? "text-success" : "text-destructive"
        )}
      >
        {title}
      </span>
      <Image
        src={image}
        alt={alt}
        sizes="200px"
        className="h-40 w-auto self-start rounded-md border object-contain"
      />
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm">
            <Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                good ? "text-success" : "text-destructive"
              )}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScreenshotExample({
  store,
  defaultOpen,
}: {
  store: StorePlatform;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const isIos = store === "appstore";
  const platform = isIos ? "iOS" : "Android";
  const dims = isIos ? '1290×2796 (6.9")' : "1080×1920 (9:16)";
  const panelId = "screenshot-example-panel";

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          <IconImage className="h-4 w-4 text-muted-foreground" />
          What makes a good screenshot
        </span>
        <IconChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          className="flex flex-col items-start gap-3 px-3 pb-3 sm:flex-row"
        >
          <ExamplePanel
            tone="bad"
            image={isIos ? wrongIos : wrongAndroid}
            alt={`${platform} screenshot to avoid, with a headline baked into the image`}
            title="Avoid"
            items={[
              "Headline baked in",
              "Non-transparent background",
              "Wrong dimensions",
            ]}
          />
          <ExamplePanel
            tone="good"
            image={isIos ? goodIos : goodAndroid}
            alt={`Recommended ${platform} screenshot, a clean capture with no headline`}
            title="Upload this"
            items={[
              "No headline",
              "Transparent PNG background",
              `Optimal dimensions: ${dims}`,
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ScreenshotGenerator({
  projectId,
  store,
  order = [],
  orderTablet = [],
  bgColor = "",
  textColor = "",
  hasSourceScreenshots = false,
}: {
  projectId: string;
  userId: string;
  store: StorePlatform;
  order?: string[];
  orderTablet?: string[];
  bgColor?: string;
  textColor?: string;
  hasSourceScreenshots?: boolean;
}) {
  const prefix = projectId;
  const tabletLabel = store === "appstore" ? "iPad screenshots" : "Tablet screenshots";
  const { setSourceShotCount } = useProjectBusy();
  React.useEffect(() => () => setSourceShotCount(null), [setSourceShotCount]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marketing screenshots</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="max-w-prose text-sm text-muted-foreground">
          For best results, upload PNG screenshots with a transparent
          background.
        </p>

        <ScreenshotExample store={store} defaultOpen={!hasSourceScreenshots} />

        <UploadBlock
          inputId="project-screenshots"
          label="Your screenshots"
          prefix={prefix}
          projectId={projectId}
          device="phone"
          order={order}
          onCount={setSourceShotCount}
          emptyHint="No screenshots: upload your app's raw captures."
        />

        <UploadBlock
          inputId="project-screenshots-tablet"
          label={tabletLabel}
          prefix={`${prefix}/tablet`}
          projectId={projectId}
          device="tablet"
          order={orderTablet}
          emptyHint={
            store === "appstore"
              ? "Optional: upload your app's raw iPad captures (published to the iPad 12.9″/13″ set)."
              : "Optional: upload your app's raw tablet captures (published to the 7″ and 10″ screenshots)."
          }
        />

        <ScreenshotColors
          projectId={projectId}
          initialBg={bgColor}
          initialText={textColor}
        />

        <p className="max-w-prose text-sm text-muted-foreground">
          AI analyzes each capture to write a benefit line at the top of the
          image, translated into each target language. Generate via the{" "}
          <a href="#generer" className="underline underline-offset-2 hover:text-foreground">
            “Generate listings”
          </a>{" "}
          button below.
        </p>
      </CardContent>
    </Card>
  );
}
