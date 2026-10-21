import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { Store } from "../../src/data/db";
import type { Scope } from "../../src/core/models";

/** Real local SQLite SQL behind the small D1 surface used by the repository. */
export async function localDatabase(scope: Scope = "production", team?: string) {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new NodeURL("../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new NodeURL(name, directory), "utf8"));
  }
  let reads = 0, writes = 0, failWrites = false;
  class Statement {
    constructor(readonly sql: string, readonly args: SQLInputValue[] = []) {}
    bind(...args: unknown[]) { return new Statement(this.sql, args as SQLInputValue[]) as unknown as D1PreparedStatement; }
    execute() {
      const statement = sqlite.prepare(this.sql);
      if (statement.columns().length) {
        reads++;
        return { success: true, results: statement.all(...this.args), meta: { changes: 0 } };
      }
      if (failWrites) throw new Error("Synthetic D1 write failure");
      writes++;
      const result = statement.run(...this.args);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async first<T>(column?: string): Promise<T | null> {
      const row = this.execute().results[0] as Record<string, unknown> | undefined;
      return (row ? column ? row[column] : row : null) as T | null;
    }
    async all() { return this.execute(); }
    async run() { return this.execute(); }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql) as unknown as D1PreparedStatement,
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(s => (s as unknown as Statement).execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  const store = new Store(db, scope);
  await store.initialize(team);
  return { db, store, sqlite, counts: () => ({ reads, writes }), failWrites: (value: boolean) => { failWrites = value; }, close: () => sqlite.close() };
}
