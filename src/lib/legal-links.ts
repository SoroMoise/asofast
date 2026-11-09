/**
 * Liens « site + légal » d'un projet, ajoutés en fin de description de chaque
 * langue (référencement: l'URL du site citée dans la fiche store).
 *
 * L'utilisateur saisit l'URL de base du site, puis le chemin (ou une URL
 * complète) de la politique de confidentialité et des conditions
 * d'utilisation. On stocke les URL complètes résolues: le reste du code
 * (champ privacy App Store, lignes de description) n'a jamais à recomposer.
 */

export type LegalLinks = {
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  termsUrl?: string;
};

export type LegalLabels = {
  website: string;
  privacy: string;
  terms: string;
};

export const DEFAULT_LEGAL_LABELS: LegalLabels = {
  website: "Website",
  privacy: "Privacy Policy",
  terms: "Terms of Use",
};

/** URL de base normalisée: espaces et `/` finaux retirés. */
export function normalizeBaseUrl(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

export function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** URL parsable dont le protocole est http(s). */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Résout un lien légal saisi par l'utilisateur: une URL complète est gardée
 * telle quelle, un chemin (`/privacy`, `privacy.html`) est collé à l'URL de
 * base. Jointure par chaîne volontairement (pas `new URL(path, base)`): avec
 * une base `https://site.com/app`, `/privacy` donne `https://site.com/app/privacy`,
 * ce que l'utilisateur lit dans l'aperçu. Renvoie "" si rien n'est saisi ou si
 * un chemin est fourni sans base.
 */
export function resolveLegalUrl(base: string, value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (isAbsoluteHttpUrl(v)) return v;
  const b = normalizeBaseUrl(base);
  if (!b) return "";
  return `${b}/${v.replace(/^\/+/, "")}`;
}

/** Inverse de resolveLegalUrl pour l'affichage: le chemin si l'URL est sous la base. */
export function relativeToBase(base: string, full: string): string {
  const b = normalizeBaseUrl(base);
  const f = full.trim();
  if (b && f.toLowerCase().startsWith(`${b.toLowerCase()}/`)) {
    return f.slice(b.length);
  }
  return f;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Le texte contient-il CETTE URL exactement (et pas seulement comme préfixe
 * d'une autre) ? `includes` ne suffit pas pour l'URL du site: elle est préfixe
 * de l'URL de la privacy policy, sa ligne serait sautée à tort. Un `/` final et
 * une ponctuation de fin de phrase sont tolérés.
 */
export function containsUrl(text: string, url: string): boolean {
  const u = normalizeBaseUrl(url);
  if (!u) return false;
  // Sensible à la casse: le chemin d'une URL l'est (`/Privacy` ≠ `/privacy`).
  const re = new RegExp(`${escapeRegExp(u)}/?(?![\\w/~%?#=&+-]|\\.\\w)`);
  return re.test(text);
}

/**
 * Lignes `label: URL` manquantes dans la description, dans l'ordre site,
 * confidentialité, conditions. Une URL vide ou déjà présente est sautée; deux
 * liens identiques ne produisent qu'une ligne.
 */
export function missingLegalLines(
  description: string,
  links: LegalLinks,
  labels: Partial<LegalLabels> = {},
  separator = ": "
): string[] {
  // Un libellé absent ou vide (modèle muet) retombe sur le libellé anglais.
  const l: LegalLabels = {
    website: labels.website?.trim() || DEFAULT_LEGAL_LABELS.website,
    privacy: labels.privacy?.trim() || DEFAULT_LEGAL_LABELS.privacy,
    terms: labels.terms?.trim() || DEFAULT_LEGAL_LABELS.terms,
  };
  const entries: [string, string | undefined][] = [
    [l.website, links.websiteUrl && normalizeBaseUrl(links.websiteUrl)],
    [l.privacy, links.privacyPolicyUrl?.trim()],
    [l.terms, links.termsUrl?.trim()],
  ];
  const lines: string[] = [];
  const seen: string[] = [];
  for (const [label, url] of entries) {
    if (!url) continue;
    if (containsUrl(description, url)) continue;
    if (seen.some((s) => normalizeBaseUrl(s).toLowerCase() === normalizeBaseUrl(url).toLowerCase())) {
      continue;
    }
    seen.push(url);
    lines.push(`${label}${separator}${url}`);
  }
  return lines;
}

/** Les liens d'un projet tels que stockés en base. */
export function projectLegalLinks(project: {
  website_url?: string | null;
  privacy_policy_url?: string | null;
  terms_url?: string | null;
}): LegalLinks {
  return {
    websiteUrl: (project.website_url ?? "").trim(),
    privacyPolicyUrl: (project.privacy_policy_url ?? "").trim(),
    termsUrl: (project.terms_url ?? "").trim(),
  };
}
