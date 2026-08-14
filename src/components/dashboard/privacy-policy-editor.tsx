"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { updateProjectPrivacyPolicy } from "@/app/(app)/actions";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { StorePlatform } from "@/types";

/**
 * URL de la privacy policy du projet (obligatoire pour publier): ajoutée en
 * bas de la description de chaque langue à la publication, + EULA Apple sur iOS.
 */
export function PrivacyPolicyEditor({
  projectId,
  store,
  initial,
}: {
  projectId: string;
  store: StorePlatform;
  initial: string;
}) {
  const router = useRouter();
  // pageBusy = génération/publication en cours (verrou global). Le save de
  // l'URL ne lève pas ce verrou: il ne fige que ce bloc via `saving`.
  const { busy: pageBusy } = useProjectBusy();
  const [url, setUrl] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const blocked = saving || pageBusy;
  const dirty = url.trim() !== initial;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await updateProjectPrivacyPolicy({ projectId, url: url.trim() });
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("Privacy policy saved.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="privacy-policy-url">Privacy policy link (required)</Label>
      <Input
        id="privacy-policy-url"
        type="url"
        value={url}
        disabled={blocked}
        onChange={(e) => {
          setUrl(e.target.value);
          setMessage(null);
        }}
        placeholder="https://your-site.com/privacy"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSave}
        disabled={blocked || !dirty}
        className="self-start"
      >
        {saving ? (
          <>
            <Spinner /> Saving…
          </>
        ) : (
          "Save"
        )}
      </Button>
      <p className="max-w-prose text-xs text-muted-foreground">
        This link will be added to the end of the description in all languages
        when publishing.
        {store === "appstore"
          ? " On iOS, Apple's standard EULA line is added as well."
          : ""}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-tertiary">
          {message}
        </p>
      ) : null}
    </div>
  );
}
