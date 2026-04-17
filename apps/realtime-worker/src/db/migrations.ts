export function loadDrizzleMigrations() {
  const migrationFiles = import.meta.glob("./migrations/**/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const migrations: Record<string, string> = {};

  for (const [path, query] of Object.entries(migrationFiles)) {
    const parts = path.split("/");
    const key = parts.slice(-2).join("/");
    migrations[key] = query as string;
  }

  return migrations;
}
