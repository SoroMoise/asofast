"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useProjectBusy } from "@/components/dashboard/project-busy";
import { Button } from "@/components/ui/button";
import { IconCheck, IconInfo, IconX } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Spinner } from "@/components/ui/spinner";
import addForReview from "@/dashboard_screens/add_for_review.png";
import prepareSubmission from "@/dashboard_screens/prepare_submission.png";
import { STORE_LOCALES } from "@/lib/locales";
import type { LocaleResult } from "@/lib/publish/types";
import type { StorePlatform } from "@/types";

// Taille de lot. À 1 tant que le diff sha256 n'est pas confirmé: si rien n'est
// skippé (tout se ré-upload), même 2 langues peuvent dépasser maxDuration=300, et
// comme le commit n'a lieu qu'au dernier lot, un lot tué en cours perd TOUTE la
// publication. 1 langue/requête = chaque requête tient sous 300s quoi qu'il
// arrive. À remonter une fois le diff confirmé (logs [publish play] sets_skipped).
const LOCALE_BATCH_SIZE = 1;

// Une ligne du feed = une langue. "pending" quand elle commence, "ok"/"fail"
// quand elle finit. La liste sert de progression temps réel (streaming NDJSON).
type FeedStatus = "pending" | "ok" | "fail";
type FeedEntry = { locale: string; status: FeedStatus; detail?: string };

type PublishEvent =
  | { type: "locale"; locale: string; phase: "start" | "done"; ok?: boolean; error?: string }
  | {
      type: "done";
      perLocale: LocaleResult[];
      message?: string | null;
      error?: string | null;
      editId?: string | null;
    }
  | { type: "fatal"; error: string };

/**
 * Une ligne du périmètre: case + libellé + rappel des champs couverts. Le rappel
 * évite d'avoir à deviner ce que « Listing text » embarque (PRODUCT.md: le
 * jargon store s'explique en une ligne, jamais supposé connu).
 */
function ScopeCheckbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex w-fit cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-primary"
      />
      <span className="flex flex-col">
        <span className="text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Gros CTA de publication: pousse les fiches enregistrées (textes +
 * screenshots) sur le store connecté pour les langues choisies (toutes par
 * défaut), par lots, après confirmation.
 */
export function PublishCta({
  projectId,
  store,
  storeConnected,
  publishableLocales,
}: {
  projectId: string;
  store: StorePlatform;
  storeConnected: boolean;
  /** Langues cibles ayant une fiche enregistrée. */
  publishableLocales: string[];
}) {
  const router = useRouter();
  const { busy: pageBusy, start, end } = useProjectBusy();
  // Confirmation 2 clics: 1er clic -> bouton rouge, 2e clic -> publie (même
  // pattern que « Régénérer cette langue »).
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [completed, setCompleted] = React.useState(0);
  const [feed, setFeed] = React.useState<FeedEntry[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  // Opt-in explicite pour envoyer la fiche en review (défaut = ne PAS soumettre).
  // App Store: sans coche on n'édite que le brouillon; avec coche on soumet en
  // review. Play Store: Google envoie désormais automatiquement l'edit en review
  // au commit; cette case n'est donc affichée que pour l'App Store.
  const [submitForReview, setSubmitForReview] = React.useState(false);
  // Périmètre de publication. Tout coché par défaut = comportement d'avant
  // l'option. Décocher les screenshots évite 5 téléchargements storage ET ~22
  // appels store PAR LANGUE: un run texte seul passe d'environ 17s à 4s par
  // langue. État de session, jamais persisté (au rechargement on revient à
  // « tout publier », le défaut sûr).
  const [publishText, setPublishText] = React.useState(true);
  const [publishScreenshots, setPublishScreenshots] = React.useState(true);
  const [publishStoreAssets, setPublishStoreAssets] = React.useState(true);
  // App Store: URL de politique de confidentialité + « What's New in This
  // Version ». Cochable seule pour une mise à jour de version (les deux seuls
  // champs qui bougent), sans repousser toute la fiche.
  const [publishPrivacyAndWhatsNew, setPublishPrivacyAndWhatsNew] = React.useState(true);
  // Langues à publier. Tout coché par défaut; le MultiSelect est remonté (`key`)
  // quand la liste des langues publiables change (nouvelle génération) et
  // re-remonte alors « tout sélectionné », le défaut sûr. État de session, jamais
  // persisté, comme le périmètre.
  const [selectedLocales, setSelectedLocales] = React.useState<string[]>(publishableLocales);
  const feedEndRef = React.useRef<HTMLDivElement>(null);

  const storeLabel = store === "appstore" ? "the App Store" : "Google Play";
  // Ordre de la liste des fiches, pas ordre de clic du MultiSelect; ignore aussi
  // une langue sélectionnée qui ne serait plus publiable.
  const localesToPublish = publishableLocales.filter((l) => selectedLocales.includes(l));
  const count = localesToPublish.length;
  const localeLabels = new Map(STORE_LOCALES[store].map((o) => [o.value, o.label]));
  const localeOptions = publishableLocales.map((value) => ({
    value,
    label: localeLabels.get(value) ?? value,
  }));
  // Rien de sélectionné = rien à envoyer. Même règle que `isEmptyScope` côté
  // serveur: chaque bloc optionnel ne compte que sur SON store. Sur App Store
  // `storeAssets` n'est jamais lu (l'icône vient du binaire) et sur Play
  // `privacyAndWhatsNew` n'existe pas: une case cachée ne doit pas garder le
  // bouton actif à elle seule.
  const nothingSelected =
    !publishText &&
    !publishScreenshots &&
    (store === "appstore" ? !publishPrivacyAndWhatsNew : !publishStoreAssets);
  const disabled =
    pageBusy || publishing || !storeConnected || count === 0 || nothingSelected;

  // Auto-scroll du feed vers la dernière ligne quand un évènement arrive.
  React.useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [feed]);

  // Crée (start -> pending) ou met à jour (done -> ok/fail) la ligne d'une langue
  // en place. JS mono-thread: cohérent malgré le streaming.
  const upsertFeed = React.useCallback((locale: string, patch: Partial<FeedEntry>) => {
    setFeed((prev) => {
      const i = prev.findIndex((e) => e.locale === locale);
      if (i >= 0) {
        const next = prev.slice();
        next[i] = { ...next[i], ...patch };
        return next;
      }
      return [...prev, { locale, status: "pending", ...patch }];
    });
  }, []);

  function handlePublishClick() {
    // 1er clic: arme la confirmation (bouton rouge). 2e clic: publie.
    if (!confirmPublish) {
      setConfirmPublish(true);
      return;
    }
    setConfirmPublish(false);
    void handlePublish();
  }

  async function handlePublish() {
    setPublishing(true);
    start();
    setError(null);
    setMessage(null);
    setFeed([]);
    setCompleted(0);

    const collected: LocaleResult[] = [];
    const problems: string[] = [];
    // Play Store: edit partagé, ouvert au 1er lot et repassé aux suivants pour
    // que toute la publication tienne dans un seul edit (commit au dernier lot).
    let editId: string | undefined;

    // Langues déjà comptées dans la barre. Une langue tombée AVANT sa mise à
    // jour (téléchargement des frames) n'émet aucun évènement "locale": elle
    // n'arrive que dans le récap `done`. Sans ce jeu, la barre resterait bloquée
    // sous 100% alors que le run est fini, ou double-compterait les autres.
    const counted = new Set<string>();
    const markCompleted = (locale: string) => {
      if (counted.has(locale)) return;
      counted.add(locale);
      setCompleted((c) => Math.min(c + 1, count));
    };

    // Applique un évènement du stream: avance la barre, alimente le feed.
    const handleEvent = (ev: PublishEvent) => {
      if (ev.type === "locale") {
        if (ev.phase === "start") {
          upsertFeed(ev.locale, { status: "pending" });
        } else {
          upsertFeed(ev.locale, { status: ev.ok ? "ok" : "fail", detail: ev.error });
          markCompleted(ev.locale);
        }
      } else if (ev.type === "done") {
        // Capture l'edit partagé (Play) pour le repasser au lot suivant.
        if (ev.editId) editId = ev.editId;
        // Erreur de lot SANS résultat par langue (validation: privacy, feature
        // graphic, aucune fiche…) = bloquant, on interrompt.
        if (ev.error && (!ev.perLocale || ev.perLocale.length === 0)) {
          throw new Error(ev.error);
        }
        collected.push(...(ev.perLocale ?? []));
        // Détail final par langue (champs mis à jour) une fois le lot commité.
        for (const r of ev.perLocale ?? []) {
          const failed = Boolean(r.error) || r.updatedFields.length === 0;
          upsertFeed(r.locale, {
            status: failed ? "fail" : "ok",
            detail: r.error ?? r.updatedFields.join(", "),
          });
          markCompleted(r.locale);
        }
        if (ev.error) problems.push(ev.error);
      } else if (ev.type === "fatal") {
        throw new Error(ev.error);
      }
    };

    try {
      for (let i = 0; i < localesToPublish.length; i += LOCALE_BATCH_SIZE) {
        const batch = localesToPublish.slice(i, i + LOCALE_BATCH_SIZE);
        const isLastBatch = i + LOCALE_BATCH_SIZE >= localesToPublish.length;
        // App Store: on n'édite que le brouillon par défaut; on ne soumet en review
        // Apple (dernier lot) QUE si l'utilisateur a coché l'option. Play: on
        // committe l'edit partagé au DERNIER lot (→ review Google), les lots
        // précédents ne font que remplir l'edit.
        const commit =
          store === "appstore" ? isLastBatch && submitForReview : isLastBatch;

        const res = await fetch(`/api/projects/${projectId}/publish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locales: batch,
            commit,
            editId,
            // Google Play envoie désormais l'edit en review automatiquement;
            // le paramètre changesNotSentForReview n'est plus supporté.
            changesNotSentForReview: undefined,
            scope: {
              text: publishText,
              screenshots: publishScreenshots,
              storeAssets: publishStoreAssets,
              privacyAndWhatsNew: publishPrivacyAndWhatsNew,
            },
          }),
        });
        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            // réponse non-JSON — on garde le code HTTP.
          }
          throw new Error(msg);
        }

        // Lecture NDJSON: une ligne = un évènement, traité dès réception.
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
            let ev: PublishEvent;
            try {
              ev = JSON.parse(line) as PublishEvent;
            } catch {
              continue; // ligne partielle/illisible — ignorée
            }
            // handleEvent peut throw (fatal / erreur de validation bloquante):
            // on laisse remonter au catch externe.
            handleEvent(ev);
          }
        }
      }

      const okCount = collected.filter((r) => r.updatedFields.length > 0 && !r.error).length;
      // Langues qui n'ont PAS abouti (erreur API, ou aucun champ écrit). Surfacées
      // de façon persistante: un rejet isolé (ex: code langue refusé par le store)
      // ne doit pas disparaître derrière un message vert et être découvert des
      // jours plus tard sur la console du store.
      const failed = collected.filter((r) => r.error || r.updatedFields.length === 0);
      const failedSummary =
        failed.length <= 6
          ? failed
              .map((r) => `${r.locale}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`)
              .join("; ")
          : `${failed
              .slice(0, 10)
              .map((r) => r.locale)
              .join(", ")}${failed.length > 10 ? "…" : ""}`;
      if (okCount === 0) {
        setError(
          problems[0] ||
            failedSummary ||
            `No language published on ${storeLabel}. Check the errors below.`
        );
      } else if (failed.length > 0 || problems.length > 0) {
        const parts: string[] = [];
        if (failed.length > 0) parts.push(`${failed.length} failure(s): ${failedSummary}`);
        if (problems.length > 0) parts.push(problems.join("; "));
        setError(`Published ${okCount}/${count} on ${storeLabel}. ${parts.join(" | ")}`);
      } else {
        setMessage(
          store === "appstore"
            ? submitForReview
              ? `${okCount}/${count} language(s) updated and version submitted for Apple review.`
              : `${okCount}/${count} language(s) updated (draft). Submit the version from App Store Connect when you're ready.`
            : `${okCount}/${count} language(s) updated and sent for Google review.`
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publishing failed.");
    } finally {
      setPublishing(false);
      end();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {store === "appstore" ? (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-start gap-2">
            <IconInfo className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                Before publishing: prepare a version in App Store Connect
              </p>
              <p className="max-w-prose text-xs text-muted-foreground">
                The upload only works if a version is already being prepared on your
                App Store Connect dashboard. Open your app there and check that the top
                of the page looks like the two screenshots below.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <figure className="flex flex-col gap-1.5">
              <Image
                src={prepareSubmission}
                alt="Version in the Prepare for Submission state, shown at the top left of App Store Connect"
                sizes="200px"
                className="h-auto w-full max-w-[200px] rounded-md border border-border bg-white p-1.5"
              />
              <figcaption className="text-xs text-muted-foreground">
                Top left: the version must be in{" "}
                <span className="font-medium text-foreground">Prepare for Submission</span>.
              </figcaption>
            </figure>
            <figure className="flex flex-col gap-1.5">
              <Image
                src={addForReview}
                alt="Blue Add for Review button, shown at the top right of App Store Connect"
                sizes="180px"
                className="h-auto w-full max-w-[180px] rounded-md border border-border bg-white p-1.5"
              />
              <figcaption className="text-xs text-muted-foreground">
                Top right: the blue{" "}
                <span className="font-medium text-foreground">Add for Review</span> button.
              </figcaption>
            </figure>
          </div>
        </div>
      ) : null}
      {/* Périmètre. `fieldset`/`legend` est le groupement correct pour des cases
          liées (lecteurs d'écran annoncent le groupe avant chaque case), et
          `disabled` sur le fieldset coupe nativement les trois entrées pendant
          la publication. */}
      <fieldset className="flex flex-col gap-2" disabled={publishing}>
        <legend className="mb-1 text-sm font-medium text-foreground">What to publish</legend>
        <ScopeCheckbox
          checked={publishText}
          onChange={(v) => {
            setPublishText(v);
            setConfirmPublish(false);
          }}
          label="Listing text"
          hint={
            store === "appstore"
              ? "title, subtitle, description, keywords, promotional text"
              : "title, short description, full description"
          }
        />
        <ScopeCheckbox
          checked={publishScreenshots}
          onChange={(v) => {
            setPublishScreenshots(v);
            setConfirmPublish(false);
          }}
          label="Screenshots"
          hint={
            store === "appstore" ? "iPhone and iPad frames" : "phone and tablet frames"
          }
        />
        {store === "appstore" ? (
          <ScopeCheckbox
            checked={publishPrivacyAndWhatsNew}
            onChange={(v) => {
              setPublishPrivacyAndWhatsNew(v);
              setConfirmPublish(false);
            }}
            label="Privacy policy and What's New"
            hint="privacy policy URL (App Information) and the release notes of this version"
          />
        ) : null}
        {store === "playstore" ? (
          <ScopeCheckbox
            checked={publishStoreAssets}
            onChange={(v) => {
              setPublishStoreAssets(v);
              setConfirmPublish(false);
            }}
            label="Icon and feature graphic"
            hint="512×512 icon and 1024×500 banner, shared by every language"
          />
        ) : null}
      </fieldset>

      {publishableLocales.length > 1 ? (
        <div className="flex max-w-prose flex-col gap-1.5">
          <Label htmlFor="publish-locales">
            Languages to publish ({count}/{publishableLocales.length})
          </Label>
          <MultiSelect
            key={publishableLocales.join(",")}
            id="publish-locales"
            name="publish_locales"
            options={localeOptions}
            defaultSelected={publishableLocales}
            placeholder="Choose languages…"
            searchPlaceholder="Search a language…"
            summaryFormatter={(c) => `${c} languages selected`}
            onSelectionChange={(values) => {
              setSelectedLocales(values);
              setConfirmPublish(false);
            }}
            disabled={publishing}
          />
        </div>
      ) : null}

      {store === "appstore" ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={submitForReview}
            onChange={(e) => {
              setSubmitForReview(e.target.checked);
              setConfirmPublish(false);
            }}
            disabled={publishing}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-foreground">Also send for Apple review after updating</span>
        </label>
      ) : (
        <p className="text-sm text-muted-foreground">
          Changes are sent for Google review automatically on publish.
        </p>
      )}
      <div>
        <Button
          type="button"
          size="lg"
          variant={confirmPublish ? "destructive" : "primary"}
          onClick={handlePublishClick}
          onBlur={() => setConfirmPublish(false)}
          disabled={disabled}
        >
          {publishing ? (
            <>
              <Spinner /> Publishing…
            </>
          ) : confirmPublish ? (
            `Confirm publishing on ${storeLabel}`
          ) : (
            `Publish on ${storeLabel} (${count} language${count > 1 ? "s" : ""})`
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {store === "appstore"
          ? submitForReview
            ? "Listings will be updated AND the version submitted for Apple review."
            : "Listings will be updated as a draft (not submitted). You submit the version yourself from App Store Connect."
          : "Listings will be updated and sent for Google review automatically (visible after approval)."}
      </p>

      {!storeConnected ? (
        <p className="max-w-prose text-xs text-muted-foreground">
          Connect the store first (
          <a href="#store" className="underline underline-offset-2 hover:text-foreground">
            Store card
          </a>
          ) to be able to publish.
        </p>
      ) : publishableLocales.length === 0 ? (
        <p className="max-w-prose text-xs text-muted-foreground">
          No listing saved for your target languages:{" "}
          <a href="#generer" className="underline underline-offset-2 hover:text-foreground">
            generate them first
          </a>
          .
        </p>
      ) : count === 0 ? (
        <p className="max-w-prose text-xs text-muted-foreground">
          Select at least one language under{" "}
          <span className="text-foreground">Languages to publish</span>.
        </p>
      ) : nothingSelected ? (
        <p className="max-w-prose text-xs text-muted-foreground">
          Tick at least one item under <span className="text-foreground">What to publish</span>.
        </p>
      ) : null}

      {publishing || feed.length > 0 ? (
        <div className="flex max-w-prose flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-foreground">
              {publishing ? `Publishing on ${storeLabel}…` : "Publishing complete"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {completed}/{count} language{count > 1 ? "s" : ""}
            </span>
          </div>
          {/* Barre déterminée: avancement réel (langues traitées), jamais une
              animation décorative (confiance avant magie). */}
          <div
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={count}
            aria-label="Publishing progress"
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${count > 0 ? Math.round((completed / count) * 100) : 0}%` }}
            />
          </div>
          {/* Feed live: une ligne par langue, la plus récente en bas. */}
          {feed.length > 0 ? (
            <div
              role="log"
              aria-live="polite"
              className="mt-1 max-h-44 overflow-y-auto rounded-md bg-muted p-2 text-xs"
            >
              <ul className="flex flex-col gap-0.5">
                {feed.map((f) => (
                  <li key={f.locale} className="flex items-start gap-2">
                    <span
                      className={
                        f.status === "ok"
                          ? "shrink-0 text-tertiary"
                          : f.status === "fail"
                            ? "shrink-0 text-destructive"
                            : "shrink-0 text-muted-foreground"
                      }
                    >
                      {f.status === "pending" ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : f.status === "ok" ? (
                        <IconCheck className="h-3.5 w-3.5" />
                      ) : (
                        <IconX className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="shrink-0 font-medium">{f.locale}</span>
                    {f.detail ? (
                      <span className="text-muted-foreground">{f.detail}</span>
                    ) : null}
                  </li>
                ))}
                <div ref={feedEndRef} />
              </ul>
            </div>
          ) : null}
          {publishing ? (
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
