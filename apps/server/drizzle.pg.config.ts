import { defineConfig } from 'drizzle-kit';

// Postgres mirror of the same schema. Migrations are generated into drizzle/pg.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.pg.ts',
  out: './drizzle/pg',
});
