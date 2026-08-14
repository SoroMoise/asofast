"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { createAsoProject } from "@/app/(app)/actions";
import {
  AppChip,
  AppSearchInput,
  type AppRef,
} from "@/components/dashboard/app-search-input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { STORE_LABELS } from "@/lib/constants";
import type { StorePlatform } from "@/types";

/**
 * Création de projet en 2 étapes: plateforme + app. L'app peut être déjà publiée
 * (recherche publique du store) ou pas encore (saisie manuelle de l'identifiant
 * que l'API du store attend: App Store ID / bundle ID, ou package name). Tout le
 * reste (compétiteurs, screenshots, langues, génération) se fait sur la page projet.
 */
export function ProjectWizard() {
  const router = useRouter();

  const [store, setStore] = React.useState<StorePlatform>("appstore");
  const [published, setPublished] = React.useState(true);
  const [app, setApp] = React.useState<AppRef | null>(null);
  // Saisie manuelle (app pas encore publiée): pas de métadonnées à récupérer.
  const [manualName, setManualName] = React.useState("");
  const [manualId, setManualId] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset des saisies quand on change de plateforme ou de mode.
  function resetInputs() {
    setApp(null);
    setManualName("");
    setManualId("");
    setError(null);
  }

  const idLabel = store === "appstore" ? "Bundle ID (or App Store ID)" : "Package name";
  const idPlaceholder = "com.example.app";
  const idHelp =
    store === "appstore"
      ? "The bundle ID you chose in Xcode / App Store Connect (e.g. com.example.app), or the numeric App Store ID (App Store Connect → App Information → Apple ID)."
      : "Your app's package name (Play Console → Dashboard).";

  const manualReady = manualName.trim().length > 0 && manualId.trim().length > 0;
  const canCreate = published ? Boolean(app) : manualReady;

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const payload = published
        ? app && {
            store,
            identifier: app.identifier,
            appName: app.name,
            developerName: app.developer,
            iconUrl: app.icon,
          }
        : {
            store,
            identifier: manualId.trim(),
            appName: manualName.trim(),
            developerName: null,
            iconUrl: null,
          };
      if (!payload) return;

      const created = await createAsoProject(payload);
      if (!created.projectId) {
        throw new Error(created.error ?? "Could not create the project.");
      }
      router.push(`/projects/${created.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed.");
      setCreating(false);
    }
  }

  return (
    <Card id="nouveau-projet" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>New project</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* 1. Plateforme */}
        <div className="flex flex-col gap-2">
          <Label>1. Platform</Label>
          <div className="flex gap-2">
            {(["appstore", "playstore"] as const).map((s) => (
              <Button
                key={s}
                type="button"
                variant={store === s ? "primary" : "outline"}
                size="sm"
                disabled={creating}
                onClick={() => {
                  setStore(s);
                  resetInputs();
                }}
              >
                {s === "appstore" ? "iOS · App Store" : "Android · Google Play"}
              </Button>
            ))}
          </div>
        </div>

        {/* 2. App déjà publiée ? */}
        <div className="flex flex-col gap-2">
          <Label>2. Is your app already published on {STORE_LABELS[store]}?</Label>
          <div className="flex gap-2">
            {[
              { value: true, label: "Yes, it's live" },
              { value: false, label: "Not yet" },
            ].map((opt) => (
              <Button
                key={String(opt.value)}
                type="button"
                variant={published === opt.value ? "primary" : "outline"}
                size="sm"
                disabled={creating}
                onClick={() => {
                  setPublished(opt.value);
                  resetInputs();
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {/* 3. Identification de l'app */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="wizard-app">3. Your app on {STORE_LABELS[store]}</Label>
          {published ? (
            app ? (
              <AppChip app={app} onRemove={() => setApp(null)} removeDisabled={creating} />
            ) : (
              <AppSearchInput
                id="wizard-app"
                store={store}
                disabled={creating}
                onAdd={setApp}
                onError={setError}
                placeholder={`Search your app by name, ${store === "appstore" ? "or paste its App ID" : "or paste its package name"}…`}
              />
            )
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Input
                  id="wizard-app"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  disabled={creating}
                  placeholder="Your app name"
                  aria-label="App name"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-app-id" className="text-xs text-muted-foreground">
                  {idLabel}
                </Label>
                <Input
                  id="wizard-app-id"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  disabled={creating}
                  placeholder={idPlaceholder}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">{idHelp}</p>
              </div>
              <p className="max-w-prose text-xs text-muted-foreground">
                Prerequisite to publish later:{" "}
                {store === "appstore"
                  ? "a version in preparation in App Store Connect."
                  : "a first APK/AAB already uploaded to the Play Console (even in internal testing)."}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button type="button" onClick={handleCreate} disabled={!canCreate || creating}>
            {creating ? (
              <>
                <Spinner /> Creating…
              </>
            ) : (
              "Create project"
            )}
          </Button>
          <p className="max-w-prose text-xs text-muted-foreground">
            Competitors, languages and screenshots are configured next on the
            project page.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
