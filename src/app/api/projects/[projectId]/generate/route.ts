import {
  generateAso,
  generateProjectScreenshots,
  type AsoGenerationResult,
} from "@/app/(app)/actions";

export const runtime = "nodejs";
// 800s = le maximum d'un plan Vercel Pro avec fluid compute (le defaut est 300s).
// C'est un FILET, pas un budget: un lot mesure a 313s a ete tue en prod sous le
// defaut, le flux NDJSON tronque, et le client n'a jamais recu son evenement
// "done". Le vrai correctif est de reduire la taille des lots (LOCALE_BATCH_SIZE)
// et le poids des uploads. Fluid facture le CPU actif, et l'upload est de
// l'attente reseau: relever ce plafond ne coute rien tant que rien ne s'allonge.
export const maxDuration = 800;

/**
 * POST /api/projects/{projectId}/generate  body: { locales: string[] }
 *
 * Répond en STREAMING (NDJSON, une ligne JSON par évènement) pour un LOT de
 * langues, afin d'afficher l'avancement en temps réel côté client. Chaque langue
 * émet un évènement dès que sa fiche (aso) ou ses screenshots (shots) sont prêts,
 * au lieu d'attendre la fin du lot (~120s de silence sinon).
 *
 * Gain structurel: étant une route (fetch) et non une server action, le client
 * lance plusieurs lots EN PARALLÈLE (invocations serverless séparées).
 *
 * Le `Promise.all` ci-dessous ne fait PLUS tourner aso et shots ensemble: le
 * client appelle cette route deux fois, d'abord avec `includeShots:false` pour
 * toutes les langues, puis avec `includeAso:false` (cf. generate-cta.tsx). Une
 * sortie décochée résout immédiatement sur `skipped`. Le `Promise.all` reste
 * parce qu'il exprime le scope, pas parce qu'il gagne du temps: mélanger un
 * rendu satori (synchrone, bloque la boucle) et une attente OpenAI dans la même
 * lambda affamait les téléchargements de polices.
 *
 * Évènements émis (un objet JSON par ligne):
 *  { type: "aso",   locale, phase: "start" | "done", ok?, error? }   fiche
 *  { type: "shots", locale, phase: "start" | "done", ok?, error? }   screenshots
 *  { type: "done",  aso: {...}, shots: {...} }   récapitulatif de fin de lot
 *  { type: "fatal", error }                 échec bloquant (auth, projet, etc.)
 *
 * "start" est émis dès qu'une langue commence sa tâche (le client affiche une
 * ligne avec spinner), "done" quand elle finit (le client met la ligne à jour).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;

  let locales: string[] | undefined;
  // Scope de génération: par défaut les deux (rétro-compat des appels qui
  // n'envoient pas ces champs). Le CTA laisse l'utilisateur décocher une sortie
  // pour ne dépenser que les crédits voulus.
  let includeAso = true;
  let includeShots = true;
  try {
    const body = (await request.json()) as {
      locales?: unknown;
      includeAso?: unknown;
      includeShots?: unknown;
    };
    if (Array.isArray(body.locales)) {
      locales = body.locales.filter((l): l is string => typeof l === "string");
    }
    if (typeof body.includeAso === "boolean") includeAso = body.includeAso;
    if (typeof body.includeShots === "boolean") includeShots = body.includeShots;
  } catch {
    locales = undefined;
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
          // Client déconnecté: on ignore, la génération serveur continue.
        }
      };

      try {
        // Défensif: le CTA désactive déjà le bouton quand aucune sortie n'est
        // cochée. On coupe court sans lancer de pipeline ni débiter.
        if (!includeAso && !includeShots) {
          send({ type: "fatal", error: "No output selected." });
          return;
        }

        // Résultat neutre pour une sortie décochée: ne PAS appeler le générateur
        // = ne rien débiter (le spend est atomique par langue à l'intérieur).
        const skipped: AsoGenerationResult = { done: [], failed: [] };

        const [aso, shots] = await Promise.all([
          includeAso
            ? generateAso({
                projectId,
                locales,
                onProgress: (locale, phase, ok, error) =>
                  send({ type: "aso", locale, phase, ok, error }),
              })
            : Promise.resolve(skipped),
          // Screenshots: échec toléré (sans captures uploadées, l'action répond
          // « Aucun screenshot »). La fiche reste le livrable bloquant quand elle
          // est demandée; en screenshots seuls, le client remonte l'erreur.
          includeShots
            ? generateProjectScreenshots({
                projectId,
                locales,
                onProgress: (locale, phase, ok, error) =>
                  send({ type: "shots", locale, phase, ok, error }),
              }).catch((e) => ({
                error: e instanceof Error ? e.message : "Screenshots failed.",
                done: [] as string[],
                failed: [] as { locale: string; error: string }[],
              }))
            : Promise.resolve(skipped),
        ]);

        send({
          type: "done",
          aso: { done: aso.done, failed: aso.failed, error: aso.error ?? null },
          shots: { done: shots.done, failed: shots.failed, error: shots.error ?? null },
        });
      } catch (e) {
        send({ type: "fatal", error: e instanceof Error ? e.message : "Generation failed." });
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
