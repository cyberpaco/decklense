import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "sid" VARCHAR NOT NULL PRIMARY KEY,
        "sess" JSONB NOT NULL,
        "expire" TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" ("expire");

      CREATE TABLE IF NOT EXISTS "users" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" VARCHAR UNIQUE,
        "first_name" VARCHAR,
        "last_name" VARCHAR,
        "profile_image_url" VARCHAR,
        "created_at" TIMESTAMP DEFAULT NOW(),
        "updated_at" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "decks" (
        "id" VARCHAR(36) PRIMARY KEY,
        "user_id" VARCHAR(255) NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "created_at" TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "deck_cards" (
        "id" VARCHAR(36) PRIMARY KEY,
        "deck_id" VARCHAR(36) NOT NULL,
        "set_code" TEXT NOT NULL,
        "collector_number" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "card_name" TEXT,
        "type_line" TEXT,
        "mana_cost" TEXT,
        "cmc" REAL,
        "rarity" TEXT,
        "image_uri" TEXT,
        "scryfall_id" TEXT,
        "colors" TEXT[],
        "price_usd" TEXT
      );
    `);
    console.log("Database tables ensured.");
  } catch (err) {
    console.error("Failed to ensure database tables:", err);
    throw err;
  } finally {
    client.release();
  }
}
