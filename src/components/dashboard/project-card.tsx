import Link from "next/link";

import { DeleteProjectButton } from "@/components/dashboard/delete-project-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { STORE_LABELS } from "@/lib/constants";
import { storeIconUrl } from "@/lib/store-icons";
import type { Project } from "@/types";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        {project.icon_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- icônes stores externes, domaines multiples
          <img
            src={storeIconUrl(project.icon_url)}
            alt=""
            className="h-10 w-10 shrink-0 rounded-lg border"
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle className="truncate">{project.app_name ?? project.name}</CardTitle>
          <CardDescription className="truncate">
            {STORE_LABELS[project.store]} · {project.store_identifier}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Source language: {project.source_locale}
        </p>
        {!project.published ? (
          <p className="mt-1 text-xs text-muted-foreground">Not published yet</p>
        ) : null}
      </CardContent>
      <CardFooter className="gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${project.id}`}>Open</Link>
        </Button>
        <DeleteProjectButton projectId={project.id} />
      </CardFooter>
    </Card>
  );
}
