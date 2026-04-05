import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertDeckSchema, insertDeckCardSchema } from "@shared/schema";
import { randomUUID } from "crypto";
import { setupAuth, isAuthenticated, registerAuthRoutes } from "./replit_integrations/auth";
import sharp from "sharp";

// ── Tesseract singleton ───────────────────────────────────────────────────────
let _ocrWorker: any = null;
let _ocrReady = false;

async function getOCRWorker() {
  if (_ocrWorker && _ocrReady) return _ocrWorker;
  const { createWorker } = await import("tesseract.js");
  _ocrWorker = await (createWorker as any)("eng", 1, { logger: () => {} });
  _ocrReady = true;
  return _ocrWorker;
}
getOCRWorker().catch(() => {});

// ── OCR pipeline helpers (buffer-based) ──────────────────────────────────────

async function normBuf(imgBuf: Buffer): Promise<Buffer> {
  return sharp(imgBuf)
    .resize({ width: 1600, withoutEnlargement: true })
    .grayscale().normalise().sharpen({ sigma: 1.2 }).png().toBuffer();
}

async function threshBuf(imgBuf: Buffer, t: number): Promise<Buffer> {
  return sharp(imgBuf)
    .resize({ width: 1800, withoutEnlargement: true })
    .grayscale().threshold(t).sharpen({ sigma: 1.5 }).png().toBuffer();
}

async function rotBuf(imgBuf: Buffer, deg: number): Promise<Buffer> {
  return sharp(imgBuf)
    .rotate(deg, { background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 1600, withoutEnlargement: true })
    .grayscale().normalise().sharpen({ sigma: 1.2 }).png().toBuffer();
}

async function stripBuf(imgBuf: Buffer, topFrac: number, htFrac: number): Promise<Buffer | null> {
  try {
    const { width: W, height: H } = await sharp(imgBuf).metadata() as { width: number; height: number };
    const top = Math.floor((H ?? 1000) * topFrac);
    const height = Math.max(1, Math.min(Math.floor((H ?? 1000) * htFrac), (H ?? 1000) - top - 1));
    return await sharp(imgBuf)
      .extract({ left: 0, top, width: W ?? 600, height })
      .resize({ width: 1600, withoutEnlargement: true })
      .grayscale().normalise().sharpen({ sigma: 2 }).png().toBuffer();
  } catch { return null; }
}

async function ocr(worker: any, buf: Buffer, psm = "3"): Promise<string> {
  await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", tessedit_char_whitelist: "" });
  return (await worker.recognize(buf)).data.text.trim();
}

// ── Text parser ───────────────────────────────────────────────────────────────

const LANG_CODES = ["EN","DE","FR","IT","ES","PT","JA","KO","RU"];
const NON_SET = new Set([
  ...LANG_CODES,
  "TM","THE","AND","FOR","NOT","LLC","WIZARDS","COAST","HASBRO","MEE","LOTR","MER",
  "ILLUS","ART","BASIC","TOKEN","SAGA","OTHER","FOOD","MANA","LAND","WARD","RANGED",
  "EVEN","GOOD","THEN","NEXT","ALSO","FROM","WITH","THEY","THAT","WHEN","EACH",
  "TYPE","BEEN","WERE","DOES","HAVE","ONCE","ONLY","THAN","THIS","INTO","BOTH",
  "CARD","GAME","PLAY","DIES","LOSE","LIFE","TURN","COPY","GETS","ADDS","CAST",
  "DEAL","DRAW","GAIN","COST","TAKE","MAKE","GIVE","FIND","SHOW","KEEP",
]);
const RULES_START = /^(note|when|you|the|this|each|all|at|on|if|to|a|an|as|and|by|in|of|or|sacrifice|legendary|basic|token|enchantment|instant|sorcery|creature|artifact|planeswalker|land|deathtouch|ward|other|whenever|another|dealt|damage|turn|that|copy|enter|battlefield|type|additional|counter|it|its|your|our|they|from|with|without|is|are|was|may|can|target|until|end|any|gain|life|draw|cast|spell|control|gets|add|tap|untap|pay|cost|effect|ability|treat|choose|plus|remove|step|sep|put|move|return|exile|attach|equip|level)\b/i;
const ARTIST_FIRST = new Set(["JOHN","DAVID","RANDY","MARK","ERIC","ANNA","KATE","MARY","MIKE","CHRIS","ADAM","JAMES","SARA","SEAN","PETE","FRED","GREG","RYAN","LUCA","NOAH"]);
const COLLECTOR_RE = new RegExp(`\\b([A-Z][A-Z0-9]{2,4})[^A-Z0-9]{1,12}(?:${LANG_CODES.join("|")})\\b`);

function parseText(rawText: string, opts: { noName?: boolean } = {}): { name: string; setCode: string; collectorNumber: string; isToken: boolean } {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  let collectorNumber = "", setCode = "", isToken = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    const m = upper.match(/\b([RCUTMLSB]{1,2})\s{1,5}0*(\d{1,4})\b/);
    if (m) {
      const num = parseInt(m[2], 10);
      if (num >= 1 && num <= 1000) { collectorNumber = String(num); if (m[1] === "T") isToken = true; break; }
    }
  }
  if (!collectorNumber) {
    const m = rawText.toUpperCase().match(/\b(\d{1,4})\s*\/\s*\d{2,4}\b/);
    if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 1000) collectorNumber = String(n); }
  }
  if (!collectorNumber) {
    const m = rawText.toUpperCase().match(/(?:COAST|WIZARDS)[^\n]{0,80}?(\d{3,4})\b/);
    if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 1000) collectorNumber = String(n); }
  }

  for (const line of lines) {
    const m = line.toUpperCase().match(COLLECTOR_RE);
    if (m && !NON_SET.has(m[1]) && !/^\d/.test(m[1])) { setCode = m[1].toLowerCase(); break; }
  }

  if (opts.noName) return { name: "", setCode, collectorNumber, isToken };

  let name = "";
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const lineRaw = lines[i];
    if (COLLECTOR_RE.test(lineRaw.toUpperCase())) continue;
    let clean = lineRaw
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^\w\s',\-]/g, " ")
      .replace(/\s{2,}/g, " ").trim();
    clean = clean.replace(/^(?:[0-9A-Za-z]{1,2}\s+)+/, "").trim();
    if (clean.length < 4) continue;
    if (!/[A-Za-z]/.test(clean)) continue;
    if (/^\d/.test(clean)) continue;
    if (RULES_START.test(clean)) continue;
    const words = clean.split(/\s+/);
    if (words.length > 7 || clean.length > 52) continue;
    if ((clean.match(/[A-Za-z]/g) || []).length / clean.length < 0.55) continue;
    if (NON_SET.has(clean.toUpperCase())) continue;
    if (words.length === 2 && ARTIST_FIRST.has(words[0].toUpperCase())) continue;

    let candidate = clean;
    if (/\b(of|the|a|an|and|for|from|to|in|at|on|with)\s*$/i.test(clean) && i + 1 < lines.length) {
      const next = lines[i + 1].replace(/[\u2018\u2019]/g, "'").replace(/[^\w\s',\-]/g, " ").replace(/\s{2,}/g, " ").trim();
      const nextWords = next.split(/\s+/).filter(w => w.length > 1).slice(0, 3);
      if (nextWords.length > 0 && /^[A-Za-z]/.test(nextWords[0])) {
        const joined = clean + " " + nextWords.join(" ");
        candidate = joined.replace(/\s+(when|if|you|this|each|note|whenever|so|he|she)\b.*/i, "").trim();
      }
    }
    candidate = candidate.replace(/\.\s*(When|If|You|This|Each|Note)\s.*/i, "").replace(/[.,;:!?]+$/, "").trim();
    if (candidate.length >= 4 && /[A-Za-z]/.test(candidate)) { name = candidate; break; }
  }

  // Fallback: detect basic land type from short lines (type line OCR)
  if (!name) {
    const BASIC_LANDS = ["Plains","Island","Mountain","Forest","Swamp"];
    for (const line of lines) {
      const shortClean = line.replace(/[^\w\s]/g, " ").replace(/\s{2,}/g, " ").trim();
      if (shortClean.length >= 4 && shortClean.length <= 15) {
        for (const land of BASIC_LANDS) {
          if (new RegExp(`\\b${land}\\b`, "i").test(shortClean)) { name = land; break; }
        }
      }
      if (name) break;
    }
  }

  return { name, setCode, collectorNumber, isToken };
}

function merge(a: ReturnType<typeof parseText>, b: ReturnType<typeof parseText>): ReturnType<typeof parseText> {
  return { name: a.name || b.name, setCode: a.setCode || b.setCode, collectorNumber: a.collectorNumber || b.collectorNumber, isToken: a.isToken || b.isToken };
}

// ── Multi-pass OCR scan ───────────────────────────────────────────────────────
async function runScan(worker: any, imgBuf: Buffer): Promise<ReturnType<typeof parseText>> {
  let result = parseText(await ocr(worker, await normBuf(imgBuf), "3"));

  if (!result.name || !result.collectorNumber) {
    for (const thresh of [185, 160]) {
      result = merge(result, parseText(await ocr(worker, await threshBuf(imgBuf, thresh), "3")));
      if (result.name && result.collectorNumber) break;
    }
  }

  if (!result.collectorNumber) {
    for (const [tf, hf] of [[0.82, 0.18], [0.75, 0.20]] as [number, number][]) {
      const buf = await stripBuf(imgBuf, tf, hf);
      if (!buf) continue;
      result = merge(result, parseText(await ocr(worker, buf, "6"), { noName: true }));
      if (result.collectorNumber) break;
    }
  }

  if (!result.setCode || !result.collectorNumber) {
    for (const deg of [10, -10, 15, -15]) {
      result = merge(result, parseText(await ocr(worker, await rotBuf(imgBuf, deg), "3")));
      if (result.setCode && result.collectorNumber) break;
    }
  }

  return result;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Wire Replit Auth (must be before protected routes)
  await setupAuth(app);
  registerAuthRoutes(app);

  // Helper to get userId from authenticated request
  const userId = (req: any): string => req.user?.claims?.sub as string;

  // ── Scan ──────────────────────────────────────────────────────────────────
  // Accepts a full guide-cropped card image as base64 and runs the proven
  // multi-pass OCR pipeline. Returns parsed { name, setCode, collectorNumber, isToken }.

  app.post("/api/scan", isAuthenticated, async (req: any, res) => {
    try {
      const { imageB64 } = req.body as { imageB64?: string };
      if (!imageB64) return res.status(400).json({ error: "No image provided" });
      const imgBuf = Buffer.from(imageB64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const worker = await getOCRWorker();
      const result = await runScan(worker, imgBuf);
      res.json(result);
    } catch (err: any) {
      console.error("Scan error", err?.message);
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  // ── Decks ─────────────────────────────────────────────────────────────────

  app.get("/api/decks", isAuthenticated, async (req: any, res) => {
    const d = await storage.getDecks(userId(req));
    const withCount = await Promise.all(
      d.map(async deck => {
        const cards = await storage.getDeckCards(deck.id);
        const cardCount = cards.reduce((s, c) => s + c.quantity, 0);
        const totalValue = cards.reduce((s, c) => {
          const p = parseFloat(c.priceUsd ?? "0") || 0;
          return s + p * c.quantity;
        }, 0);
        return { ...deck, cardCount, totalValue };
      })
    );
    res.json(withCount);
  });

  app.get("/api/decks/:id", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeck(req.params.id, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    res.json(deck);
  });

  app.post("/api/decks", isAuthenticated, async (req: any, res) => {
    const result = insertDeckSchema.safeParse({
      ...req.body,
      id: randomUUID(),
      userId: userId(req),
    });
    if (!result.success) {
      console.error("Deck validation failed:", result.error.errors);
      return res.status(400).json({ error: result.error });
    }
    const deck = await storage.createDeck(result.data);
    res.json(deck);
  });

  app.patch("/api/decks/:id", isAuthenticated, async (req: any, res) => {
    const deck = await storage.updateDeck(req.params.id, userId(req), req.body);
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    res.json(deck);
  });

  app.delete("/api/decks/:id", isAuthenticated, async (req: any, res) => {
    if (req.query.permanent === "true") {
      const ok = await storage.deleteDeck(req.params.id, userId(req));
      if (!ok) return res.status(404).json({ error: "Deck not found" });
    } else {
      const deck = await storage.updateDeckStatus(req.params.id, userId(req), true);
      if (!deck) return res.status(404).json({ error: "Deck not found" });
    }
    res.json({ success: true });
  });

  app.patch("/api/decks/:id/restore", isAuthenticated, async (req: any, res) => {
    const deck = await storage.updateDeckStatus(req.params.id, userId(req), false);
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    res.json(deck);
  });

  // ── Deck Cards ────────────────────────────────────────────────────────────

  app.get("/api/decks/:deckId/cards", isAuthenticated, async (req: any, res) => {
    // Verify deck ownership
    const deck = await storage.getDeck(req.params.deckId, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    const cards = await storage.getDeckCards(req.params.deckId);
    res.json(cards);
  });

  app.post("/api/decks/:deckId/cards", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeck(req.params.deckId, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    const cardData = {
      ...req.body,
      id: req.body.id || randomUUID(),
      deckId: req.params.deckId,
    };
    const result = insertDeckCardSchema.safeParse(cardData);
    if (!result.success) return res.status(400).json({ error: result.error });
    const card = await storage.upsertDeckCard(result.data);
    res.json(card);
  });

  app.patch("/api/decks/:deckId/cards/:cardId/quantity", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeck(req.params.deckId, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    const { quantity } = req.body;
    if (typeof quantity !== "number" || quantity < 0) {
      return res.status(400).json({ error: "Invalid quantity" });
    }
    if (quantity === 0) {
      await storage.removeDeckCard(req.params.cardId);
      return res.json({ removed: true });
    }
    const card = await storage.updateDeckCardQuantity(req.params.cardId, quantity);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  });

  app.patch("/api/decks/:deckId/cards/:cardId", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeck(req.params.deckId, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    const card = await storage.updateDeckCard(req.params.cardId, req.body);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  });

  app.delete("/api/decks/:deckId/cards/:cardId", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeck(req.params.deckId, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });

    if (req.query.permanent === "true") {
      const ok = await storage.removeDeckCard(req.params.cardId);
      if (!ok) return res.status(404).json({ error: "Card not found" });
    } else {
      const card = await storage.updateDeckCardStatus(req.params.cardId, true);
      if (!card) return res.status(404).json({ error: "Card not found" });
    }
    res.json({ success: true });
  });

  app.patch("/api/decks/:deckId/cards/:cardId/restore", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeck(req.params.deckId, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    
    const card = await storage.updateDeckCardStatus(req.params.cardId, false);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  });

  // ── Share ──────────────────────────────────────────────────────────────────

  // Generate or get share token for a deck
  app.post("/api/decks/:id/share", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeck(req.params.id, userId(req));
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    let token = deck.shareToken;
    if (!token) {
      token = randomUUID();
      await storage.updateDeck(req.params.id, userId(req), { shareToken: token } as any);
    }
    res.json({ shareToken: token });
  });

  // Public: get shared deck info (no auth required)
  app.get("/api/shared/:token", async (req: any, res) => {
    const deck = await storage.getDeckByShareToken(req.params.token);
    if (!deck) return res.status(404).json({ error: "Shared deck not found" });
    const cards = await storage.getDeckCards(deck.id);
    const cardCount = cards.reduce((s: number, c: any) => s + c.quantity, 0);
    res.json({ deck, cards, cardCount });
  });

  app.post("/api/shared/:token/clone", isAuthenticated, async (req: any, res) => {
    const deck = await storage.getDeckByShareToken(req.params.token);
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    const newDeck = await storage.createDeck({
      name: `${deck.name} (Copy)`,
      userId: userId(req),
    } as any);
    const cards = await storage.getDeckCards(deck.id);
    for (const card of cards) {
      await storage.upsertDeckCard({
        ...card,
        id: undefined,
        deckId: newDeck.id
      } as any);
    }
    res.json(newDeck);
  });

  return httpServer;
}
