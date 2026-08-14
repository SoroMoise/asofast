/**
 * Base de données SQLite locale — couche d'accès unique.
 * Remplaçant de Supabase pour l'ASOFAST 100% local.
 *
 * Conventions :
 * - Toutes les dates sont en ISO 8601 UTC (strftime).
 * - Les champs JSON (jsonb en Postgres) sont des TEXT sérialisés.
 * - Les tableaux Postgres (text[]) sont des TEXT JSON array sérialisés.
 * - Pas de notion d'utilisateur : user_id est fixé à 'local'.
 */

import Database from "better-sqlite3";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Data directory : ./data/ à la racine du projet.
const DATA_DIR = path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "asofast.db");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * Initialise la base de données en exécutant le schéma SQL si les tables
 * n'existent pas encore. Appelé au démarrage côté serveur.
 */
export function initDatabase(): void {
  const schemaPath = path.join(process.cwd(), "src/lib/db/schema.sql");
  if (!existsSync(schemaPath)) return;
  const sql = readFileSync(schemaPath, "utf-8");
  db.exec(sql);
}

// ============================================================================
// Helpers — Projects
// ============================================================================

export const listProjects = (): Record<string, unknown>[] =>
  db.prepare("select * from projects order by created_at desc").all();

export const getProject = (id: string): Record<string, unknown> | undefined =>
  db.prepare("select * from projects where id = ?").get(id) as Record<string, unknown> | undefined;

export const createProject = (input: Record<string, unknown>): { id: string } => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    insert into projects (id, user_id, name, store, store_identifier, app_name, developer_name, icon_url, competitors, target_locales, created_at, updated_at)
    values (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.store,
    input.store_identifier,
    input.app_name ?? null,
    input.developer_name ?? null,
    input.icon_url ?? null,
    JSON.stringify(input.competitors ?? []),
    JSON.stringify(input.target_locales ?? []),
    now,
    now,
  );
  return { id };
};

export const updateProject = (id: string, patch: Record<string, unknown>): void => {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id" || key === "created_at") continue;
    // Sérialiser les champs qui étaient jsonb/text[] en Postgres
    if (["competitors", "target_locales", "features", "screenshot_captions", "screenshot_captions_tablet", "competitor_keywords_en"].includes(key)) {
      sets.push(`${key} = ?`);
      values.push(JSON.stringify(value));
    } else {
      sets.push(`${key} = ?`);
      values.push(value ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`update projects set ${sets.join(", ")} where id = ?`).run(...values);
};

export const deleteProject = (id: string): void => {
  db.prepare("delete from projects where id = ?").run(id);
};

// ============================================================================
// Helpers — Listings
// ============================================================================

export const listListings = (projectId: string): Record<string, unknown>[] =>
  db.prepare("select * from listings where project_id = ? order by locale").all(projectId) as Record<string, unknown>[];

export const getListing = (projectId: string, locale: string): Record<string, unknown> | undefined =>
  db.prepare("select * from listings where project_id = ? and locale = ?").get(projectId, locale) as Record<string, unknown> | undefined;

export const upsertListing = (projectId: string, locale: string, patch: Record<string, unknown>): void => {
  const existing = getListing(projectId, locale);
  const now = new Date().toISOString();
  if (existing) {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (key === "id" || key === "project_id" || key === "locale" || key === "created_at") continue;
      if (["screenshots", "screenshots_tablet", "keyword_base"].includes(key)) {
        sets.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    values.push(now);
    values.push(projectId);
    values.push(locale);
    db.prepare(`update listings set ${sets.join(", ")} where project_id = ? and locale = ?`).run(...values);
  } else {
    const id = crypto.randomUUID();
    db.prepare(`
      insert into listings (id, project_id, locale, title, subtitle, short_description, description, keywords, keyword_base, screenshots, screenshots_tablet, whats_new, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      locale,
      patch.title ?? "",
      patch.subtitle ?? "",
      patch.short_description ?? "",
      patch.description ?? "",
      patch.keywords ?? "",
      JSON.stringify(patch.keyword_base ?? []),
      JSON.stringify(patch.screenshots ?? []),
      JSON.stringify(patch.screenshots_tablet ?? []),
      patch.whats_new ?? null,
      now,
      now,
    );
  }
};

export const deleteListing = (projectId: string, locale: string): void => {
  db.prepare("delete from listings where project_id = ? and locale = ?").run(projectId, locale);
};

// ============================================================================
// Helpers — Generations
// ============================================================================

export const listGenerations = (projectId: string): Record<string, unknown>[] =>
  db.prepare("select * from generations where project_id = ? order by created_at desc").all(projectId) as Record<string, unknown>[];

export const getGeneration = (id: string): Record<string, unknown> | undefined =>
  db.prepare("select * from generations where id = ?").get(id) as Record<string, unknown> | undefined;

export const insertGeneration = (input: Record<string, unknown>): { id: string } => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    insert into generations (id, project_id, type, status, input, target_locale, created_at, updated_at)
    values (?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    id,
    input.project_id,
    input.type,
    JSON.stringify(input.input ?? {}),
    input.target_locale ?? null,
    now,
    now,
  );
  return { id };
};

export const updateGeneration = (id: string, patch: Record<string, unknown>): void => {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id" || key === "created_at") continue;
    if (key === "input" || key === "output") {
      sets.push(`${key} = ?`);
      values.push(typeof value === "string" ? value : JSON.stringify(value));
    } else {
      sets.push(`${key} = ?`);
      values.push(value ?? null);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`update generations set ${sets.join(", ")} where id = ?`).run(...values);
};

// ============================================================================
// Helpers — Store Credentials
// ============================================================================

export const getStoreCredentials = (projectId: string, store: string): Record<string, unknown> | undefined =>
  db.prepare("select * from store_credentials where project_id = ? and store = ?").get(projectId, store) as Record<string, unknown> | undefined;

export const saveStoreCredentials = (projectId: string, store: string, encryptedPayload: string): void => {
  const existing = getStoreCredentials(projectId, store);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare("update store_credentials set encrypted_payload = ?, updated_at = ? where id = ?").run(encryptedPayload, now, existing.id);
  } else {
    const id = crypto.randomUUID();
    db.prepare("insert into store_credentials (id, project_id, store, encrypted_payload, connected_at, updated_at) values (?, ?, ?, ?, ?, ?)").run(id, projectId, store, encryptedPayload, now, now);
  }
};

export const deleteStoreCredentials = (projectId: string, store: string): void => {
  db.prepare("delete from store_credentials where project_id = ? and store = ?").run(projectId, store);
};

export const isStoreConnected = (projectId: string, store: string): boolean =>
  !!getStoreCredentials(projectId, store);

// ============================================================================
// Helpers — Prompts
// ============================================================================

export const listPrompts = (): Record<string, unknown>[] =>
  db.prepare("select * from prompts where is_active = 1 order by name").all() as Record<string, unknown>[];

export const getPrompt = (name: string): Record<string, unknown> | undefined =>
  db.prepare("select * from prompts where name = ? and is_active = 1").get(name) as Record<string, unknown> | undefined;

export const upsertPrompt = (name: string, input: { system?: string; user?: string; version?: number }): void => {
  const existing = db.prepare("select id from prompts where name = ?").get(name) as Record<string, unknown> | undefined;
  const now = new Date().toISOString();
  if (existing) {
    db.prepare("update prompts set system = ?, user = ?, version = ?, is_active = 1, updated_at = ? where id = ?").run(
      input.system ?? "",
      input.user ?? "",
      input.version ?? 1,
      now,
      existing.id,
    );
  } else {
    const id = crypto.randomUUID();
    db.prepare("insert into prompts (id, name, system, user, version, is_active, created_at, updated_at) values (?, ?, ?, ?, ?, 1, ?, ?)").run(
      id, name, input.system ?? "", input.user ?? "", input.version ?? 1, now, now,
    );
  }
};