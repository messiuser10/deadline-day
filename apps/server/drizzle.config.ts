import { defineConfig } from 'drizzle-kit';

// SQLite (default runtime). Migrations are generated into drizzle/sqlite.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle/sqlite',
});
