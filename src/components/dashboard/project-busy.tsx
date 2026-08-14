"use client";

import * as React from "react";

/**
 * Verrou global de la page projet, levé UNIQUEMENT par les opérations lourdes
 * qui lisent tout l'état du projet (génération des fiches, publication): elles
 * appellent start()/end() et figent alors toutes les cartes. Les petites
 * éditions (features, compétiteurs, langues, screenshots, icône, fiche par
 * langue) ne lèvent PAS ce verrou: chaque carte ne désactive que ses propres
 * champs via son état local, tout en respectant `busy` quand une opération
 * lourde tourne. Compteur pour tolérer des acquisitions imbriquées. Hors
 * provider (ex: wizard), busy reste false et start/end sont des no-ops.
 */
const ProjectBusyContext = React.createContext<{
  busy: boolean;
  start: () => void;
  end: () => void;
  /**
   * Signal étroit: un enregistrement des langues cibles est en vol. Ne fige PAS
   * la page (contrairement à `busy`); sert uniquement à désactiver la génération
   * des fiches tant que la liste des langues n'est pas commitée (sinon on
   * générerait sur un `target_locales` en cours d'écriture).
   */
  localesSaving: boolean;
  startLocalesSave: () => void;
  endLocalesSave: () => void;
  /**
   * Sélection de langues LIVE partagée par la carte Langues. Permet au CTA de
   * génération d'afficher le nombre de langues sélectionnées immédiatement, sans
   * attendre le save + router.refresh (source de désynchro du compteur du
   * bouton). `null` = la carte Langues n'est pas montée: le CTA retombe sur les
   * langues serveur.
   */
  selectedLocales: string[] | null;
  setSelectedLocales: (locales: string[] | null) => void;
  /**
   * Nombre de captures sources téléphone LIVE, publié par la carte Screenshots.
   * Sans lui, le CTA jugerait sur un compte serveur figé au chargement: un
   * upload (client, sans router.refresh) laisserait « Marketing screenshots »
   * désactivé, et une suppression le laisserait cochable pour rien. `null` = la
   * carte n'est pas montée: le CTA retombe sur le compte serveur.
   */
  sourceShotCount: number | null;
  setSourceShotCount: (count: number | null) => void;
}>({
  busy: false,
  start: () => {},
  end: () => {},
  localesSaving: false,
  startLocalesSave: () => {},
  endLocalesSave: () => {},
  selectedLocales: null,
  setSelectedLocales: () => {},
  sourceShotCount: null,
  setSourceShotCount: () => {},
});

export function ProjectBusyProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = React.useState(0);
  const start = React.useCallback(() => setCount((c) => c + 1), []);
  const end = React.useCallback(() => setCount((c) => Math.max(0, c - 1)), []);

  const [localesCount, setLocalesCount] = React.useState(0);
  const startLocalesSave = React.useCallback(() => setLocalesCount((c) => c + 1), []);
  const endLocalesSave = React.useCallback(
    () => setLocalesCount((c) => Math.max(0, c - 1)),
    []
  );

  const [selectedLocales, setSelectedLocales] = React.useState<string[] | null>(null);
  const [sourceShotCount, setSourceShotCount] = React.useState<number | null>(null);

  const value = React.useMemo(
    () => ({
      busy: count > 0,
      start,
      end,
      localesSaving: localesCount > 0,
      startLocalesSave,
      endLocalesSave,
      selectedLocales,
      setSelectedLocales,
      sourceShotCount,
      setSourceShotCount,
    }),
    [
      count,
      start,
      end,
      localesCount,
      startLocalesSave,
      endLocalesSave,
      selectedLocales,
      sourceShotCount,
    ]
  );
  return (
    <ProjectBusyContext.Provider value={value}>
      {children}
    </ProjectBusyContext.Provider>
  );
}

export function useProjectBusy() {
  return React.useContext(ProjectBusyContext);
}
