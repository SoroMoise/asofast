import type { StorePlatform } from "@/types";

/** App Store Connect API credentials (JWT ES256). */
export type AppStoreCredentials = {
  keyId: string;
  issuerId: string;
  privateKey: string; // .p8 PEM contents
};

/** Google Play Developer API credentials. */
export type PlayStoreCredentials = {
  serviceAccountJson: string; // full service account JSON
};

export type StoreCredentials = AppStoreCredentials | PlayStoreCredentials;

/** Normalized listing metadata to push (from a copy/translation generation). */
export type ListingMetadata = {
  title?: string;
  subtitle?: string;
  promotionalText?: string;
  description?: string;
  keywords?: string[];
  /** App Store release notes ("What's New"), déjà traduites pour la locale. */
  whatsNew?: string;
};

/** A screenshot image (PNG bytes) to push to a listing. */
export type StoreScreenshot = {
  buffer: Buffer;
  fileName: string;
};

/** One locale's listing update: metadata and/or screenshots. */
export type StoreUpdate = {
  locale: string;
  metadata?: ListingMetadata;
  screenshots?: StoreScreenshot[];
  /** iPad (App Store) / tablette 10" (Play Store). */
  screenshotsTablet?: StoreScreenshot[];
  /** Icône 512×512 (Play Store uniquement — l'icône App Store vient du binaire). */
  icon?: StoreScreenshot;
  /** Feature graphic 1024×500 (Play Store, même visuel pour toutes les langues). */
  featureGraphic?: StoreScreenshot;
  /**
   * URL de politique de confidentialité (App Store uniquement): écrite dans le
   * champ dédié d'App Information (`appInfoLocalizations.privacyPolicyUrl`), pas
   * dans la description. Absente = champ laissé tel quel sur le store.
   */
  privacyPolicyUrl?: string;
};

/**
 * Ce que la publication doit réellement pousser. Un bloc à `false` n'est ni LU
 * (aucun download storage) ni envoyé au store: c'est au moment de CONSTRUIRE les
 * updates que le temps se gagne, pas au moment de l'upload. Décocher les
 * screenshots retire ~22 des ~30 appels store par langue, plus les 5 GET
 * storage.
 */
export type PublishScope = {
  /** Titre, sous-titre, description, mots-clés, texte promo. */
  text: boolean;
  /** Frames téléphone + tablette. */
  screenshots: boolean;
  /** Play Store uniquement: icône 512×512 et feature graphic 1024×500. */
  storeAssets: boolean;
  /**
   * App Store uniquement: URL de politique de confidentialité (champ App
   * Information) et release notes « What's New in This Version ». Bloc séparé
   * du texte de fiche parce que c'est le seul à bouger sur une mise à jour de
   * version: on ne repousse pas titre/description/mots-clés pour ça.
   */
  privacyAndWhatsNew: boolean;
};

export type LocaleResult = {
  locale: string;
  updatedFields: string[];
  error?: string;
};

export type PublishResult = {
  store: StorePlatform;
  ok: boolean;
  message: string;
  perLocale: LocaleResult[];
  /**
   * Play Store uniquement: identifiant de l'edit ouvert, à repasser au lot
   * suivant pour partager un seul edit sur toute la publication (commit final).
   */
  editId?: string;
};

/**
 * Callback d'avancement par langue pour le streaming: "start" quand la langue
 * commence sa mise à jour (fiche + upload screenshots), "done" quand elle finit
 * (ok/erreur). La phase commit du store n'émet rien (globale, pas par langue).
 */
export type PublishProgress = (
  locale: string,
  phase: "start" | "done",
  ok?: boolean,
  error?: string
) => void;
