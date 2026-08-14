import { cn } from "@/lib/utils";

/**
 * Icônes inline du dashboard (trait 2, currentColor). Toujours aria-hidden:
 * le libellé accessible est porté par le bouton/lien parent.
 */
function base(className?: string) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: cn("h-4 w-4 shrink-0", className),
  };
}

export function IconX({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconCheck({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

/** Chevron bas: bascule d'un bloc repliable (rotation 180 quand ouvert). */
export function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Triangle « ! »: alerte bloquante (pas une info neutre). */
export function IconWarning({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/**
 * Pastille d'alerte: cercle plein (currentColor) + « ! » blanc. Contrairement
 * aux icônes en trait, le fond plein reste lisible sur n'importe quel fond
 * d'onglet (repos gris ou actif indigo). Colorer via text-destructive.
 */
export function IconAlertBadge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("h-4 w-4 shrink-0", className)}
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M12 7v6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="1.3" fill="#fff" />
    </svg>
  );
}

/** Cercle « i »: pastille d'information neutre (pas d'alerte). */
export function IconInfo({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export function IconUpload({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M12 15V3M7 8l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/** Poignée de drag (grille 6 points). */
export function IconGrip({ className }: { className?: string }) {
  return (
    <svg {...base(className)} fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

export function IconTrendingUp({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M22 7l-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </svg>
  );
}

export function IconSearch({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function IconMessage({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

export function IconZap({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
    </svg>
  );
}

export function IconTarget({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

export function IconImage({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}

export function IconLayoutGrid({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function IconGlobe({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 3.6 9A14 14 0 0 1 12 21 14 14 0 0 1 8.4 12 14 14 0 0 1 12 3z" />
    </svg>
  );
}

export function IconEye({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconWallet({ className }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}
