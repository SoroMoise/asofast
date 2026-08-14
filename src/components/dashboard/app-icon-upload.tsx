"use client";

import * as React from "react";

import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconUpload, IconX } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { compressImage, formatBytes } from "@/lib/images/compress";

const ICON_SIZE = 512;

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
  if (!res.ok) throw new Error("Icon upload failed.");
}

async function deleteFile(path: string): Promise<void> {
  const res = await fetch(`/api/files/${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed.");
}

export function AppIconUpload({
  projectId,
}: {
  projectId: string;
  userId: string;
}) {
  const prefix = `${projectId}/icon`;
  const { busy: pageBusy } = useProjectBusy();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [icon, setIcon] = React.useState<{ path: string; url: string } | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savings, setSavings] = React.useState<{ before: number; after: number } | null>(null);
  const blocked = busy || pageBusy;

  const refresh = React.useCallback(async () => {
    const files = await listFiles(prefix);
    const file = files[0];
    if (!file) {
      setIcon(null);
      setLoaded(true);
      return;
    }
    setIcon({ path: file.path, url: `/api/files/${file.path}` });
    setLoaded(true);
  }, [prefix]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const out = await compressImage(file, {
        fit: { width: ICON_SIZE, height: ICON_SIZE },
        forceFormat: file.type === "image/png" ? "png" : "jpg",
      });
      const files = await listFiles(prefix);
      for (const f of files) await deleteFile(f.path);

      await uploadFile(`${prefix}/icon.${out.ext}`, out.blob);
      setSavings(
        out.compressed && out.finalBytes < out.originalBytes
          ? { before: out.originalBytes, after: out.finalBytes }
          : null
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Icon upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!icon) return;
    setBusy(true);
    setError(null);
    setSavings(null);
    try {
      await deleteFile(icon.path);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App icon</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Label htmlFor="app-icon" className="flex items-center gap-2">
          Play Store icon (512×512)
          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
        </Label>

        {!loaded ? (
          <div
            className="h-24 w-24 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : icon ? (
          <div className="relative w-fit">
            <img
              src={icon.url}
              alt="App icon"
              className="h-24 w-24 rounded-2xl border"
            />
            <button
              type="button"
              onClick={handleDelete}
              disabled={blocked}
              aria-label="Delete icon"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <p className="max-w-prose text-sm text-muted-foreground">
            No icon: upload your app icon.
          </p>
        )}

        <div>
          <input
            ref={fileInputRef}
            id="app-icon"
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleFile}
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
            {icon ? "Replace icon" : "Upload icon"}
          </Button>
        </div>
        <p className="max-w-prose text-xs text-muted-foreground">
          Automatically resized to 512×512 without cropping (aspect ratio
          preserved). PNG keeps its transparency. Published to Google Play with
          the big button at the bottom of the page.
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
