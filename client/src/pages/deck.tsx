import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Minus, Plus, Trash2, ArrowLeft, Layers, CreditCard,
  Edit2, Check, X, Scan, TrendingUp, DollarSign,
  BarChart2, Swords, Landmark, Info, Download, ChevronDown,
  ArrowUpDown, Upload, Loader2, Share2, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { Deck, DeckCard } from "@shared/schema";

// ── Color constants ───────────────────────────────────────────────────────────

const WUBRG = ["W", "U", "B", "R", "G"];

// Hex values used for inline CSS gradients (can't use Tailwind for dynamic combos)
const COLOR_HEX: Record<string, string> = {
  W: "#f5e87e", U: "#3b82f6", B: "#525252", R: "#ef4444", G: "#16a34a", C: "#9ca3af",
};

// Dot/ring classes for single colors (used on card tiles)
const MTG_DOT: Record<string, string> = {
  W: "bg-yellow-200 border border-yellow-400",
  U: "bg-blue-500", B: "bg-neutral-700 border border-neutral-500",
  R: "bg-red-500",  G: "bg-green-600", C: "bg-gray-400",
};

const COLOR_NAMES: Record<string, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless",
};

// Returns CSS style for a color/combo block (single color or gradient)
function colorStyle(colors: string[]): React.CSSProperties {
  if (colors.length === 0) return { backgroundColor: COLOR_HEX.C };
  if (colors.length === 1) return { backgroundColor: COLOR_HEX[colors[0]] ?? COLOR_HEX.C };
  const stops = colors.map(c => COLOR_HEX[c] ?? "#888").join(", ");
  return { background: `linear-gradient(90deg, ${stops})` };
}

function colorLabel(colors: string[]): string {
  if (colors.length === 0) return "Colorless";
  return colors.map(c => COLOR_NAMES[c] ?? c).join("/");
}

// ── Rarity ────────────────────────────────────────────────────────────────────

const RARITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  common:   { label: "Common",   bg: "bg-gray-400 dark:bg-gray-500",   text: "text-gray-500 dark:text-gray-400" },
  uncommon: { label: "Uncommon", bg: "bg-blue-400",                    text: "text-blue-400" },
  rare:     { label: "Rare",     bg: "bg-yellow-500",                  text: "text-yellow-500" },
  mythic:   { label: "Mythic",   bg: "bg-orange-500",                  text: "text-orange-500" },
};

const RARITY_RING: Record<string, string> = {
  uncommon: "ring-1 ring-blue-400/60",
  rare:     "ring-1 ring-yellow-400/60",
  mythic:   "ring-1 ring-orange-500/60",
};

// ── Card type helpers ─────────────────────────────────────────────────────────

const TYPE_ORDER = ["Land","Creature","Planeswalker","Enchantment","Artifact","Instant","Sorcery","Other"];
const TYPE_ICONS: Record<string, string> = {
  Land:"🌄", Creature:"⚔️", Planeswalker:"✨", Enchantment:"🔮",
  Artifact:"⚙️", Instant:"⚡", Sorcery:"🌀", Other:"❓",
};
const TYPE_BAR: Record<string, string> = {
  Land:"bg-green-700", Creature:"bg-red-500", Planeswalker:"bg-orange-500",
  Enchantment:"bg-purple-500", Artifact:"bg-gray-400",
  Instant:"bg-blue-400", Sorcery:"bg-blue-600", Other:"bg-gray-500",
};

function getCardType(typeLine: string | null | undefined): string {
  if (!typeLine) return "Other";
  if (typeLine.includes("Land"))         return "Land";
  if (typeLine.includes("Creature"))     return "Creature";
  if (typeLine.includes("Planeswalker")) return "Planeswalker";
  if (typeLine.includes("Enchantment"))  return "Enchantment";
  if (typeLine.includes("Artifact"))     return "Artifact";
  if (typeLine.includes("Instant"))      return "Instant";
  if (typeLine.includes("Sorcery"))      return "Sorcery";
  return "Other";
}

// Returns creature subtypes (e.g. ["Human","Warrior"] from "Creature — Human Warrior")
function getCreatureSubtypes(typeLine: string | null | undefined): string[] {
  if (!typeLine || !typeLine.includes("Creature")) return [];
  const dashIdx = typeLine.indexOf("—");
  if (dashIdx === -1) return [];
  return typeLine.slice(dashIdx + 1).trim().split(/\s+/).filter(Boolean);
}

// ── CMC ───────────────────────────────────────────────────────────────────────

function parseCmc(card: DeckCard): number {
  if (card.cmc != null) return card.cmc;
  if (!card.manaCost) return 0;
  let c = 0;
  for (const m of Array.from(card.manaCost.matchAll(/\{([^}]+)\}/g))) {
    const s = m[1];
    if (/^\d+$/.test(s)) c += parseInt(s);
    else if (!["X","Y","Z","½","∞"].includes(s)) c += 1;
  }
  return c;
}

// ── Hypergeometric distribution ───────────────────────────────────────────────

function logFact(n: number): number {
  let r = 0; for (let i = 2; i <= n; i++) r += Math.log(i); return r;
}
function logBinom(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logFact(n) - logFact(k) - logFact(n - k);
}
function hypergeomGe(N: number, K: number, n: number, minK: number): number {
  if (K <= 0 || N <= 0 || n <= 0) return minK <= 0 ? 1 : 0;
  if (minK <= 0) return 1;
  if (minK > Math.min(K, n)) return 0;
  let p = 0;
  const lo = Math.max(minK, Math.max(0, n - (N - K)));
  for (let k = lo; k <= Math.min(K, n); k++)
    p += Math.exp(logBinom(K, k) + logBinom(N - K, n - k) - logBinom(N, n));
  return Math.min(1, Math.max(0, p));
}
function landDropProb(deckSize: number, landCount: number, turn: number): number {
  if (landCount <= 0 || deckSize <= 0) return 0;
  return hypergeomGe(deckSize, landCount, Math.min(6 + turn, deckSize), turn);
}

// ── Sorting ───────────────────────────────────────────────────────────────────

type SortBy = "name" | "cmc" | "type" | "subtype" | "color" | "price" | "combo";

function sortCards(cards: DeckCard[], by: SortBy): DeckCard[] {
  const a = [...cards];
  switch (by) {
    case "name":
      return a.sort((x, y) => (x.cardName ?? "").localeCompare(y.cardName ?? ""));
    case "cmc":
      return a.sort((x, y) => parseCmc(x) - parseCmc(y) || (x.cardName ?? "").localeCompare(y.cardName ?? ""));
    case "type": {
      const ti = (c: DeckCard) => TYPE_ORDER.indexOf(getCardType(c.typeLine));
      return a.sort((x, y) => ti(x) - ti(y) || (x.cardName ?? "").localeCompare(y.cardName ?? ""));
    }
    case "subtype": {
      const st = (c: DeckCard) => getCreatureSubtypes(c.typeLine)[0] ?? "\uffff";
      return a.sort((x, y) => st(x).localeCompare(st(y)) || (x.cardName ?? "").localeCompare(y.cardName ?? ""));
    }
    case "color": {
      const ci = (c: DeckCard) => {
        const cols = c.colors ?? [];
        if (cols.length === 0) return 99;
        if (cols.length > 1)   return 10 + WUBRG.indexOf(cols[0]);
        return WUBRG.indexOf(cols[0]);
      };
      return a.sort((x, y) => ci(x) - ci(y) || (x.cardName ?? "").localeCompare(y.cardName ?? ""));
    }
    case "price":
      return a.sort((x, y) =>
        (parseFloat(y.priceUsd ?? "0") || 0) - (parseFloat(x.priceUsd ?? "0") || 0));
    case "combo":
      return a.sort((x, y) => {
        if (!x.combo && !y.combo) return (x.cardName ?? "").localeCompare(y.cardName ?? "");
        if (!x.combo) return 1;
        if (!y.combo) return -1;
        return x.combo.localeCompare(y.combo) || (x.cardName ?? "").localeCompare(y.cardName ?? "");
      });
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

type ExportFmt = "arena" | "moxfield" | "csv";

function exportDeck(cards: DeckCard[], deckName: string, fmt: ExportFmt) {
  let content = "";
  if (fmt === "arena") {
    content = cards.map(c => `${c.quantity} ${c.cardName ?? "Unknown"}`).join("\n");
  } else if (fmt === "moxfield") {
    content = cards.map(c => `${c.quantity} ${c.cardName ?? "Unknown"} (${(c.setCode ?? "").toUpperCase()}) ${c.collectorNumber ?? ""}`).join("\n");
  } else if (fmt === "csv") {
    const header = "Quantity,Name,Set,Collector Number,CMC,Type,Rarity,Price (USD)";
    const rows = cards.map(c =>
      [c.quantity, `"${c.cardName ?? ""}"`, (c.setCode ?? "").toUpperCase(),
       c.collectorNumber ?? "", parseCmc(c).toFixed(1),
       `"${c.typeLine ?? ""}"`, c.rarity ?? "",
       c.priceUsd ?? ""].join(","));
    content = [header, ...rows].join("\n");
  }
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ext = fmt === "csv" ? "csv" : "txt";
  a.download = `${deckName.replace(/[^a-z0-9]/gi, "_")}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Analytics hook ────────────────────────────────────────────────────────────

interface ColorSegment { key: string; colors: string[]; val: number; pct: number }

function useAnalytics(cards: DeckCard[] | undefined) {
  return useMemo(() => {
    if (!cards?.length) return null;

    const deckSize   = cards.reduce((s, c) => s + c.quantity, 0);
    const totalValue = cards.reduce((s, c) =>
      s + (parseFloat(c.priceUsd ?? "0") || 0) * c.quantity, 0);

    // Mana curve (0–6+) excluding lands
    const cmcBuckets: number[] = Array(7).fill(0);
    let cmcSum = 0, cmcCount = 0;
    for (const c of cards) {
      if (getCardType(c.typeLine) === "Land") continue;
      const cmc = parseCmc(c);
      cmcBuckets[Math.min(Math.round(cmc), 6)] += c.quantity;
      cmcSum += cmc * c.quantity;
      cmcCount += c.quantity;
    }
    const maxBucket = Math.max(...cmcBuckets, 1);
    const avgCmc = cmcCount > 0 ? cmcSum / cmcCount : 0;

    // Color distribution — each unique combination tracked separately
    const colorMap = new Map<string, { colors: string[]; val: number }>();
    for (const c of cards) {
      const cols = (c.colors ?? [])
        .filter(x => WUBRG.includes(x))
        .sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
      const key = cols.length > 0 ? cols.join("") : "C";
      const existing = colorMap.get(key) ?? { colors: cols.length > 0 ? cols : [], val: 0 };
      colorMap.set(key, { colors: existing.colors, val: existing.val + c.quantity });
    }
    const totalColored = Array.from(colorMap.values()).reduce((a, b) => a + b.val, 0);
    const colorSegments: ColorSegment[] = Array.from(colorMap.entries())
      .filter(([, { val }]) => val > 0)
      .map(([key, { colors, val }]) => ({ key, colors, val, pct: totalColored > 0 ? (val / totalColored) * 100 : 0 }))
      .sort((a, b) => {
        // Single colors in WUBRG order first, then multicolor, then colorless
        if (a.key === "C" && b.key !== "C") return 1;
        if (b.key === "C" && a.key !== "C") return -1;
        if (a.colors.length === 1 && b.colors.length === 1)
          return WUBRG.indexOf(a.colors[0]) - WUBRG.indexOf(b.colors[0]);
        if (a.colors.length === 1) return -1;
        if (b.colors.length === 1) return 1;
        return 0;
      });

    // Card types
    const typeCounts: Record<string, number> = {};
    for (const t of TYPE_ORDER) typeCounts[t] = 0;
    for (const c of cards) {
      const t = getCardType(c.typeLine);
      typeCounts[t] = (typeCounts[t] ?? 0) + c.quantity;
    }

    // Creature subtypes
    const creatureSubtypes = new Map<string, number>();
    for (const c of cards) {
      const subs = getCreatureSubtypes(c.typeLine);
      for (const sub of subs) {
        creatureSubtypes.set(sub, (creatureSubtypes.get(sub) ?? 0) + c.quantity);
      }
    }
    const sortedSubtypes = Array.from(creatureSubtypes.entries())
      .sort((a, b) => b[1] - a[1]);

    // Rarity
    const rarityCounts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
    for (const c of cards) {
      if (c.rarity && rarityCounts[c.rarity] !== undefined) rarityCounts[c.rarity] += c.quantity;
    }

    // Land stats
    const landCount = typeCounts["Land"] ?? 0;
    const landPct   = deckSize > 0 ? (landCount / deckSize) * 100 : 0;

    // Top 5 by price
    const topValue = [...cards]
      .filter(c => parseFloat(c.priceUsd ?? "0") > 0)
      .sort((a, b) => (parseFloat(b.priceUsd ?? "0") || 0) - (parseFloat(a.priceUsd ?? "0") || 0))
      .slice(0, 5);

    return {
      deckSize, totalValue, cmcBuckets, maxBucket, avgCmc,
      colorSegments, typeCounts, creatureSubtypes: sortedSubtypes,
      rarityCounts, landCount, landPct, topValue,
    };
  }, [cards]);
}

// ── Mana Curve ────────────────────────────────────────────────────────────────

function ManaCurve({ buckets, max, avg }: { buckets: number[]; max: number; avg: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-foreground">Mana Curve</p>
        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          avg {avg.toFixed(2)} MV
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-28">
        {buckets.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            {count > 0 && <span className="text-[9px] text-muted-foreground font-semibold">{count}</span>}
            <motion.div
              className="w-full rounded-t bg-primary/85"
              initial={{ height: 0 }}
              animate={{ height: max > 0 ? `${(count / max) * 72}px` : "0px" }}
              transition={{ delay: i * 0.04, type: "spring", stiffness: 260, damping: 22 }}
              style={{ minHeight: count > 0 ? "4px" : "0px" }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {["0","1","2","3","4","5","6+"].map(l => (
          <div key={l} className="flex-1 text-center text-[9px] text-muted-foreground font-medium">{l}</div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">Mana value (excluding lands)</p>
    </div>
  );
}

// ── Color Distribution ────────────────────────────────────────────────────────

function ColorSection({ segments }: { segments: ColorSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-3">Color Identity</p>
      {/* Segmented bar — each combo has its own gradient */}
      <div className="flex rounded-full overflow-hidden h-3 bg-muted gap-px mb-3">
        {segments.map(s => (
          <motion.div key={s.key}
            style={colorStyle(s.colors)}
            className="h-full"
            initial={{ width: 0 }}
            animate={{ width: `${s.pct}%` }}
            transition={{ type: "spring", stiffness: 150, damping: 20 }}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-2">
            {/* Color dot / combo strip */}
            {s.colors.length <= 1 ? (
              <div className="w-3 h-3 rounded-full flex-shrink-0"
                style={colorStyle(s.colors)} />
            ) : (
              <div className="h-3 rounded-full flex-shrink-0 overflow-hidden"
                style={{ ...colorStyle(s.colors), width: `${s.colors.length * 10}px` }} />
            )}
            <span className="text-[11px] text-muted-foreground flex-1 min-w-0 truncate">
              {colorLabel(s.colors)}
            </span>
            <span className="text-[11px] font-semibold text-foreground">{s.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Type Distribution ─────────────────────────────────────────────────────────

function TypeSection({ typeCounts, creatureSubtypes, total }: {
  typeCounts: Record<string, number>;
  creatureSubtypes: [string, number][];
  total: number;
}) {
  const entries = TYPE_ORDER.filter(t => (typeCounts[t] ?? 0) > 0)
    .map(t => ({ type: t, count: typeCounts[t], pct: (typeCounts[t] / total) * 100 }));
  const maxCount = Math.max(...entries.map(e => e.count), 1);

  const [showAllSubs, setShowAllSubs] = useState(false);
  const visibleSubs = showAllSubs ? creatureSubtypes : creatureSubtypes.slice(0, 10);
  const maxSubCount = creatureSubtypes[0]?.[1] ?? 1;

  return (
    <div className="space-y-5">
      {/* Card type bars */}
      <div>
        <p className="text-xs font-semibold text-foreground mb-3">Card Types</p>
        <div className="space-y-2">
          {entries.map(({ type, count, pct }, idx) => (
            <motion.div key={type}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04 }}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] w-[88px] text-muted-foreground flex items-center gap-1 flex-shrink-0">
                  <span className="text-[12px]">{TYPE_ICONS[type]}</span> {type}
                </span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${TYPE_BAR[type]}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(count / maxCount) * 100}%` }}
                    transition={{ delay: idx * 0.04 + 0.05, type: "spring", stiffness: 200, damping: 22 }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-foreground w-5 text-right">{count}</span>
                <span className="text-[10px] text-muted-foreground w-7 text-right">{pct.toFixed(0)}%</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Creature subtypes */}
      {creatureSubtypes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground mb-3">Creature Types</p>
          <div className="space-y-2">
            {visibleSubs.map(([sub, count], idx) => (
              <motion.div key={sub}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.03 }}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] w-24 text-muted-foreground truncate flex-shrink-0">{sub}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-red-400/80"
                      initial={{ width: 0 }}
                      animate={{ width: `${(count / maxSubCount) * 100}%` }}
                      transition={{ delay: idx * 0.03 + 0.05, type: "spring", stiffness: 200, damping: 22 }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-foreground w-5 text-right">{count}</span>
                </div>
              </motion.div>
            ))}
          </div>
          {creatureSubtypes.length > 10 && (
            <button
              onClick={() => setShowAllSubs(s => !s)}
              className="mt-3 text-[11px] text-primary font-medium flex items-center gap-1"
              data-testid="button-toggle-subtypes">
              {showAllSubs ? "Show less" : `Show all ${creatureSubtypes.length} types`}
              <ChevronDown className={`w-3 h-3 transition-transform ${showAllSubs ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Rarity ────────────────────────────────────────────────────────────────────

function RaritySection({ rarityCounts, total }: { rarityCounts: Record<string, number>; total: number }) {
  const entries = (["mythic","rare","uncommon","common"] as const).filter(r => rarityCounts[r] > 0);
  if (entries.length === 0) return null;
  const maxCount = Math.max(...entries.map(r => rarityCounts[r]), 1);
  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-3">Rarity</p>
      <div className="space-y-2">
        {entries.map((r, idx) => {
          const cfg = RARITY_CONFIG[r];
          return (
            <motion.div key={r} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] w-20 ${cfg.text}`}>{cfg.label}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div className={`h-full rounded-full ${cfg.bg}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(rarityCounts[r] / maxCount) * 100}%` }}
                    transition={{ delay: idx * 0.05 + 0.05, type: "spring", stiffness: 200, damping: 22 }} />
                </div>
                <span className="text-[11px] font-semibold text-foreground w-5 text-right">{rarityCounts[r]}</span>
                <span className="text-[10px] text-muted-foreground w-7 text-right">
                  {total > 0 ? ((rarityCounts[r] / total) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Top Value ─────────────────────────────────────────────────────────────────

function TopValueSection({ topCards }: { topCards: DeckCard[] }) {
  if (topCards.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-3">Most Valuable</p>
      <div className="space-y-2">
        {topCards.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
            <span className="flex-1 text-[11px] text-foreground truncate">{c.cardName ?? "Unknown"}</span>
            <Badge variant="outline" className="text-[10px] uppercase px-1.5">{c.setCode}</Badge>
            <span className="text-[11px] font-semibold text-green-500">
              ${parseFloat(c.priceUsd ?? "0").toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Land Probability Chart ────────────────────────────────────────────────────

function LandProbChart({ deckSize, landCount }: { deckSize: number; landCount: number }) {
  const TURNS = 10;
  const probs = Array.from({ length: TURNS }, (_, i) => landDropProb(deckSize, landCount, i + 1));
  const [selected, setSelected] = useState<number | null>(null);

  const VW = 300, VH = 140;
  const PAD = { top: 12, right: 22, bottom: 28, left: 38 };
  const CW = VW - PAD.left - PAD.right, CH = VH - PAD.top - PAD.bottom;
  const xOf = (i: number) => PAD.left + (i / (TURNS - 1)) * CW;
  const yOf = (p: number) => PAD.top + CH * (1 - p);

  function makePath(pts: [number, number][]): string {
    if (pts.length < 2) return "";
    const d: string[] = [`M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const cpx = (x0 + x1) / 2;
      d.push(`C ${cpx.toFixed(1)} ${y0.toFixed(1)}, ${cpx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`);
    }
    return d.join(" ");
  }
  const pts: [number, number][] = probs.map((p, i) => [xOf(i), yOf(p)]);
  const linePath = makePath(pts);
  const areaPath = pts.length > 0
    ? `${linePath} L ${pts[TURNS-1][0].toFixed(1)} ${(PAD.top+CH).toFixed(1)} L ${pts[0][0].toFixed(1)} ${(PAD.top+CH).toFixed(1)} Z`
    : "";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-foreground">Land Drop Probability</p>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          <Landmark className="w-2.5 h-2.5" />
          {landCount} / {deckSize}
        </div>
      </div>

      {/* Turn pills */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
        {probs.map((p, i) => (
          <button key={i}
            onClick={() => setSelected(s => s === i ? null : i)}
            className={`flex-shrink-0 flex flex-col items-center px-2.5 py-1.5 rounded-lg transition-all ${
              selected === i ? "bg-primary text-primary-foreground"
              : p >= 0.9 ? "bg-green-500/15 text-green-600 dark:text-green-400"
              : p >= 0.7 ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
              : "bg-destructive/10 text-destructive"
            }`}
            data-testid={`button-turn-${i + 1}`}>
            <span className="text-[9px] font-medium">T{i + 1}</span>
            <span className="text-[11px] font-bold">{(p * 100).toFixed(0)}%</span>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {selected !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className={`rounded-xl px-4 py-3 mb-3 ${
              probs[selected] >= 0.9
                ? "bg-green-500/10 border border-green-500/20"
                : probs[selected] >= 0.7
                ? "bg-yellow-500/10 border border-yellow-500/20"
                : "bg-destructive/10 border border-destructive/20"
            }`}>
              <p className="font-semibold text-foreground text-sm">Turn {selected + 1}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {(probs[selected] * 100).toFixed(1)}% chance of hitting every land drop through turn {selected + 1}.
                You've drawn {6 + (selected + 1)} cards total (7 opening + {selected} additional draw{selected !== 1 ? "s" : ""}).
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full overflow-visible">
        {[0.25, 0.5, 0.75, 0.9].map(p => (
          <g key={p}>
            <line x1={PAD.left} y1={yOf(p)} x2={PAD.left + CW} y2={yOf(p)}
              stroke="currentColor" className="text-border"
              strokeWidth={p === 0.9 ? 0.8 : 0.5}
              strokeDasharray={p === 0.9 ? "4 3" : "2 4"}
              opacity={p === 0.9 ? 0.7 : 0.35} />
            <text x={PAD.left - 4} y={yOf(p) + 3.5} textAnchor="end" fontSize="7.5"
              fill="currentColor" className="text-muted-foreground" opacity={0.7}>
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}
        <path d={areaPath} fill="currentColor" className="text-primary" fillOpacity={0.08} />
        <path d={linePath} fill="none" stroke="currentColor" className="text-primary"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x={PAD.left + CW + 3} y={yOf(0.9) + 3.5} fontSize="7" fill="currentColor"
          className="text-primary" opacity={0.6}>90%</text>
        {pts.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={selected === i ? 5 : 3.5}
            fill="currentColor" className="text-primary"
            stroke="white" strokeWidth="1.5"
            onClick={() => setSelected(s => s === i ? null : i)}
            style={{ cursor: "pointer" }} />
        ))}
        {Array.from({ length: TURNS }, (_, i) => (
          <text key={i} x={xOf(i)} y={VH - 8} textAnchor="middle" fontSize="8"
            fill="currentColor" className="text-muted-foreground">{i + 1}</text>
        ))}
        <text x={PAD.left + CW / 2} y={VH} textAnchor="middle" fontSize="7.5"
          fill="currentColor" className="text-muted-foreground" opacity={0.6}>Turn</text>
      </svg>

      <div className="flex items-start gap-1.5 mt-2 p-2.5 bg-muted/40 rounded-xl">
        <Info className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Probability of having drawn enough lands to hit your land drop on every turn through T<em>n</em>.
          Based on hypergeometric distribution. Assumes no mulligans.
        </p>
      </div>
    </div>
  );
}

// ── Land Section ──────────────────────────────────────────────────────────────

function LandSection({ deckSize, landCount, landPct }: {
  deckSize: number; landCount: number; landPct: number;
}) {
  const rec = landCount < 18
    ? { msg: "Consider more lands — most decks run 20–26.", color: "text-destructive" }
    : landCount <= 26
    ? { msg: "Healthy land count for most strategies.", color: "text-green-500 dark:text-green-400" }
    : { msg: "High land count — works for control or ramp.", color: "text-yellow-500" };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-foreground mb-3">Lands</p>
        <div className="flex gap-3 mb-3">
          {[
            { label: "Total lands",  val: landCount },
            { label: "% of deck",    val: `${landPct.toFixed(1)}%` },
            { label: "Non-lands",    val: deckSize - landCount },
          ].map(({ label, val }) => (
            <div key={label} className="flex-1 bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-foreground">{val}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <p className={`text-[11px] font-medium ${rec.color}`}>{rec.msg}</p>
      </div>
      {deckSize > 0 && <LandProbChart deckSize={deckSize} landCount={landCount} />}
    </div>
  );
}

// ── Analytics tabs ────────────────────────────────────────────────────────────

type Tab = "overview" | "curve" | "types" | "lands";

const TABS: { id: Tab; label: string; icon: typeof BarChart2 }[] = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "curve",    label: "Curve",    icon: BarChart2 },
  { id: "types",    label: "Types",    icon: Swords },
  { id: "lands",    label: "Lands",    icon: Landmark },
];

function AnalyticsPanel({
  analytics, totalCards,
}: {
  analytics: NonNullable<ReturnType<typeof useAnalytics>>;
  totalCards: number;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Summary row */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
        {[
          { label: "Cards",  val: totalCards,           icon: <Layers className="w-3.5 h-3.5" /> },
          { label: "Avg MV", val: analytics.avgCmc.toFixed(1), icon: <BarChart2 className="w-3.5 h-3.5" /> },
          { label: "Lands",  val: analytics.landCount,  icon: <Landmark className="w-3.5 h-3.5" /> },
          { label: "Value",
            val: analytics.totalValue > 0 ? `$${analytics.totalValue.toFixed(2)}` : "—",
            icon: <DollarSign className="w-3.5 h-3.5 text-green-500" /> },
        ].map(({ label, val, icon }) => (
          <div key={label} className="flex flex-col items-center py-3 px-1">
            <div className="flex items-center gap-1 text-muted-foreground mb-1">{icon}</div>
            <span className="text-sm font-bold text-foreground" data-testid={`stat-${label.toLowerCase().replace(" ","")}`}>{val}</span>
            <span className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wide">{label}</span>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border bg-muted/20">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors text-[10px] font-medium ${
              tab === id ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${id}`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
          className="px-4 py-4">
          {tab === "overview" && (
            <div className="space-y-5">
              <ColorSection segments={analytics.colorSegments} />
              <RaritySection rarityCounts={analytics.rarityCounts} total={totalCards} />
              {analytics.topValue.length > 0 && <TopValueSection topCards={analytics.topValue} />}
            </div>
          )}
          {tab === "curve" && (
            <ManaCurve buckets={analytics.cmcBuckets} max={analytics.maxBucket} avg={analytics.avgCmc} />
          )}
          {tab === "types" && (
            <TypeSection
              typeCounts={analytics.typeCounts}
              creatureSubtypes={analytics.creatureSubtypes}
              total={totalCards}
            />
          )}
          {tab === "lands" && (
            <LandSection deckSize={analytics.deckSize} landCount={analytics.landCount} landPct={analytics.landPct} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Export Sheet ──────────────────────────────────────────────────────────────

function ExportSheet({ cards, deckName, onClose }: {
  cards: DeckCard[]; deckName: string; onClose: () => void;
}) {
  const { toast } = useToast();
  const doExport = (fmt: ExportFmt) => {
    exportDeck(cards, deckName, fmt);
    toast({ description: `Exported as ${fmt === "csv" ? "CSV" : fmt === "arena" ? "Arena/MTGO" : "Moxfield"} format` });
    onClose();
  };
  const formats: { id: ExportFmt; label: string; desc: string }[] = [
    { id: "arena",    label: "Arena / MTGO",  desc: "4 Lightning Bolt" },
    { id: "moxfield", label: "Moxfield",      desc: "4 Lightning Bolt (LTR) 182" },
    { id: "csv",      label: "CSV Spreadsheet", desc: "Qty, Name, Set, CMC, Price…" },
  ];
  return (
    <motion.div className="fixed inset-0 z-50 flex flex-col justify-end"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative bg-background rounded-t-2xl shadow-2xl"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/40">
          <div>
            <h2 className="font-semibold text-foreground">Export Deck</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Choose a format to download</p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {formats.map(f => (
            <button key={f.id}
              onClick={() => doExport(f.id)}
              className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left"
              data-testid={`button-export-${f.id}`}>
              <Download className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{f.label}</p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">{f.desc}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 -rotate-90" />
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Import Sheet ──────────────────────────────────────────────────────────────

async function importCards(fileContent: string, deckId: string, setProgressMsg: (msg: string) => void) {
  const isCsv = fileContent.startsWith("Quantity,Name");
  const lines = fileContent.split(/\r?\n/).filter(l => l.trim().length > 0);
  
  if (isCsv) lines.shift(); // skip header
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    setProgressMsg(`Importing card ${i + 1} / ${lines.length}...`);
    let qty = 1;
    let name = "";
    let set = "";
    let num = "";
    
    if (isCsv) {
      const parts = [];
      let cur = "";
      let inQuote = false;
      for (const char of line) {
        if (char === '"') inQuote = !inQuote;
        else if (char === ',' && !inQuote) { parts.push(cur); cur = ""; }
        else cur += char;
      }
      parts.push(cur);
      
      qty = parseInt(parts[0], 10) || 1;
      name = parts[1] ? parts[1].replace(/^"|"$/g, "") : "";
      set = parts[2] ? parts[2].replace(/^"|"$/g, "") : "";
      num = parts[3] ? parts[3].replace(/^"|"$/g, "") : "";
    } else {
      const match = line.match(/^(\d+)\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)\s+(\S+))?$/);
      if (match) {
        qty = parseInt(match[1], 10) || 1;
        name = match[2].trim();
        if (match[3]) set = match[3];
        if (match[4]) num = match[4];
      } else {
        const fallback = line.match(/^(\d+)\s+(.+)$/);
        if (fallback) {
          qty = parseInt(fallback[1], 10) || 1;
          name = fallback[2].trim();
        } else {
          name = line.trim();
        }
      }
    }
    
    let scryfallData: any = null;
    if (name && (!set || !num)) {
       try {
         const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
         if (res.ok) scryfallData = await res.json();
       } catch {}
       if (scryfallData && scryfallData.object !== "error") {
         set = scryfallData.set;
         num = scryfallData.collector_number;
       }
    } else if (name && set && num) {
       try {
         const res = await fetch(`https://api.scryfall.com/cards/${set.toLowerCase()}/${num.toLowerCase()}`);
         if (res.ok) scryfallData = await res.json();
       } catch {}
    }
    
    if (!set) set = "UNK";
    if (!num) num = "0";
    
    if (scryfallData && scryfallData.object !== "error") {
       const mapped = {
         setCode: set, collectorNumber: num, name: scryfallData.name,
         typeLine: scryfallData.type_line, manaCost: scryfallData.mana_cost,
         cmc: scryfallData.cmc, rarity: scryfallData.rarity,
         imageUri: scryfallData.image_uris?.normal ?? scryfallData.card_faces?.[0]?.image_uris?.normal,
         scryfallId: scryfallData.id, colors: scryfallData.colors ?? scryfallData.card_faces?.[0]?.colors,
         priceUsd: scryfallData.prices?.usd, 
       };
       await apiRequest("POST", `/api/decks/${deckId}/cards`, { ...mapped, quantity: qty, cardName: mapped.name });
    } else {
       await apiRequest("POST", `/api/decks/${deckId}/cards`, {
         setCode: set, collectorNumber: num, cardName: name, quantity: qty
       });
    }
  }
}

function ImportSheet({ deckId, onClose, onComplete }: { deckId: string; onClose: () => void; onComplete: () => void }) {
  const [progressMsg, setProgressMsg] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setProgressMsg("Reading file...");
    try {
      const text = await file.text();
      await importCards(text, deckId, setProgressMsg);
    } catch (err) {
      console.error(err);
    } finally {
      setIsImporting(false);
      onComplete();
      onClose();
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex flex-col justify-end"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isImporting && onClose()} />
      <motion.div className="relative bg-background rounded-t-2xl shadow-2xl"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/40">
          <div>
            <h2 className="font-semibold text-foreground">Import Deck</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Upload a CSV or TXT file</p>
          </div>
          {!isImporting && <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>}
        </div>
        <div className="px-4 py-6 space-y-4 flex flex-col items-center">
          {isImporting ? (
            <div className="flex flex-col items-center justify-center p-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium">{progressMsg}</p>
              <p className="text-[10px] text-muted-foreground mt-1">This might take a moment.</p>
            </div>
          ) : (
            <>
              <input type="file" accept=".txt,.csv" className="hidden" ref={fileInputRef} onChange={handleFile} />
              <Button onClick={() => fileInputRef.current?.click()} className="w-full max-w-sm h-12 rounded-xl" data-testid="button-select-import-file">
                <Upload className="w-4 h-4 mr-2" />
                Select File
              </Button>
              <p className="text-[11px] text-muted-foreground text-center max-w-[250px]">
                Supports Arena/MTGO plain text or standard CSV format exported previously.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sort controls ─────────────────────────────────────────────────────────────

const SORT_OPTIONS: { id: SortBy; label: string }[] = [
  { id: "name",    label: "Name" },
  { id: "cmc",     label: "Mana Value" },
  { id: "type",    label: "Type" },
  { id: "subtype", label: "Creature Type" },
  { id: "color",   label: "Color" },
  { id: "price",   label: "Price" },
  { id: "combo",   label: "Combo" },
];

function SortBar({ sortBy, onChange }: { sortBy: SortBy; onChange: (s: SortBy) => void }) {
  const selectedLabel = SORT_OPTIONS.find(o => o.id === sortBy)?.label ?? "Sort";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 shrink-0">
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Sort by: {selectedLabel}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SORT_OPTIONS.map(opt => (
          <DropdownMenuItem key={opt.id} onClick={() => onChange(opt.id)}>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 flex items-center justify-center">
                {sortBy === opt.id && <Check className="w-3 h-3 text-primary" />}
              </span>
              <span>{opt.label}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Card Tile ─────────────────────────────────────────────────────────────────

function CardTile({ card, onIncrease, onDecrease, onDelete, isComboMode, comboSelected, onComboToggle, onComboStart }: {
  card: DeckCard; onIncrease: () => void; onDecrease: () => void; onDelete: () => void;
  isComboMode?: boolean; comboSelected?: boolean; onComboToggle?: () => void; onComboStart?: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const price = card.priceUsd ? `$${parseFloat(card.priceUsd).toFixed(2)}` : null;
  const colors = (card.colors ?? []).filter(c => WUBRG.includes(c));
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const handlePointerDown = useCallback(() => {
    if (isComboMode) return;
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      if (onComboStart) onComboStart();
    }, 500);
  }, [isComboMode, onComboStart]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const handleClick = useCallback(() => {
    if (didLongPress.current) { didLongPress.current = false; return; }
    if (isComboMode && onComboToggle) onComboToggle();
  }, [isComboMode, onComboToggle]);

  // Synchronized wiggle: use CSS animation with a global class so all wiggling cards
  // share the same animation timeline (CSS animations auto-sync when using the same @keyframes).
  const wiggleClass = isComboMode && comboSelected ? "combo-wiggle" : "";

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
      className={`group relative bg-card border rounded-xl overflow-visible hover-elevate ${RARITY_RING[card.rarity ?? ""] ?? "border-border"} ${isComboMode && comboSelected ? "ring-4 ring-primary" : ""} ${wiggleClass}`}
      style={{ transformOrigin: "center center" }}
      data-testid={`card-item-${card.id}`}>
      <div className="relative aspect-[5/7] rounded-t-xl overflow-hidden bg-muted">
        {card.imageUri && !imgErr ? (
          <img src={card.imageUri} alt={card.cardName ?? "Card"} className="w-full h-full object-cover"
            draggable={false}
            onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <CreditCard className="w-8 h-8 text-muted-foreground/30" />
          </div>
        )}
        {card.quantity > 1 && (
          <div className="absolute top-1.5 right-1.5 bg-background/90 backdrop-blur-sm text-foreground text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shadow">
            {card.quantity}
          </div>
        )}
        {!isComboMode && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center gap-1 pb-2">
            <Button size="icon" variant="secondary" className="h-7 w-7 bg-background/90" onClick={e => { e.stopPropagation(); onDecrease(); }}
              data-testid={`button-decrease-${card.id}`}><Minus className="w-3 h-3" /></Button>
            <span className="text-white font-bold text-sm w-5 text-center">{card.quantity}</span>
            <Button size="icon" variant="secondary" className="h-7 w-7 bg-background/90" onClick={e => { e.stopPropagation(); onIncrease(); }}
              data-testid={`button-increase-${card.id}`}><Plus className="w-3 h-3" /></Button>
            <Button size="icon" variant="secondary" className="h-7 w-7 bg-background/90 ml-1" onClick={e => { e.stopPropagation(); onDelete(); }}
              data-testid={`button-delete-card-${card.id}`}><Trash2 className="w-3 h-3 text-destructive" /></Button>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-xs font-semibold text-foreground truncate">{card.cardName ?? "Unknown"}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-muted-foreground uppercase">{card.setCode}</span>
          {price && <span className="text-[10px] text-green-500 font-medium">{price}</span>}
        </div>
        {colors.length > 0 && (
          <div className="flex gap-0.5 mt-1">
            {colors.map(c => (
              <div key={c} className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${MTG_DOT[c] ?? "bg-gray-300"}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Group label for sorted views ──────────────────────────────────────────────

function getGroupLabel(card: DeckCard, by: SortBy): string {
  switch (by) {
    case "type":    return getCardType(card.typeLine);
    case "combo":   return card.combo ? `Combo: ${card.combo}` : "No Combo";
    case "subtype": {
      const s = getCreatureSubtypes(card.typeLine);
      return s.length > 0 ? s.join(", ") : "Non-Creature";
    }
    case "color": {
      const cols = (card.colors ?? []).filter(c => WUBRG.includes(c));
      if (cols.length === 0) return "Colorless";
      if (cols.length > 1)   return colorLabel(cols);
      return COLOR_NAMES[cols[0]] ?? cols[0];
    }
    case "cmc":  return `${Math.min(Math.round(parseCmc(card)), 6)}${parseCmc(card) >= 6 ? "+" : ""} MV`;
    default: return "";
  }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DeckDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue]     = useState("");
  const [sortBy, setSortBy]           = useState<SortBy>("name");
  const [showExport, setShowExport]   = useState(false);
  const [showImport, setShowImport]   = useState(false);

  const [markingCombo, setMarkingCombo] = useState<boolean>(false);
  const [comboCards, setComboCards] = useState<string[]>([]);
  const [comboNameModalOpen, setComboNameModalOpen] = useState<boolean>(false);
  const [comboName, setComboName] = useState<string>("");

  const { data: deck, isLoading: deckLoading } = useQuery<Deck>({
    queryKey: ["/api/decks", id],
    queryFn: async () => {
      const r = await fetch(`/api/decks/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!id,
  });
  const { data: cards, isLoading: cardsLoading } = useQuery<DeckCard[]>({
    queryKey: ["/api/decks", id, "cards"],
    queryFn: async () => {
      const r = await fetch(`/api/decks/${id}/cards`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!id,
  });

  const analytics  = useAnalytics(cards);
  const totalCards = cards?.reduce((s, c) => s + c.quantity, 0) ?? 0;
  const sortedCards = useMemo(() => sortCards(cards ?? [], sortBy), [cards, sortBy]);

  const updateName = useMutation({
    mutationFn: (name: string) => apiRequest("PATCH", `/api/decks/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      setEditingName(false);
    },
  });
  const updateQty = useMutation({
    mutationFn: ({ cardId, quantity }: { cardId: string; quantity: number }) =>
      apiRequest("PATCH", `/api/decks/${id}/cards/${cardId}/quantity`, { quantity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", id, "cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
    },
  });
  const deleteCard = useMutation({
    mutationFn: (cardId: string) => apiRequest("DELETE", `/api/decks/${id}/cards/${cardId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", id, "cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ description: "Card removed" });
    },
  });

  const updateCombo = useMutation({
    mutationFn: async ({ combo, cardIds }: { combo: string; cardIds: string[] }) => {
      await Promise.all(cardIds.map(cid => apiRequest("PATCH", `/api/decks/${id}/cards/${cid}`, { combo })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", id, "cards"] });
      setMarkingCombo(false);
      setComboCards([]);
      setComboNameModalOpen(false);
      setComboName("");
      toast({ description: "Combo saved" });
    }
  });

  // Deleted cards stack for undo
  const [deletedStack, setDeletedStack] = useState<DeckCard[]>([]);

  const restoreCard = useMutation({
    mutationFn: async (card: DeckCard) => {
      await apiRequest("POST", `/api/decks/${id}/cards`, {
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        cardName: card.cardName,
        typeLine: card.typeLine,
        manaCost: card.manaCost,
        cmc: card.cmc,
        rarity: card.rarity,
        imageUri: card.imageUri,
        scryfallId: card.scryfallId,
        colors: card.colors,
        priceUsd: card.priceUsd,
        combo: card.combo,
        quantity: card.quantity,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks", id, "cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ description: "Card restored" });
    },
  });

  const handleShare = useCallback(async () => {
    try {
      const res = await apiRequest("POST", `/api/decks/${id}/share`);
      const { shareToken } = await res.json();
      const shareUrl = `${window.location.origin}/shared/${shareToken}`;
      if (navigator.share) {
        await navigator.share({
          title: `DeckLens — ${deck?.name ?? "Deck"}`,
          text: `Check out my MTG deck "${deck?.name}"!`,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast({ description: "Share link copied to clipboard!" });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ description: "Failed to share deck" });
      }
    }
  }, [id, deck?.name, toast]);

  // Wrap deleteCard to push to deleted stack
  const handleDeleteCard = useCallback((card: DeckCard) => {
    setDeletedStack(prev => [...prev, card]);
    deleteCard.mutate(card.id);
  }, [deleteCard]);

  if (!id) return null;

  // Build grouped card list (only show group headers for type/subtype/color/cmc sorts)
  const useGroups = ["type","subtype","color","cmc","combo"].includes(sortBy);
  const groups: { label: string; cards: DeckCard[] }[] = [];
  if (useGroups && sortedCards.length > 0) {
    let cur: DeckCard[] = [];
    let curLabel = "";
    for (const card of sortedCards) {
      const lbl = getGroupLabel(card, sortBy);
      if (lbl !== curLabel) {
        if (cur.length > 0) groups.push({ label: curLabel, cards: cur });
        curLabel = lbl; cur = [card];
      } else {
        cur.push(card);
      }
    }
    if (cur.length > 0) groups.push({ label: curLabel, cards: cur });
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/decks">
              <button className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover-elevate flex-shrink-0"
                data-testid="button-back-to-decks">
                <ArrowLeft className="w-4 h-4" />
              </button>
            </Link>

            {editingName ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input value={nameValue} onChange={e => setNameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") updateName.mutate(nameValue);
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="h-9 flex-1 max-w-xs" autoFocus data-testid="input-deck-name-edit" />
                <Button size="icon" onClick={() => updateName.mutate(nameValue)} disabled={!nameValue.trim()}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEditingName(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                {deckLoading ? <Skeleton className="h-6 w-40" /> : (
                  <div className="flex items-center gap-2 group/name">
                    <h1 className="font-semibold text-xl text-foreground tracking-tight truncate"
                      data-testid="text-deck-name">{deck?.name}</h1>
                    <Button size="icon" variant="ghost"
                      className="h-7 w-7 opacity-0 group-hover/name:opacity-100 transition-opacity flex-shrink-0"
                      onClick={() => { setNameValue(deck?.name ?? ""); setEditingName(true); }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-card-count">
                  {totalCards} card{totalCards !== 1 ? "s" : ""}
                </p>
              </div>
            )}

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button size="sm" variant="outline"
                onClick={() => setShowImport(true)}
                data-testid="button-import-deck"
                className="gap-1.5">
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              {cards && cards.length > 0 && (
                <Button size="sm" variant="outline"
                  onClick={() => setShowExport(true)}
                  data-testid="button-export-deck"
                  className="gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export</span>
                </Button>
              )}
              {cards && cards.length > 0 && (
                <Button size="sm" variant="outline"
                  onClick={handleShare}
                  data-testid="button-share-deck"
                  className="gap-1.5">
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
              )}
              <Link href="/">
                <Button size="sm" data-testid="button-scan-more">
                  <Scan className="w-4 h-4 mr-1.5" />Scan
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4">
        {/* Analytics */}
        {analytics && cards && cards.length > 0 && (
          <div className="mt-4">
            <AnalyticsPanel analytics={analytics} totalCards={totalCards} />
          </div>
        )}

        {/* Card grid */}
        <div className="mt-4">
          {cardsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-[5/7] rounded-xl" />)}
            </div>
          ) : cards?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Layers className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <h2 className="font-semibold text-foreground mb-1">Deck is empty</h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                Hold up a card and tap the shutter button to scan it in.
              </p>
              <Link href="/"><Button data-testid="button-go-scan"><Scan className="w-4 h-4 mr-1.5" />Start Scanning</Button></Link>
            </div>
          ) : (
            <>
              {/* Sort bar + restore trash */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <SortBar sortBy={sortBy} onChange={setSortBy} />
                {deletedStack.length > 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0"
                    onClick={() => {
                      const last = deletedStack[deletedStack.length - 1];
                      setDeletedStack(prev => prev.slice(0, -1));
                      restoreCard.mutate(last);
                    }}
                    data-testid="button-restore-card">
                    <Undo2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Undo</span>
                  </Button>
                )}
              </div>

              {/* Grouped or flat grid */}
              {useGroups && groups.length > 0 ? (
                <div className="space-y-5">
                  {groups.map(group => (
                    <div key={group.label}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-foreground">{group.label}</span>
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                          {group.cards.reduce((s, c) => s + c.quantity, 0)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                        {group.cards.map(card => (
                          <CardTile key={card.id} card={card}
                            isComboMode={markingCombo}
                            comboSelected={comboCards.includes(card.id)}
                            onComboStart={() => {
                              setMarkingCombo(true);
                              setComboCards([card.id]);
                            }}
                            onComboToggle={() => {
                              setComboCards(prev => prev.includes(card.id) ? prev.filter(x => x !== card.id) : [...prev, card.id]);
                            }}
                            onIncrease={() => updateQty.mutate({ cardId: card.id, quantity: card.quantity + 1 })}
                            onDecrease={() => {
                              if (card.quantity <= 1) deleteCard.mutate(card.id);
                              else updateQty.mutate({ cardId: card.id, quantity: card.quantity - 1 });
                            }}
                            onDelete={() => handleDeleteCard(card)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {sortedCards.map(card => (
                    <CardTile key={card.id} card={card}
                      isComboMode={markingCombo}
                      comboSelected={comboCards.includes(card.id)}
                      onComboStart={() => {
                        setMarkingCombo(true);
                        setComboCards([card.id]);
                      }}
                      onComboToggle={() => {
                        setComboCards(prev => prev.includes(card.id) ? prev.filter(x => x !== card.id) : [...prev, card.id]);
                      }}
                      onIncrease={() => updateQty.mutate({ cardId: card.id, quantity: card.quantity + 1 })}
                      onDecrease={() => {
                        if (card.quantity <= 1) deleteCard.mutate(card.id);
                        else updateQty.mutate({ cardId: card.id, quantity: card.quantity - 1 });
                      }}
                      onDelete={() => handleDeleteCard(card)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Export sheet */}
      <AnimatePresence>
        {showExport && cards && deck && (
          <ExportSheet cards={cards} deckName={deck.name} onClose={() => setShowExport(false)} />
        )}
      </AnimatePresence>

      {/* Import sheet */}
      <AnimatePresence>
        {showImport && (
          <ImportSheet deckId={id} onClose={() => setShowImport(false)} onComplete={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/decks", id, "cards"] });
            queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
            toast({ description: "Import completed successfully." });
          }} />
        )}
      </AnimatePresence>

      {/* Combo Marking Banner */}
      <AnimatePresence>
        {markingCombo && (
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-6 left-0 right-0 mx-4 sm:mx-auto sm:max-w-md z-50 bg-background/95 backdrop-blur-md shadow-2xl border border-primary/20 px-4 py-3 rounded-2xl flex items-center justify-center gap-3 flex-wrap">
            <p className="text-sm font-semibold">{comboCards.length} card{comboCards.length !== 1 ? "s" : ""} selected</p>
            <Button size="sm" onClick={() => setComboNameModalOpen(true)} disabled={comboCards.length === 0}>
              Save Combo
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:bg-muted/50" onClick={() => { setMarkingCombo(false); setComboCards([]); }}>
              Cancel
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={comboNameModalOpen} onOpenChange={setComboNameModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name Combo</DialogTitle>
            <DialogDescription>Enter a name for the selected combo.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input autoFocus value={comboName} onChange={e => setComboName(e.target.value)} placeholder="e.g. Infinite Mana" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setComboNameModalOpen(false)}>Cancel</Button>
            <Button onClick={() => updateCombo.mutate({ combo: comboName, cardIds: comboCards })} disabled={!comboName.trim() || updateCombo.isPending}>
              {updateCombo.isPending ? "Saving..." : "Save Combo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
