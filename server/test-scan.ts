// Final test harness — run with: npx tsx server/test-scan.ts
import path from "path";
import { createWorker } from "tesseract.js";
import sharp from "sharp";

// Updated ground truth after Scryfall verification:
// - Plains is DMR/402 (John Avon, Dominaria Remastered), not LTR
// - Food token is in set "tltr" (token set for LTR), collector# 9
const GROUND_TRUTH = [
  { file: "image-4989644257054036680_1775210534908.jpg", name: "Shelob, Child of Ungoliant", setCode: "ltr",  collectorNumber: "230" },
  { file: "image-4677422563119136400_1775210556517.jpg",  name: "Long List of the Ents",      setCode: "ltr",  collectorNumber: "174" },
  { file: "image-1355522900974375287_1775210568763.jpg",  name: "Pippin's Bravery",            setCode: "ltr",  collectorNumber: "414" },
  { file: "image-7086281017171426526_1775210593710.jpg",  name: "Food",                        setCode: "tltr", collectorNumber: "9"   },
  { file: "image-1172458032726819102_1775210635176.jpg",  name: "Plains",                      setCode: "dmr",  collectorNumber: "402" },
];

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

// Artist first names — 2-word "Firstname Surname" lines with these first names are likely artist credits
const ARTIST_FIRST = new Set(["JOHN","DAVID","RANDY","MARK","ERIC","ANNA","KATE","MARY","MIKE","CHRIS","ADAM","JAMES","SARA","SEAN","PETE","FRED","GREG","RYAN","LUCA","NOAH"]);

// Set code must be ≥ 3 chars to avoid 2-char noise (e.g. "TR", "ON", "DU")
const COLLECTOR_RE = new RegExp(
  `\\b([A-Z][A-Z0-9]{2,4})[^A-Z0-9]{1,12}(?:${LANG_CODES.join("|")})\\b`
);

// ── Parser ─────────────────────────────────────────────────────────────────────
function parseText(rawText: string, opts: { noName?: boolean } = {}): { name: string; setCode: string; collectorNumber: string; isToken: boolean } {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  let collectorNumber = "";
  let setCode = "";
  let isToken = false;

  // ── Collector number ─────────────────────────────────────────────────────
  for (const line of lines) {
    const upper = line.toUpperCase();
    // Rarity prefix: R=rare, U=uncommon, C=common, M=mythic, T=token, L=land, S=special, B=bonus
    const m = upper.match(/\b([RCUTMLSB]{1,2})\s{1,5}0*(\d{1,4})\b/);
    if (m) {
      const num = parseInt(m[2], 10);
      if (num >= 1 && num <= 1000) {          // reject years (2023) and out-of-range
        collectorNumber = String(num);
        if (m[1] === "T") isToken = true;
        break;
      }
    }
  }
  if (!collectorNumber) {
    // Slash format: "174/281"
    const m = rawText.toUpperCase().match(/\b(\d{1,4})\s*\/\s*\d{2,4}\b/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= 1000) collectorNumber = String(num);
    }
  }
  if (!collectorNumber) {
    // Copyright line: "Wizards of the Coast 402"
    const m = rawText.toUpperCase().match(/(?:COAST|WIZARDS)[^\n]{0,80}?(\d{3,4})\b/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= 1000) collectorNumber = String(num);
    }
  }

  // ── Set code (per-line, ≥ 3 chars) ──────────────────────────────────────
  for (const line of lines) {
    const upper = line.toUpperCase();
    const m = upper.match(COLLECTOR_RE);
    if (m && !NON_SET.has(m[1]) && !/^\d/.test(m[1])) {
      setCode = m[1].toLowerCase();
      break;
    }
  }

  // Strip-pass mode: only extract collector info, skip name (strip images show card bottom)
  if (opts.noName) return { name: "", setCode, collectorNumber, isToken };

  // ── Card name ─────────────────────────────────────────────────────────────
  let name = "";
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const lineRaw = lines[i];
    // Skip lines that are clearly collector info
    if (COLLECTOR_RE.test(lineRaw.toUpperCase())) continue;

    // Normalize: keep letters, digits, apostrophe, comma, hyphen
    let clean = lineRaw
      .replace(/[\u2018\u2019]/g, "'")           // normalize curly apostrophes
      .replace(/[^\w\s',\-]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    // Remove leading 1-2 char tokens (noise)
    clean = clean.replace(/^(?:[0-9A-Za-z]{1,2}\s+)+/, "").trim();

    if (clean.length < 4) continue;              // min 4 chars to avoid abbreviations
    if (!/[A-Za-z]/.test(clean)) continue;
    if (/^\d/.test(clean)) continue;
    if (RULES_START.test(clean)) continue;

    const words = clean.split(/\s+/);
    if (words.length > 7 || clean.length > 52) continue;
    const letterRatio = (clean.match(/[A-Za-z]/g) || []).length / clean.length;
    if (letterRatio < 0.55) continue;

    // Skip known abbreviations and non-name tokens (illustrator credits, license text etc.)
    if (NON_SET.has(clean.toUpperCase())) continue;

    // Skip likely artist credit: 2-word "FirstName Surname" with known artist first name
    if (words.length === 2 && ARTIST_FIRST.has(words[0].toUpperCase())) continue;

    // Fragment join: "Long List of" → fetch next line
    let candidate = clean;
    if (/\b(of|the|a|an|and|for|from|to|in|at|on|with)\s*$/i.test(clean) && i + 1 < lines.length) {
      const next = lines[i + 1]
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^\w\s',\-]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      // Filter single-char noise from next line
      const nextWords = next.split(/\s+/).filter(w => w.length > 1).slice(0, 3);
      if (nextWords.length > 0 && /^[A-Za-z]/.test(nextWords[0])) {
        const joined = clean + " " + nextWords.join(" ");
        candidate = joined.replace(/\s+(when|if|you|this|each|note|whenever|so|he|she)\b.*/i, "").trim();
      }
    }

    candidate = candidate
      .replace(/\.\s*(When|If|You|This|Each|Note)\s.*/i, "")
      .replace(/[.,;:!?]+$/, "")
      .trim();

    if (candidate.length >= 4 && /[A-Za-z]/.test(candidate)) { name = candidate; break; }
  }

  // Last resort: detect basic land type from a short OCR line (≤15 chars)
  // Type lines for basic lands are very short; rules-text mentions are long lines
  if (!name && !opts.noName) {
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

// ── Preprocessing ──────────────────────────────────────────────────────────────
async function normBuf(imgPath: string): Promise<Buffer> {
  return sharp(imgPath).rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .grayscale().normalise().sharpen({ sigma: 1.2 }).png().toBuffer();
}

async function threshBuf(imgPath: string, t: number): Promise<Buffer> {
  return sharp(imgPath).rotate()
    .resize({ width: 1800, withoutEnlargement: true })
    .grayscale().threshold(t).sharpen({ sigma: 1.5 }).png().toBuffer();
}

async function rotBuf(imgPath: string, deg: number): Promise<Buffer> {
  return sharp(imgPath).rotate()
    .rotate(deg, { background: { r: 255, g: 255, b: 255 } })
    .resize({ width: 1600, withoutEnlargement: true })
    .grayscale().normalise().sharpen({ sigma: 1.2 }).png().toBuffer();
}

// Strip crop: render full rotated image first → extract correct sub-region
async function stripBuf(imgPath: string, topFrac: number, htFrac: number): Promise<Buffer | null> {
  try {
    const rotated = await sharp(imgPath).rotate().png().toBuffer();
    const { width: W, height: H } = await sharp(rotated).metadata() as { width: number; height: number };
    const top = Math.floor(H * topFrac);
    const height = Math.max(1, Math.min(Math.floor(H * htFrac), H - top - 1));
    return await sharp(rotated)
      .extract({ left: 0, top, width: W, height })
      .resize({ width: 1600, withoutEnlargement: true })
      .grayscale().normalise().sharpen({ sigma: 2 }).png().toBuffer();
  } catch { return null; }
}

async function ocr(worker: any, buf: Buffer, psm = "3"): Promise<string> {
  await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", tessedit_char_whitelist: "" });
  return (await worker.recognize(buf)).data.text.trim();
}

type Parsed = ReturnType<typeof parseText>;
function merge(a: Parsed, b: Parsed): Parsed {
  return {
    name: a.name || b.name,
    setCode: a.setCode || b.setCode,
    collectorNumber: a.collectorNumber || b.collectorNumber,
    isToken: a.isToken || b.isToken,
  };
}

// ── Per-card multi-pass OCR ────────────────────────────────────────────────────
async function processCard(worker: any, imgPath: string) {
  const log: string[] = [];

  // Pass 1: standard normalise
  const t1 = await ocr(worker, await normBuf(imgPath), "3");
  log.push(`p1: ${t1.slice(0, 200).replace(/\n/g, "|")}`);
  let result = parseText(t1);

  // Pass 2: binary threshold (for light cards: Food, Plains)
  if (!result.name || !result.collectorNumber) {
    for (const thresh of [185, 160]) {
      const t2 = await ocr(worker, await threshBuf(imgPath, thresh), "3");
      log.push(`p2(t${thresh}): ${t2.slice(0, 200).replace(/\n/g, "|")}`);
      result = merge(result, parseText(t2));
      if (result.name && result.collectorNumber) break;
    }
  }

  // Pass 3: bottom-strip crop (collector line for Food/token cards)
  if (!result.collectorNumber) {
    for (const [tf, hf] of [[0.82, 0.18], [0.75, 0.20]] as [number, number][]) {
      const buf = await stripBuf(imgPath, tf, hf);
      if (!buf) continue;
      const t3 = await ocr(worker, buf, "6");
      log.push(`p3(strip${Math.round(tf * 100)}%): ${t3.slice(0, 200).replace(/\n/g, "|")}`);
      // Strip shows card bottom → only extract collector info, skip name
      result = merge(result, parseText(t3, { noName: true }));
      if (result.collectorNumber) break;
    }
  }

  // Pass 4: rotation for tilted cards — run when set/num still missing
  if (!result.setCode || !result.collectorNumber) {
    for (const deg of [10, -10, 15, -15]) {
      const t4 = await ocr(worker, await rotBuf(imgPath, deg), "3");
      log.push(`p4(rot${deg}°): ${t4.slice(0, 200).replace(/\n/g, "|")}`);
      result = merge(result, parseText(t4));
      if (result.setCode && result.collectorNumber) break;
    }
  }

  return { result, log };
}

// ── Scryfall lookup ────────────────────────────────────────────────────────────
async function scryfallLookup(parsed: Parsed, gt: typeof GROUND_TRUTH[0]): Promise<{ ok: boolean; detail: string }> {
  const matches = (d: any) => d.name.toLowerCase() === gt.name.toLowerCase();
  const { name, setCode, collectorNumber, isToken } = parsed;

  // 1. Name fuzzy search
  if (name.trim().length >= 4) {
    try {
      const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
      if (r.ok) {
        const d = await r.json() as any;
        if (d.object !== "error" && matches(d))
          return { ok: true, detail: `"${d.name}" (${d.set}/${d.collector_number}) via name` };
      }
    } catch {}
  }

  // 2. Direct set + number lookup
  if (setCode && collectorNumber) {
    // For tokens, OCR reads the main set code (e.g. "ltr") but Scryfall stores tokens
    // under a "t" prefix set (e.g. "tltr")
    const setVariants = isToken
      ? [setCode, `t${setCode}`]
      : [setCode];
    for (const sc of setVariants) {
      try {
        const r = await fetch(`https://api.scryfall.com/cards/${sc}/${collectorNumber}`);
        if (r.ok) {
          const d = await r.json() as any;
          if (d.object !== "error" && matches(d))
            return { ok: true, detail: `"${d.name}" (${d.set}/${d.collector_number}) via id (${sc}/${collectorNumber})` };
        }
      } catch {}
    }
  }

  // 3. Fallback for basic lands: search by collector number alone (no set code needed)
  //    This handles Plains/Island/etc where only the number appears in OCR
  if (!setCode && collectorNumber && !name) {
    try {
      const q = `cn:${collectorNumber}+type:basic`;
      const r = await fetch(`https://api.scryfall.com/cards/search?q=${q}&order=released&dir=desc`);
      if (r.ok) {
        const d = await r.json() as any;
        if (d.object === "list" && d.data?.length > 0 && matches(d.data[0]))
          return { ok: true, detail: `"${d.data[0].name}" (${d.data[0].set}/${d.data[0].collector_number}) via cn-basic` };
      }
    } catch {}
  }

  // 4. Name search fallback when name is partial / ID not found
  if (name.trim().length >= 4 && setCode && !collectorNumber) {
    try {
      const q = `set:${setCode}+name:${encodeURIComponent('"' + name + '"')}`;
      const r = await fetch(`https://api.scryfall.com/cards/search?q=${q}&limit=1`);
      if (r.ok) {
        const d = await r.json() as any;
        if (d.object === "list" && d.data?.length > 0 && matches(d.data[0]))
          return { ok: true, detail: `"${d.data[0].name}" (${d.data[0].set}/${d.data[0].collector_number}) via set+name` };
      }
    } catch {}
  }

  return { ok: false, detail: `name="${name}" set="${setCode}" #="${collectorNumber}"` };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Loading Tesseract...\n");
  const worker = await createWorker("eng", 1, { logger: () => {} });
  let passed = 0;

  for (const gt of GROUND_TRUTH) {
    const imgPath = path.join("attached_assets", gt.file);
    console.log(`━━━ ${gt.name} (want: ${gt.setCode}/${gt.collectorNumber}) ━━━`);
    try {
      const { result, log } = await processCard(worker, imgPath);
      for (const l of log) console.log(`  ${l}`);
      console.log(`  ⟹  name="${result.name}" set="${result.setCode}" #="${result.collectorNumber}" token=${result.isToken}`);
      const { ok, detail } = await scryfallLookup(result, gt);
      console.log(`  ${ok ? "✅" : "❌"} ${detail}`);
      if (ok) passed++;
    } catch (e: any) {
      console.log(`  ❌ ERROR: ${e.message}`);
    }
    console.log();
  }

  await worker.terminate();
  console.log(`═══ Result: ${passed}/${GROUND_TRUTH.length} ═══`);
  process.exit(passed === GROUND_TRUTH.length ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
