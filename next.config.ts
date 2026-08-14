import type { NextConfig } from "next";
import { createRequire } from "node:module";

// Tag de version affiché en bas de la sidebar. Calculé à l'exécution de `next
// build`, donc il change à chaque déploiement: `v<semver> · <YYMMDD.HHMM UTC>`.
// Inliné plus bas via `env` (remplacement statique de la référence dans le
// bundle), il ne dépend d'aucune var d'env runtime. Cosmétique: la computation
// ne doit JAMAIS faire échouer le build, d'où le repli.
function appVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const { version } = require("./package.json") as { version: string };
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const buildId =
      `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
    return `v${version} · ${buildId}`;
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  // Inliné au build (DefinePlugin): la sidebar (Server Component) lit la valeur
  // figée du déploiement, sans lookup runtime. Généré ici, donc PAS une var à
  // déclarer côté Vercel.
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
  },
  reactStrictMode: true,
  // sharp (libvips) and @resvg/resvg-js (napi) are native modules. Bundling them
  // breaks the binary resolution; keep them external so file tracing ships the
  // platform-specific package instead.
  serverExternalPackages: ["sharp", "@resvg/resvg-js", "better-sqlite3"],
  // Pin the workspace root to this project (a parent-directory lockfile exists),
  // so output file tracing resolves correctly.
  outputFileTracingRoot: import.meta.dirname,
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
