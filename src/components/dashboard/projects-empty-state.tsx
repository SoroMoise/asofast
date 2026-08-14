import { Button } from "@/components/ui/button";

export function ProjectsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <h2 className="text-lg font-semibold tracking-tight">
        No projects yet
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Add your App Store or Google Play app in the “New project” block
        above: ASO listings, translations and screenshots follow within a few
        minutes.
      </p>
      <Button asChild variant="outline" size="md">
        <a href="#nouveau-projet">Add my app</a>
      </Button>
    </div>
  );
}
