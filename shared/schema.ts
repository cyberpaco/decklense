import { pgTable, text, varchar, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const decks = pgTable("decks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  shareToken: varchar("share_token", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const deckCards = pgTable("deck_cards", {
  id: varchar("id", { length: 36 }).primaryKey(),
  deckId: varchar("deck_id", { length: 36 }).notNull(),
  setCode: text("set_code").notNull(),
  collectorNumber: text("collector_number").notNull(),
  quantity: integer("quantity").notNull().default(1),
  cardName: text("card_name"),
  typeLine: text("type_line"),
  manaCost: text("mana_cost"),
  cmc: real("cmc"),
  rarity: text("rarity"),
  imageUri: text("image_uri"),
  scryfallId: text("scryfall_id"),
  colors: text("colors").array(),
  priceUsd: text("price_usd"),
  combo: text("combo"),
  isDeleted: boolean("is_deleted").notNull().default(false),
});

export const insertDeckSchema = createInsertSchema(decks).omit({ createdAt: true });
export const insertDeckCardSchema = createInsertSchema(deckCards);

export type InsertDeck = z.infer<typeof insertDeckSchema>;
export type InsertDeckCard = z.infer<typeof insertDeckCardSchema>;
export type Deck = typeof decks.$inferSelect;
export type DeckCard = typeof deckCards.$inferSelect;

export * from "./models/auth";
