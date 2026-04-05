import { db } from "./db";
import { decks, deckCards } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Deck, InsertDeck, DeckCard, InsertDeckCard } from "@shared/schema";

export interface IStorage {
  getDecks(userId: string): Promise<Deck[]>;
  getDeck(id: string, userId: string): Promise<Deck | undefined>;
  getDeckByShareToken(token: string): Promise<Deck | undefined>;
  createDeck(deck: InsertDeck): Promise<Deck>;
  updateDeck(id: string, userId: string, updates: Partial<InsertDeck>): Promise<Deck | undefined>;
  deleteDeck(id: string, userId: string): Promise<boolean>;
  updateDeckStatus(id: string, userId: string, isDeleted: boolean): Promise<Deck | undefined>;

  getDeckCards(deckId: string): Promise<DeckCard[]>;
  upsertDeckCard(card: InsertDeckCard): Promise<DeckCard>;
  updateDeckCardQuantity(id: string, quantity: number): Promise<DeckCard | undefined>;
  updateDeckCard(id: string, updates: Partial<InsertDeckCard>): Promise<DeckCard | undefined>;
  updateDeckCardStatus(id: string, isDeleted: boolean): Promise<DeckCard | undefined>;
  removeDeckCard(id: string): Promise<boolean>;
}

class DrizzleStorage implements IStorage {
  async getDecks(userId: string): Promise<Deck[]> {
    return db.select().from(decks).where(eq(decks.userId, userId));
  }

  async getDeck(id: string, userId: string): Promise<Deck | undefined> {
    const [deck] = await db.select().from(decks)
      .where(and(eq(decks.id, id), eq(decks.userId, userId)));
    return deck;
  }

  async getDeckByShareToken(token: string): Promise<Deck | undefined> {
    const [deck] = await db.select().from(decks)
      .where(eq(decks.shareToken, token));
    return deck;
  }

  async createDeck(deck: InsertDeck): Promise<Deck> {
    const [d] = await db.insert(decks).values({
      ...deck,
      id: deck.id ?? randomUUID(),
    }).returning();
    return d;
  }

  async updateDeck(id: string, userId: string, updates: Partial<InsertDeck>): Promise<Deck | undefined> {
    const [d] = await db.update(decks)
      .set(updates)
      .where(and(eq(decks.id, id), eq(decks.userId, userId)))
      .returning();
    return d;
  }

  async deleteDeck(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(decks)
      .where(and(eq(decks.id, id), eq(decks.userId, userId)))
      .returning();
    if (result.length > 0) {
      await db.delete(deckCards).where(eq(deckCards.deckId, id));
      return true;
    }
    return false;
  }

  async updateDeckStatus(id: string, userId: string, isDeleted: boolean): Promise<Deck | undefined> {
    const [d] = await db.update(decks)
      .set({ isDeleted })
      .where(and(eq(decks.id, id), eq(decks.userId, userId)))
      .returning();
    return d;
  }

  async getDeckCards(deckId: string): Promise<DeckCard[]> {
    return db.select().from(deckCards).where(eq(deckCards.deckId, deckId));
  }

  async upsertDeckCard(card: InsertDeckCard): Promise<DeckCard> {
    // If same set+number already in deck, increment quantity
    const [existing] = await db.select().from(deckCards).where(
      and(
        eq(deckCards.deckId, card.deckId),
        eq(deckCards.setCode, card.setCode),
        eq(deckCards.collectorNumber, card.collectorNumber),
      )
    );
    if (existing) {
      const [updated] = await db.update(deckCards)
        .set({ quantity: existing.quantity + 1 })
        .where(eq(deckCards.id, existing.id))
        .returning();
      return updated;
    }
    const [inserted] = await db.insert(deckCards).values({
      ...card,
      id: card.id ?? randomUUID(),
      quantity: card.quantity ?? 1,
    }).returning();
    return inserted;
  }

  async updateDeckCardQuantity(id: string, quantity: number): Promise<DeckCard | undefined> {
    const [updated] = await db.update(deckCards)
      .set({ quantity })
      .where(eq(deckCards.id, id))
      .returning();
    return updated;
  }

  async updateDeckCard(id: string, updates: Partial<InsertDeckCard>): Promise<DeckCard | undefined> {
    const [updated] = await db.update(deckCards)
      .set(updates)
      .where(eq(deckCards.id, id))
      .returning();
    return updated;
  }

  async updateDeckCardStatus(id: string, isDeleted: boolean): Promise<DeckCard | undefined> {
    const [updated] = await db.update(deckCards)
      .set({ isDeleted })
      .where(eq(deckCards.id, id))
      .returning();
    return updated;
  }

  async removeDeckCard(id: string): Promise<boolean> {
    const result = await db.delete(deckCards).where(eq(deckCards.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DrizzleStorage();
