"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { prepareScreenshotCaptions } from "@/app/(app)/actions";
import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { IconCheck, IconX } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import {
  ASO_BATCH_CONCURRENCY,
  ASO_BATCH_SIZE,
  computeTotalSteps,
  filterMissingLocales,
  SHOTS_BATCH_CONCURRENCY,
  SHOTS_BATCH_SIZE,
  splitBatches,
} from "@/lib/generation-rounds";
import { cn } from "@/lib/utils";

type LogStatus = "pending" | "ok" | "fail";
type LogEntry = {
  key: string;
  locale: string;
  kind: "fiche" | "screenshots";
  status: LogStatus;
  error?: string;
};

type StreamBatchResult = { error: string | null };
type StreamEvent =
  | { type: "aso"; locale: string; phase: "start" | "done"; ok?: boolean; error?: string }
  | { type: "shots"; locale: string; phase: "start" | "done"; ok?: boolean; error?: string }
  | { type: "done"; aso: StreamBatchResult; shots: StreamBatchResult }
  | { type: "fatal"; error: string };

export function GenerateCta({
  projectId,
  targetLocales,
  existingListingLocales,
  hasCompetitors,
  hasSourceScreenshots,
}: {
  projectId: string;
  targetLocales: string[];
  existingListingLocales: string[];
  hasCompetitors: boolean;
  hasSourceScreenshots: boolean;
}) {
  const router = useRouter();
  const {
    busy: pageBusy,
    localesSaving,
    start,
    end,
    selectedLocales,
    sourceShotCount,
  } = useProjectBusy();
  const hasShots = sourceShotCount !== null ? sourceShotCount > 0 : hasSourceScreenshots;
  const effectiveLocales = selectedLocales ?? targetLocales;
  const [includeAso, setIncludeAso] = React.useState(true);
  // Par défaut on ne repaie pas les langues qui ont déjà une fiche (une relance
  // complète regénérait tout, écrasait les fiches et redébitait les crédits).
  const [skipExisting, setSkipExisting] = React.useState(true);
  const [wantShots, setWantShots] = React.useState(true);
  const includeShots = wantShots && hasShots;
  const [confirm, setConfirm] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [completed, setCompleted] = React.useState(0);
  // Nombre de langues du run en cours/terminé, figé au clic: après router.refresh()
  // les fiches fraîchement générées sortent de `roundLocales`, ce qui ferait tomber
  // le dénominateur de la barre à 0 (« 20/0 listings »).
  const [runLocaleCount, setRunLocaleCount] = React.useState<number | null>(null);
  const [shotsDenominator, setShotsDenominator] = React.useState<number | null>(null);
  const [captioning, setCaptioning] = React.useState(false);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const logEndRef = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs]);

  const localesKey = effectiveLocales.join(",");
  const prevLocalesKeyRef = React.useRef(localesKey);
  React.useEffect(() => {
    if (prevLocalesKeyRef.current === localesKey) return;
    prevLocalesKeyRef.current = localesKey;
    if (generating) return;
    setLogs([]);
    setCompleted(0);
    setRunLocaleCount(null);
    setShotsDenominator(null);
    setMessage(null);
    setError(null);
  }, [localesKey, generating]);

  // Le filtre ne s'applique qu'avec les listings cochés: en screenshots seuls,
  // toutes les langues choisies sont traitées. Avec listings + screenshots, les
  // screenshots suivent les langues dont la fiche vient d'être générée.
  const skipping = includeAso && skipExisting;
  const roundLocales = skipping
    ? filterMissingLocales(effectiveLocales, existingListingLocales)
    : effectiveLocales;
  const skippedCount = effectiveLocales.length - roundLocales.length;
  const count = roundLocales.length;
  const noScope = !includeAso && !includeShots;
  const needsCompetitors = includeAso && !hasCompetitors;

  const scopeLabel =
    includeAso && includeShots
      ? "listings + screenshots"
      : includeAso
        ? "listings"
        : "screenshots";
  const progressNoun =
    includeAso && includeShots
      ? "listings and screenshots"
      : includeAso
        ? "listings"
        : "screenshots";
  const successNoun =
    includeAso && includeShots
      ? "Listings and screenshots generated"
      : includeAso
        ? "Listings generated"
        : "Screenshots generated";
  const primaryIsAso = includeAso;
  const kinds = (includeAso ? 1 : 0) + (includeShots ? 1 : 0);
  const totalSteps = computeTotalSteps({
    localeCount: runLocaleCount ?? count,
    includeAso,
    includeShots,
    survivorCount: shotsDenominator,
  });
  const unitLabel = kinds === 2 ? "step" : primaryIsAso ? "listing" : "screenshot";

  const disabled =
    pageBusy || localesSaving || generating || count === 0 || noScope || needsCompetitors;
  const scopeDisabled = pageBusy || generating;
  const blockers = [
    localesSaving ? "Saving languages…" : null,
    noScope ? "Select at least one output to generate." : null,
    needsCompetitors
      ? "Add at least one competitor (Competitors card) for listings, or uncheck “ASO listings” to generate only screenshots."
      : null,
    effectiveLocales.length === 0
      ? "Save at least one target language (Languages card)."
      : null,
    effectiveLocales.length > 0 && count === 0
      ? "Every selected language already has a listing. Untick “Skip languages that already have a listing” to regenerate them, or use “Regenerate this language” on a listing."
      : null,
  ].filter((b): b is string => b !== null);

  function handleGenerateClick() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    void handleGenerate();
  }

  async function handleGenerate() {
    setGenerating(true);
    start();
    setError(null);
    setMessage(null);
    setCompleted(0);
    setRunLocaleCount(roundLocales.length);
    setShotsDenominator(null);
    setLogs([]);
    let captionTimer: ReturnType<typeof setTimeout> | undefined;

    const runStart = performance.now();
    const batchMs: number[] = [];
    let generated = 0;
    let shotsDone = 0;
    const failed: { locale: string; error: string }[] = [];
    const errors: string[] = [];
    const resolved = new Set<string>();
    let interrupted = 0;
    const survivors = new Set<string>();
    let shotsAttempted = 0;

    const upsertLog = (
      locale: string,
      kind: LogEntry["kind"],
      status: LogStatus,
      error?: string
    ) => {
      const key = `${locale}:${kind}`;
      setLogs((prev) => {
        const i = prev.findIndex((l) => l.key === key);
        if (i >= 0) {
          const nextLogs = prev.slice();
          nextLogs[i] = { ...nextLogs[i], status, error };
          return nextLogs;
        }
        return [...prev, { key, locale, kind, status, error }];
      });
    };

    type BatchCtx = { asoError: string | null; shotsError: string | null };

    const handleEvent = (ev: StreamEvent, ctx: BatchCtx) => {
      if (ev.type === "aso") {
        if (ev.phase === "start") {
          upsertLog(ev.locale, "fiche", "pending");
        } else if (ev.ok) {
          resolved.add(`${ev.locale}:fiche`);
          generated += 1;
          survivors.add(ev.locale);
          setCompleted((c) => c + 1);
          upsertLog(ev.locale, "fiche", "ok");
        } else {
          resolved.add(`${ev.locale}:fiche`);
          setCompleted((c) => c + 1);
          failed.push({ locale: ev.locale, error: ev.error ?? "listing failed" });
          upsertLog(ev.locale, "fiche", "fail", ev.error);
        }
      } else if (ev.type === "shots") {
        if (ev.phase === "start") {
          upsertLog(ev.locale, "screenshots", "pending");
        } else if (ev.ok) {
          resolved.add(`${ev.locale}:screenshots`);
          shotsDone += 1;
          setCompleted((c) => c + 1);
          upsertLog(ev.locale, "screenshots", "ok");
        } else {
          resolved.add(`${ev.locale}:screenshots`);
          setCompleted((c) => c + 1);
          failed.push({ locale: ev.locale, error: ev.error ?? "screenshots failed" });
          upsertLog(ev.locale, "screenshots", "fail", ev.error);
        }
      } else if (ev.type === "fatal") {
        errors.push(ev.error);
        ctx.asoError = ev.error;
        ctx.shotsError = ev.error;
      } else if (ev.type === "done") {
        if (ev.aso.error) {
          errors.push(ev.aso.error);
          ctx.asoError = ev.aso.error;
        }
        ctx.shotsError = ev.shots.error;
        if (ev.shots.error) {
          if (!includeAso) errors.push(ev.shots.error);
          else upsertLog("all", "screenshots", "fail", ev.shots.error);
        }
      }
    };

    const closeBatch = (
      batch: string[],
      kind: LogEntry["kind"],
      batchError: string | null,
      ctx: BatchCtx
    ) => {
      const outputError = kind === "fiche" ? ctx.asoError : ctx.shotsError;
      for (const locale of batch) {
        const key = `${locale}:${kind}`;
        if (resolved.has(key)) continue;
        resolved.add(key);
        interrupted += 1;
        setCompleted((c) => c + 1);
        upsertLog(
          locale,
          kind,
          "fail",
          batchError ?? outputError ?? "interrupted (server stopped before finishing)"
        );
      }
    };

    async function runRound(
      roundLocales: string[],
      batchSize: number,
      batchConcurrency: number,
      scope: { includeAso: boolean; includeShots: boolean }
    ): Promise<void> {
      const kind: LogEntry["kind"] = scope.includeAso ? "fiche" : "screenshots";
      const batches = splitBatches(roundLocales, batchSize);
      let next = 0;

      async function worker() {
        while (next < batches.length) {
          const idx = next++;
          const batch = batches[idx];
          const bStart = performance.now();
          let batchError: string | null = null;
          const ctx: BatchCtx = { asoError: null, shotsError: null };
          try {
            const res = await fetch(`/api/projects/${projectId}/generate`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                locales: batch,
                includeAso: scope.includeAso,
                includeShots: scope.includeShots,
              }),
            });
            if (!res.ok || !res.body) {
              let msg = `HTTP ${res.status}`;
              try {
                const body = (await res.json()) as { error?: string };
                if (body.error) msg = body.error;
              } catch {
                // non-JSON response
              }
              throw new Error(msg);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                try {
                  handleEvent(JSON.parse(line) as StreamEvent, ctx);
                } catch {
                  // ignore partial/invalid line
                }
              }
            }
          } catch (e) {
            batchError = e instanceof Error ? e.message : "Batch failed.";
            errors.push(batchError);
          } finally {
            closeBatch(batch, kind, batchError, ctx);
            const bMs = Math.round(performance.now() - bStart);
            batchMs.push(bMs);
            console.log(
              `[measure] ${kind} batch#${idx + 1} (${batch.length} locales) = ${bMs}ms`
            );
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(batchConcurrency, batches.length) }, worker)
      );
    }

    try {
      let survivorList = roundLocales;
      if (includeAso) {
        await runRound(roundLocales, ASO_BATCH_SIZE, ASO_BATCH_CONCURRENCY, {
          includeAso: true,
          includeShots: false,
        });
        survivorList = roundLocales.filter((l) => survivors.has(l));
      }

      if (includeShots) {
        if (survivorList.length === 0) {
          setShotsDenominator(0);
        } else {
          captionTimer = setTimeout(() => setCaptioning(true), 1200);
          await prepareScreenshotCaptions({ projectId });
          clearTimeout(captionTimer);
          captionTimer = undefined;
          setCaptioning(false);
          shotsAttempted = survivorList.length;
          setShotsDenominator(shotsAttempted);
          await runRound(survivorList, SHOTS_BATCH_SIZE, SHOTS_BATCH_CONCURRENCY, {
            includeAso: false,
            includeShots: true,
          });
        }
      }

      const totalMs = Math.round(performance.now() - runStart);
      console.log(
        `[measure] TOTAL ${totalMs}ms for ${generated} locales (${Math.round(totalMs / Math.max(generated, 1))}ms/locale) — batches: [${batchMs.join(", ")}]`
      );

      const problems = [
        ...failed.map((f) => `${f.locale} (${f.error})`),
        ...errors,
        ...(interrupted > 0
          ? [`${interrupted} step${interrupted > 1 ? "s" : ""} interrupted before finishing`]
          : []),
      ];
      const primaryDone = primaryIsAso ? generated : shotsDone;
      if (primaryDone === 0) {
        setError(
          problems.length > 0
            ? `Generation failed: ${problems.join("; ")}`
            : "Generation failed."
        );
      } else if (problems.length > 0) {
        setError(`Generated for ${primaryDone} language(s); issues: ${problems.join(", ")}`);
      } else {
        setMessage(`${successNoun} for ${primaryDone} language(s).`);
      }
      if (primaryDone > 0) {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      if (captionTimer) clearTimeout(captionTimer);
      setGenerating(false);
      setCaptioning(false);
      end();
    }
  }

  return (
    <div id="generer" className="flex scroll-mt-6 flex-col gap-2">
      <fieldset className="flex flex-col gap-1.5" disabled={scopeDisabled}>
        <legend className="sr-only">Outputs to generate</legend>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeAso}
            onChange={(e) => {
              setIncludeAso(e.target.checked);
              setConfirm(false);
            }}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-foreground">ASO listings + translations</span>
        </label>
        {includeAso ? (
          <label className="ml-6 flex w-fit cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={skipExisting}
              onChange={(e) => {
                setSkipExisting(e.target.checked);
                setConfirm(false);
              }}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-foreground">Skip languages that already have a listing</span>
            {skipping && skippedCount > 0 ? (
              <span className="text-muted-foreground">
                ({skippedCount} skipped)
              </span>
            ) : null}
          </label>
        ) : null}
        <label
          className={cn(
            "flex w-fit items-center gap-2 text-sm",
            hasShots ? "cursor-pointer" : "cursor-not-allowed"
          )}
        >
          <input
            type="checkbox"
            checked={includeShots}
            disabled={!hasShots}
            onChange={(e) => {
              setWantShots(e.target.checked);
              setConfirm(false);
            }}
            className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
          />
          <span className={hasShots ? "text-foreground" : "text-muted-foreground"}>
            Marketing screenshots
          </span>
          {!hasShots ? (
            <span className="text-muted-foreground">
              upload screenshots first (Marketing screenshots card)
            </span>
          ) : null}
        </label>
      </fieldset>
      <div>
        <Button
          type="button"
          size="lg"
          variant={confirm ? "destructive" : "primary"}
          onClick={handleGenerateClick}
          onBlur={() => setConfirm(false)}
          disabled={disabled}
        >
          {generating ? (
            <>
              <Spinner /> Generating…
            </>
          ) : confirm ? (
            `Confirm (${count} language${count > 1 ? "s" : ""})`
          ) : (
            `Generate ${scopeLabel} (${count} language${count > 1 ? "s" : ""})`
          )}
        </Button>
      </div>
      {blockers.length > 0 ? (
        <ul className="max-w-prose text-xs text-muted-foreground">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {generating || logs.length > 0 ? (
        <div className="flex max-w-prose flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-foreground">
              {generating ? `Generating ${progressNoun}…` : "Generation complete"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {completed}/{totalSteps} {unitLabel}
              {totalSteps > 1 ? "s" : ""}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-label="Generation progress"
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{
                width: `${totalSteps > 0 ? Math.round((Math.min(completed, totalSteps) / totalSteps) * 100) : 0}%`,
              }}
            />
          </div>
          {captioning ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" />
              <span>Analyzing your screenshots…</span>
            </div>
          ) : null}
          {logs.length > 0 ? (
            <div
              role="log"
              aria-live="polite"
              className="mt-1 max-h-44 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs"
            >
              <ul className="flex flex-col gap-0.5">
                {logs.map((l) => (
                  <li key={l.key} className="flex items-start gap-2">
                    <span
                      className={
                        l.status === "ok"
                          ? "shrink-0 text-tertiary"
                          : l.status === "fail"
                            ? "shrink-0 text-destructive"
                            : "shrink-0 text-muted-foreground"
                      }
                    >
                      {l.status === "pending" ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : l.status === "ok" ? (
                        <IconCheck className="h-3.5 w-3.5" />
                      ) : (
                        <IconX className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="shrink-0 text-foreground">{l.locale}</span>
                    <span className="text-muted-foreground">
                      {l.kind === "fiche" ? "listing" : "screenshots"}
                      {l.status === "pending" ? "…" : ""}
                      {l.status === "fail" && l.error ? ` (${l.error})` : ""}
                    </span>
                  </li>
                ))}
                <div ref={logEndRef} />
              </ul>
            </div>
          ) : null}
          {generating ? (
            <p className="text-xs text-muted-foreground">
              Keep the tab open until it finishes.
            </p>
          ) : null}
        </div>
      ) : null}
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
