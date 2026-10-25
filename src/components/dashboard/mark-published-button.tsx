"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { markProjectPublished } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Projet créé "pas encore publié": la page le vérifie automatiquement sur le
 * store à chaque chargement; ce bouton force la vérification, et permet de le
 * marquer publié même si le store ne l'expose pas encore.
 */
export function MarkPublishedButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  async function run(force: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await markProjectPublished({ projectId, force });
      if (res.error) {
        setError(res.error);
        setNotFound(Boolean(res.notFound));
        return;
      }
      setNotFound(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the project.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Not published yet
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(false)}
        >
          {pending ? (
            <>
              <Spinner /> Checking…
            </>
          ) : (
            "My app is live: mark as published"
          )}
        </Button>
        {notFound ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(true)}
          >
            Mark as published anyway
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="max-w-prose text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
