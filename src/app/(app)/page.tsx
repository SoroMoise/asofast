import type { Metadata } from "next";

import { ProjectWizard } from "@/components/dashboard/project-wizard";
import { ProjectCard } from "@/components/dashboard/project-card";
import { ProjectsEmptyState } from "@/components/dashboard/projects-empty-state";
import { listProjects } from "@/lib/db";
import { parseProject } from "@/lib/db/parse";

export const metadata: Metadata = {
  title: "My projects",
};

export const maxDuration = 300;

export default async function DashboardPage() {
  const rows = listProjects();
  const projects = rows.map((r) => parseProject(r));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">My projects</h1>
        <p className="text-sm text-muted-foreground">
          Local ASO workspace
        </p>
      </div>

      <ProjectWizard />

      {projects && projects.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <ProjectsEmptyState />
      )}
    </div>
  );
}
