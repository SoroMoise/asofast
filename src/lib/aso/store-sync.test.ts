import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ updateProject: vi.fn() }));
vi.mock("./lookup", () => ({ lookupApp: vi.fn() }));

import type { Project } from "@/types";

import {
  needsStoreSync,
  resetStoreSyncThrottle,
  syncStoreMetadata,
  syncUnpublishedProjects,
} from "./store-sync";
import type { AppRef } from "./types";

const unpublished = {
  id: "p1",
  name: "https://example.com",
  app_name: "https://example.com",
  store: "playstore",
  store_identifier: "com.example.app",
  developer_name: null,
  icon_url: null,
  published: false,
} as unknown as Project;

const live: AppRef = {
  store: "playstore",
  identifier: "com.example.app",
  name: "Example",
  developer: "Acme",
  icon: "https://play-lh.googleusercontent.com/icon",
};

describe("needsStoreSync", () => {
  it("checks unpublished projects and published ones still missing store metadata", () => {
    expect(needsStoreSync({ published: false, icon_url: null })).toBe(true);
    expect(needsStoreSync({ published: true, icon_url: null })).toBe(true);
    expect(needsStoreSync({ published: true, icon_url: "x" })).toBe(false);
  });
});

describe("syncStoreMetadata", () => {
  beforeEach(() => resetStoreSyncThrottle());

  it("marks the project published and takes the store name once the app is live", async () => {
    const update = vi.fn();
    const synced = await syncStoreMetadata(unpublished, {
      lookup: async () => live,
      update,
    });
    expect(update).toHaveBeenCalledWith("p1", {
      name: "Example",
      app_name: "Example",
      developer_name: "Acme",
      icon_url: live.icon,
      published: 1,
    });
    expect(synced).toMatchObject({ name: "Example", app_name: "Example", published: true });
  });

  it("leaves the project untouched while the app is not on the store", async () => {
    const update = vi.fn();
    const synced = await syncStoreMetadata(unpublished, {
      lookup: async () => {
        throw new Error("App not found");
      },
      update,
    });
    expect(synced).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("throttles automatic checks but not forced ones", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("App not found");
    });
    await syncStoreMetadata(unpublished, { lookup, update: vi.fn() });
    await syncStoreMetadata(unpublished, { lookup, update: vi.fn() });
    expect(lookup).toHaveBeenCalledTimes(1);
    await syncStoreMetadata(unpublished, { lookup, update: vi.fn(), force: true });
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("syncUnpublishedProjects", () => {
  beforeEach(() => resetStoreSyncThrottle());

  it("only looks up projects missing store metadata", async () => {
    const { lookupApp } = await import("./lookup");
    vi.mocked(lookupApp).mockResolvedValue(live);
    const published = { ...unpublished, id: "p2", published: true, icon_url: "x" } as Project;

    const out = await syncUnpublishedProjects([unpublished, published]);
    expect(lookupApp).toHaveBeenCalledTimes(1);
    expect(out[0]).toMatchObject({ name: "Example", published: true });
    expect(out[1]).toBe(published);
  });
});
