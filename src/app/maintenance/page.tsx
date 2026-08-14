import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scheduled maintenance",
  description: "ASOFAST is temporarily unavailable while we ship an update.",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        Scheduled maintenance
      </p>
      <h1 className="text-3xl font-bold tracking-tight">
        ASOFAST is back shortly
      </h1>
      <p className="max-w-md text-muted-foreground">
        We are shipping an update. Generation and publishing are paused for a
        few minutes. Nothing you already generated is lost.
      </p>
      <p className="text-xs text-muted-foreground">
        Refresh this page to check again.
      </p>
    </main>
  );
}
