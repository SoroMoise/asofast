"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO: forward to an error-tracking service.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight">An error occurred</h1>
      <p className="max-w-md text-muted-foreground">
        Something went wrong. Try again, or come back later.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
