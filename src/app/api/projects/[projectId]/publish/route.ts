import { publishProjectListings } from "@/app/(app)/projects/[projectId]/actions";
import { FULL_SCOPE, normalizePublishScope } from "@/lib/publish/scope";

export const runtime = "nodejs";
// Même budget que la génération: un lot de langues doit finir sous ce timeout.
export const maxDuration = 300;

/**
 * POST /api/projects/{projectId}/publish
 *   body: { locales: string[], commit?: boolean, editId?: string,
 *           changesNotSentForReview?: boolean }
 *
 * Répond en STREAMING (NDJSON, une ligne JSON par évènement) pour un LOT de
 * langues, afin d'afficher l'avancement en temps réel côté client. La mise à jour
 * d'une langue (fiche + upload des screenshots) est lente; sans streaming, le lot
 * reste silencieux ~30-90s. Chaque langue émet "start" quand elle commence et
 * "done" quand elle finit (ok/erreur).
 *
 * Play Store: tous les lots partagent UN SEUL edit. Le 1er lot n'envoie pas
 * d'`editId`; la réponse renvoie l'`editId` ouvert, que le client repasse aux
 * lots suivants. `commit: true` (dernier lot) committe l'edit / soumet la
 * version. App Store ignore `editId` et soumet sur `commit`.
 *
 * Évènements émis (un objet JSON par ligne):
 *  { type: "locale", locale, phase: "start" | "done", ok?, error? }
 *  { type: "done",   perLocale, message?, error?, editId? }  récap de fin de lot
 *  { type: "fatal",  error }                                 échec bloquant
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;

  let locales: string[] = [];
  let commit = false;
  let editId: string | undefined;
  let changesNotSentForReview = false;
  let scope = FULL_SCOPE;
  try {
    const body = (await request.json()) as {
      locales?: unknown;
      commit?: unknown;
      editId?: unknown;
      changesNotSentForReview?: unknown;
      scope?: unknown;
    };
    if (Array.isArray(body.locales)) {
      locales = body.locales.filter((l): l is string => typeof l === "string");
    }
    if (typeof body.commit === "boolean") commit = body.commit;
    if (typeof body.editId === "string") editId = body.editId;
    if (typeof body.changesNotSentForReview === "boolean") {
      changesNotSentForReview = body.changesNotSentForReview;
    }
    // Absent ou mal typé => tout publier: un appelant qui ignore l'option garde
    // le comportement d'avant.
    scope = normalizePublishScope(body.scope);
  } catch {
    locales = [];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // Client déconnecté: on ignore, la publication serveur continue.
        }
      };

      try {
        const res = await publishProjectListings({
          projectId,
          locales,
          commit,
          editId,
          changesNotSentForReview,
          scope,
          onProgress: (locale, phase, ok, error) =>
            send({ type: "locale", locale, phase, ok, error }),
        });
        send({
          type: "done",
          perLocale: res.perLocale ?? [],
          message: res.message ?? null,
          error: res.error ?? null,
          // Play: edit partagé, repassé par le client au lot suivant.
          editId: res.editId ?? null,
        });
      } catch (e) {
        send({ type: "fatal", error: e instanceof Error ? e.message : "Publishing failed." });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Désactive le buffering de proxys (nginx) pour un flush immédiat.
      "x-accel-buffering": "no",
    },
  });
}
