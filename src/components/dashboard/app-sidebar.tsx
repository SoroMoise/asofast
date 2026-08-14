import Link from "next/link";

import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { APP_VERSION } from "@/config/version";

const links = [
  { title: "My projects", href: "/" },
];

const linkClasses =
  "block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function AppSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
      <div className="flex h-14 items-center border-b px-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          {siteConfig.name}
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={linkClasses}>
            {link.title}
          </Link>
        ))}
      </nav>
      <div className="border-t p-3">
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/#nouveau-projet">New project</Link>
        </Button>
      </div>
      {/* Pied de sidebar: contact + tag de version (stampé au build, cf.
          next.config.ts). Registre discret, sous la CTA principale. */}
      <div className="flex flex-col gap-2 border-t p-3">
        <Button asChild variant="ghost" size="sm" className="w-full">
          <a href={`mailto:${siteConfig.email}`}>Contact</a>
        </Button>
        <p className="text-center text-xs tabular-nums text-muted-foreground">
          {APP_VERSION}
        </p>
      </div>
    </aside>
  );
}
