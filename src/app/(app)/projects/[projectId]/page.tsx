import Link from "next/link";
import { notFound } from "next/navigation";

import { AppIconUpload } from "@/components/dashboard/app-icon-upload";
import { FeatureGraphicCard } from "@/components/dashboard/feature-graphic-card";
import { CompetitorsEditor } from "@/components/dashboard/competitors-editor";
import { FeaturesEditor } from "@/components/dashboard/features-editor";
import { GenerateCta } from "@/components/dashboard/generate-cta";
import { ListingTabs } from "@/components/dashboard/listing-tabs";
import { LocalesEditor } from "@/components/dashboard/locales-editor";
import { PrivacyPolicyEditor } from "@/components/dashboard/privacy-policy-editor";
import { WhatsNewEditor } from "@/components/dashboard/whats-new-editor";
import { ProjectBusyProvider } from "@/components/dashboard/project-busy";
import { PublishCta } from "@/components/dashboard/publish-cta";
import { ScreenshotGenerator } from "@/components/dashboard/screenshot-generator";
import { StoreConnect } from "@/components/dashboard/store-connect";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { STORE_IDENTIFIER_LABELS, STORE_LABELS } from "@/lib/constants";
import { storeIconUrl } from "@/lib/store-icons";
import { listUserScreenshots, type AppRef } from "@/lib/aso";
import { getProject as dbGetProject, listListings as dbListListings } from "@/lib/db";
import { parseListing, parseProject } from "@/lib/db/parse";
import { isStoreConnected } from "@/lib/publish";

import { connectStore, disconnectStore } from "./actions";

export const maxDuration = 300;

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const project = parseProject(dbGetProject(projectId) ?? {});
  if (!project.id) notFound();

  const listings = dbListListings(projectId).map((r) => parseListing(r));

  const storeConnected = await isStoreConnected(
    { userId: project.user_id, projectId: project.id },
    project.store
  );

  const competitors = (Array.isArray(project.competitors)
    ? project.competitors
    : []) as unknown as AppRef[];

  const sourceOrder = (paths: unknown): string[] =>
    (Array.isArray(paths) ? paths : [])
      .map((c) => (c as { path?: string }).path)
      .filter((p): p is string => typeof p === "string");
  const screenshotOrder = sourceOrder(project.screenshot_captions);
  const screenshotOrderTablet = sourceOrder(project.screenshot_captions_tablet);

  const hasSourceScreenshots = (await listUserScreenshots(project)).length > 0;

  return (
    <ProjectBusyProvider>
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← My projects
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {project.icon_url ? (
          <img
            src={storeIconUrl(project.icon_url)}
            alt=""
            className="h-16 w-16 rounded-2xl border"
          />
        ) : null}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {project.app_name ?? project.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[
              project.developer_name,
              STORE_LABELS[project.store],
              `${STORE_IDENTIFIER_LABELS[project.store]}: ${project.store_identifier}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Key features</CardTitle>
        </CardHeader>
        <CardContent>
          <FeaturesEditor projectId={project.id} initial={project.features ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy policy</CardTitle>
        </CardHeader>
        <CardContent>
          <PrivacyPolicyEditor
            projectId={project.id}
            store={project.store}
            initial={project.privacy_policy_url ?? ""}
          />
        </CardContent>
      </Card>

      {project.store === "appstore" ? (
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s New in This Version</CardTitle>
          </CardHeader>
          <CardContent>
            <WhatsNewEditor projectId={project.id} initial={project.whats_new ?? ""} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            Competitors
            <span aria-hidden="true" className="ml-1 text-destructive">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CompetitorsEditor
            projectId={project.id}
            store={project.store}
            initial={competitors}
            projectIdentifier={project.store_identifier}
          />
        </CardContent>
      </Card>

      {project.store === "playstore" ? (
        <>
          <AppIconUpload projectId={project.id} userId={project.user_id} />
          <FeatureGraphicCard projectId={project.id} userId={project.user_id} />
        </>
      ) : null}

      <ScreenshotGenerator
        projectId={project.id}
        userId={project.user_id}
        store={project.store}
        order={screenshotOrder}
        orderTablet={screenshotOrderTablet}
        bgColor={project.screenshot_bg_color ?? ""}
        textColor={project.screenshot_text_color ?? ""}
        hasSourceScreenshots={hasSourceScreenshots}
      />

      <Card>
        <CardHeader>
          <CardTitle>Languages</CardTitle>
        </CardHeader>
        <CardContent>
          <LocalesEditor
            projectId={project.id}
            store={project.store}
            initial={project.target_locales}
          />
        </CardContent>
      </Card>

      <GenerateCta
        projectId={project.id}
        targetLocales={project.target_locales}
        existingListingLocales={(listings ?? []).map((l) => l.locale)}
        hasCompetitors={competitors.length > 0}
        hasSourceScreenshots={hasSourceScreenshots}
      />

      <ListingTabs
        projectId={project.id}
        store={project.store}
        targetLocales={project.target_locales}
        listings={listings ?? []}
        usesTablet={screenshotOrderTablet.length > 0}
        hasSourceScreenshots={hasSourceScreenshots}
        whatsNewSource={project.whats_new ?? ""}
      />

      <Card id="store" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>Store</CardTitle>
        </CardHeader>
        <CardContent>
          <StoreConnect
            projectId={project.id}
            store={project.store}
            connected={storeConnected}
            connectAction={connectStore}
            disconnectAction={disconnectStore}
          />
        </CardContent>
      </Card>

      <PublishCta
        projectId={project.id}
        store={project.store}
        storeConnected={storeConnected}
        publishableLocales={project.target_locales.filter((l) =>
          (listings ?? []).some((x) => x.locale === l)
        )}
      />
    </div>
    </ProjectBusyProvider>
  );
}
