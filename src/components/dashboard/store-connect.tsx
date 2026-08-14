"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { IconCheck } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormState = { error?: string; message?: string };

const TUTORIAL_VIDEO: Record<"appstore" | "playstore", string> = {
  appstore: "https://www.youtube.com/watch?v=o1kJXQYlHjM",
  playstore: "https://www.youtube.com/watch?v=FU47nOrPTDc",
};

function IconPlay({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.14-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function ConnectTutorial({ store }: { store: "appstore" | "playstore" }) {
  return (
    <details className="group rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none font-medium text-foreground">
        How do I get these credentials?
      </summary>
      <p className="mt-2">
        <a
          href={TUTORIAL_VIDEO[store]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
        >
          <IconPlay className="h-3 w-3" />
          Watch the video walkthrough
        </a>
      </p>
      {store === "appstore" ? (
        <ol className="mt-2 list-decimal space-y-1.5 pl-4">
          <li>
            Open{" "}
            <a
              href="https://appstoreconnect.apple.com/access/integrations/api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              App Store Connect &gt; Users and Access &gt; Integrations
            </a>{" "}
            (App Store Connect API tab, Team Keys section).
          </li>
          <li>
            Click the + button to generate a key, give it a name and choose the{" "}
            <span className="font-medium text-foreground">App Manager</span> role.
          </li>
          <li>
            Download the <span className="font-mono">.p8</span> file (possible only once,
            keep it somewhere safe).
          </li>
          <li>
            Copy the <span className="font-medium text-foreground">Key ID</span> (next to your key)
            and the <span className="font-medium text-foreground">Issuer ID</span> (at the top of the
            page), then upload the <span className="font-mono">.p8</span> file with the button
            below.
          </li>
        </ol>
      ) : (
        <ol className="mt-2 list-decimal space-y-1.5 pl-4">
          <li>
            Open the{" "}
            <a
              href="https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Google Cloud Console
            </a>{" "}
            and enable the <span className="font-medium text-foreground">Google Play Android Developer</span> API on your project.
          </li>
          <li>
            Go to IAM &amp; Admin &gt; Service Accounts, create a service account, then
            generate a key in <span className="font-mono">JSON</span> format (Keys tab &gt;
            Add key).
          </li>
          <li>
            In the{" "}
            <a
              href="https://play.google.com/console"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Play Console
            </a>
            , open Users and permissions, invite the service account email and
            give it access to your app with permission to manage the Play Store listing.
          </li>
          <li>Select the downloaded JSON file with the button below.</li>
        </ol>
      )}
    </details>
  );
}

export function StoreConnect({
  projectId,
  store,
  connected,
  connectAction,
  disconnectAction,
}: {
  projectId: string;
  store: "appstore" | "playstore";
  connected: boolean;
  connectAction: (prevState: FormState, formData: FormData) => Promise<FormState>;
  disconnectAction: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(connectAction, {});
  const storeLabel = store === "appstore" ? "App Store Connect" : "Google Play";
  // La clé App Store Connect est émise par compte développeur Apple, pas par
  // app: une seule connexion sert tous les projets iOS de l'utilisateur.
  const accountScoped = store === "appstore";

  // Connecté: formulaire replié derrière « Mettre à jour les identifiants »
  // (un formulaire vide au submit toujours désactivé se lit comme cassé).
  const [editing, setEditing] = useState(false);
  const showForm = !connected || editing;
  useEffect(() => {
    if (state.message) setEditing(false);
  }, [state.message]);

  // Import du fichier de clé de compte de service (Play Store).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saFile, setSaFile] = useState<{ name: string; email: string | null; json: string } | null>(
    null
  );
  const [saError, setSaError] = useState<string | null>(null);

  // Import du fichier de clé .p8 (App Store): remplit la clé privée (le collage
  // manuel dans le champ reste possible).
  const p8InputRef = useRef<HTMLInputElement>(null);
  const [privateKey, setPrivateKey] = useState("");
  const [p8Name, setP8Name] = useState<string | null>(null);
  const [p8Error, setP8Error] = useState<string | null>(null);

  async function handleP8File(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset pour permettre de resélectionner le même fichier.
    e.target.value = "";
    if (!file) return;
    setP8Error(null);
    try {
      const text = (await file.text()).trim();
      if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
        throw new Error("This file doesn't look like a .p8 key (PRIVATE KEY block missing).");
      }
      setPrivateKey(text);
      setP8Name(file.name);
    } catch (err) {
      setP8Name(null);
      setP8Error(err instanceof Error ? err.message : "Invalid file.");
    }
  }

  async function handleServiceAccountFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset pour permettre de resélectionner le même fichier.
    e.target.value = "";
    if (!file) return;
    setSaError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { type?: string; client_email?: string };
      if (parsed.type !== "service_account") {
        throw new Error(
          "This file isn't a Google service account key (expected type: service_account)."
        );
      }
      setSaFile({ name: file.name, email: parsed.client_email ?? null, json: text });
    } catch (err) {
      setSaFile(null);
      setSaError(
        err instanceof SyntaxError
          ? "Invalid file: unreadable JSON."
          : err instanceof Error
            ? err.message
            : "Invalid file."
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-tertiary" : "bg-muted-foreground"}`}
          aria-hidden="true"
        />
        <span>{connected ? `${storeLabel} connected` : `${storeLabel} not connected`}</span>
        {connected ? (
          <div className="ml-auto flex items-center gap-2">
            {!editing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                Update credentials
              </Button>
            ) : null}
            <form action={disconnectAction}>
              <input type="hidden" name="project_id" value={projectId} />
              <Button type="submit" variant="ghost" size="sm">
                {accountScoped ? "Disconnect from all iOS projects" : "Disconnect"}
              </Button>
            </form>
          </div>
        ) : null}
      </div>

      {accountScoped ? (
        <p className="max-w-prose text-xs text-muted-foreground">
          {connected
            ? "These credentials belong to your Apple developer account: every iOS project you create is connected automatically."
            : "The App Store Connect key is issued per Apple developer account, so you only enter it once for all your iOS projects."}
        </p>
      ) : null}

      {!connected ? <ConnectTutorial store={store} /> : null}

      {showForm ? (
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="project_id" value={projectId} />

        {store === "appstore" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key_id">Key ID</Label>
              <Input id="key_id" name="key_id" placeholder="XXXXXXXXXX" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="issuer_id">Issuer ID</Label>
              <Input id="issuer_id" name="issuer_id" placeholder="00000000-0000-0000-0000-000000000000" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Private key (.p8)</Label>
              <input type="hidden" name="private_key" value={privateKey} />
              <input
                ref={p8InputRef}
                type="file"
                accept=".p8"
                className="hidden"
                onChange={handleP8File}
              />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => p8InputRef.current?.click()}
                >
                  Upload the .p8 file
                </Button>
              </div>
              {p8Name ? (
                <p className="text-xs" role="status">
                  <span className="inline-flex items-center gap-1 text-tertiary">
                    <IconCheck className="h-3.5 w-3.5" /> {p8Name} uploaded
                  </span>
                </p>
              ) : null}
              {p8Error ? (
                <p role="alert" className="text-xs text-destructive">
                  {p8Error}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label>Service account JSON</Label>
            <input type="hidden" name="service_account_json" value={saFile?.json ?? ""} />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleServiceAccountFile}
            />
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Select the .json file
              </Button>
            </div>
            {saFile ? (
              <p className="text-xs" role="status">
                <span className="inline-flex items-center gap-1 text-tertiary">
                  <IconCheck className="h-3.5 w-3.5" /> {saFile.name} uploaded
                </span>
                {saFile.email ? (
                  <span className="block truncate text-muted-foreground">{saFile.email}</span>
                ) : null}
              </p>
            ) : null}
            {saError ? (
              <p role="alert" className="text-xs text-destructive">
                {saError}
              </p>
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="outline"
            disabled={
              pending ||
              (store === "playstore" && !saFile) ||
              (store === "appstore" && !privateKey)
            }
          >
            {pending
              ? "Connecting…"
              : connected
                ? "Update credentials"
                : "Connect store"}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          ) : null}
        </div>
        <p className="max-w-prose text-xs text-muted-foreground">
          Your credentials are encrypted (AES-256-GCM) and are never shown again.
        </p>
      </form>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="text-sm text-tertiary">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
