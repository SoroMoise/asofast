declare module "*.png" {
  const value: import("next/image").StaticImageData;
  export default value;
}

declare module "*.jpg" {
  const value: import("next/image").StaticImageData;
  export default value;
}

declare module "*.jpeg" {
  const value: import("next/image").StaticImageData;
  export default value;
}

declare module "better-sqlite3" {
  const Database: new (path: string) => {
    prepare: (sql: string) => {
      run: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => Record<string, unknown> | undefined;
      all: (...params: unknown[]) => Record<string, unknown>[];
    };
    exec: (sql: string) => void;
    pragma: (pragma: string) => unknown;
    close: () => void;
  };
  export default Database;
}

declare module "google-play-scraper" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function app(params: Record<string, any>): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function search(params: Record<string, any>): Promise<any[]>;
}
