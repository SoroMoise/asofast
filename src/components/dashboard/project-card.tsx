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
import type { Project } from "@/types";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{project.name}</CardTitle>
        <CardDescription>
          {STORE_LABELS[project.store]} · {project.store_identifier}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Source language: {project.source_locale}
        </p>
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
