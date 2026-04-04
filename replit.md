# DeckLens — MTG Card Scanner

A Magic: The Gathering deck digitalization app. Point the rear camera at a card, tap the shutter, and DeckLens reads the card using a multi-pass server-side OCR pipeline, looks it up on Scryfall, and adds it to your deck with price and analytics.

## Architecture

- **Frontend**: React + TypeScript + Vite, Framer Motion, shadcn/ui
- **Backend**: Express.js + PostgreSQL via Drizzle ORM
- **Auth**: Replit Auth (OIDC) — supports Google, GitHub, Apple, email
- **OCR engine**: Server-side Tesseract.js (persistent singleton worker) running a 5-pass pipeline using Sharp for image preprocessing
- **Card Data**: Scryfall API (`api.scryfall.com`)
- **Styling**: Tailwind CSS + shadcn/ui, Inter font, Apple-style clean design

## Key Features

- **Snapshot scanner** — tap shutter, frame freezes, full card sent to server OCR pipeline, result drawer slides up
- **5-pass OCR pipeline** — normalise → threshold (185/160) → bottom-strip crop → rotation (±10°/±15°); proven 5/5 on real card photos
- **Multi-strategy Scryfall lookup** — fuzzy name search → set+collector ID (with `t{set}` variant for tokens) → basic land fallback
- **Token card support** — "T" rarity prefix detection → `tltr`/`tXXX` set code variants
- **Basic land detection** — short type-line OCR word scan for Plains/Island/Mountain/Forest/Swamp
- **Collapsible result drawer** — chevron collapses to minimal status bar while reviewing
- **Environment-only camera** — tries `exact: "environment"` first to lock rear camera
- **Safe area support** — all bottom controls respect `env(safe-area-inset-bottom)`
- **Scryfall lookup** — fetches name, type, mana cost, CMC, rarity, image, USD price
- **Deck analytics** — mana curve bar chart, color distribution bar, total value
- **Per-user decks** — decks scoped to authenticated user via PostgreSQL

## Routes

- `/` → Full-screen snapshot scanner
- `/decks` → Deck list with value summaries, user avatar + logout
- `/deck/:id` → Deck detail with analytics panel + card grid

## Project Structure

```
client/src/
  pages/
    scanner.tsx    — Snapshot scanner with collapsible drawer
    home.tsx       — Deck list with user info
    deck.tsx       — Deck detail with analytics (mana curve, color dist, value)
    login.tsx      — Login page (Replit Auth)
  hooks/
    use-auth.ts    — Authentication state hook
shared/
  schema.ts        — Drizzle schema (decks, deck_cards + auth models)
  models/auth.ts   — Replit Auth tables (users, sessions)
server/
  index.ts         — Express server entry
  routes.ts        — REST API (auth + 5-pass OCR scan + deck CRUD, all routes protected)
  storage.ts       — DrizzleStorage (PostgreSQL)
  db.ts            — Drizzle + pg pool connection
  test-scan.ts     — OCR pipeline test harness (5/5 on real card photos)
  replit_integrations/auth/ — Replit Auth OIDC integration
```

## Deck Schema

- **decks**: id, userId, name, description, createdAt
- **deck_cards**: id, deckId, setCode, collectorNumber, quantity, cardName, typeLine, manaCost, cmc, rarity, imageUri, scryfallId, colors[], priceUsd

## Scan Flow

1. User taps shutter → video freezes to canvas snapshot
2. Guide rectangle cropped to 630×882 canvas → sent as base64 JPEG to `/api/scan`
3. Server runs 5-pass OCR:
   - Pass 1: normalise + sharpen
   - Pass 2: binary threshold at t=185, t=160 (for light/washed cards)
   - Pass 3: bottom-strip crop (collector line only, noName mode)
   - Pass 4: rotated ±10° and ±15° (for tilted cards)
4. Text parser extracts name, setCode, collectorNumber, isToken from each pass and merges
5. Result returned to frontend → drawer opens → Scryfall lookup fires automatically
6. Card image, name, price shown → user confirms or adjusts fields
7. Confirmed → card saved to active deck → camera resumes

## OCR Parser Key Rules

- **Collector number**: rarity prefix `[RCUTMLSB] 0*NNN` (1–1000 range); slash format `NNN/NNN`; copyright line fallback `Wizards...402`
- **Set code**: must be ≥3 chars (`[A-Z][A-Z0-9]{2,4}`) followed by language code within the same line
- **Token detection**: "T" rarity prefix → `isToken=true` → tries `t{setCode}` variant on Scryfall
- **Basic land fallback**: scan short lines (4–15 chars) for exact land type word
- **Name extraction**: skips lines matching RULES_START pattern (gameplay text), 1-2 char prefixes removed, fragment joining for multi-line names like "Long List of / the Ents"
