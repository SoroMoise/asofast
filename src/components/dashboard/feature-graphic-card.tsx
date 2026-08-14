"use client";

import * as React from "react";

import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconUpload, IconX } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { compressImage, formatBytes } from "@/lib/images/compress";

const WIDTH = 1024;
const HEIGHT = 500;

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

export function FeatureGraphicCard({
  projectId,
}: {
  projectId: string;
  userId: string;
}) {
  const prefix = `${projectId}/feature-graphic`;
  const { busy: pageBusy } = useProjectBusy();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [current, setCurrent] = React.useState<{ path: string; url: string } | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savings, setSavings] = React.useState<{ before: number; after: number } | null>(null);
  const blocked = busy || pageBusy;

  const refresh = React.useCallback(async () => {
    const files = await listFiles(prefix);
    const file = files.find((f) => f.name.startsWith("current."));
    if (!file) {
      setCurrent(null);
      setLoaded(true);
      return;
    }
    setCurrent({ path: file.path, url: `/api/files/${file.path}` });
    setLoaded(true);
  }, [prefix]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSavings(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await run(async () => {
      const out = await compressImage(file, {
        fit: { width: WIDTH, height: HEIGHT },
        allowAlpha: false,
        background: "#ffffff",
      });
      const files = await listFiles(prefix);
      for (const f of files.filter((f) => f.name.startsWith("current."))) {
        await deleteFile(f.path);
      }
      await uploadFile(`${prefix}/current.${out.ext}`, out.blob);
      setSavings(
        out.compressed && out.finalBytes < out.originalBytes
          ? { before: out.originalBytes, after: out.finalBytes }
          : null
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature graphic</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Label htmlFor="feature-graphic-file" className="flex items-center gap-2">
          Google Play banner (1024×500, required)
          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
        </Label>

        {!loaded ? (
          <div
            className="aspect-[1024/500] w-full max-w-md animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : current ? (
          <div className="relative w-fit">
            <img
              src={current.url}
              alt="Feature graphic"
              className="w-full max-w-md rounded-lg border"
            />
            <button
              type="button"
              onClick={() =>
                run(async () => {
                  if (current) await deleteFile(current.path);
                })
              }
              disabled={blocked}
              aria-label="Delete feature graphic"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <p className="max-w-prose text-sm text-muted-foreground">
            No feature graphic imported: publishing keeps the one already on your Google Play
            listing. Upload one to replace it (required if your listing has none).
          </p>
        )}

        <div>
          <input
            ref={fileInputRef}
            id="feature-graphic-file"
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleImport}
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
            <IconUpload className="h-3.5 w-3.5" />{" "}
            {current ? "Replace banner" : "Upload banner"}
          </Button>
        </div>

        <p className="max-w-prose text-xs text-muted-foreground">
          Resized to 1024×500 without cropping if needed. This feature graphic
          will be used across all languages when publishing.
        </p>
        {savings ? (
          <p className="text-xs text-muted-foreground">
            Compressed: {formatBytes(savings.before)} → {formatBytes(savings.after)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
