import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers, X, Check, ChevronDown, Plus, CreditCard,
  Loader2, AlertCircle, Search, DollarSign, Type, Hash,
  Mic, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Deck } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScannedCard {
  setCode: string; collectorNumber: string; name: string;
  typeLine?: string; manaCost?: string; cmc?: number; rarity?: string;
  imageUri?: string; scryfallId?: string; colors?: string[];
  priceUsd?: string | null; priceEur?: string | null;
}
interface DrawerFields { cardName: string; setCode: string; number: string }
interface CardRegion { x: number; y: number; w: number; h: number }
interface DeckWithCount extends Deck { cardCount: number; totalValue?: number }

// ─────────────────────────────────────────────────────────────────────────────
// GUIDE GEOMETRY
//
// CRITICAL: this function must produce the SAME rectangle that the CSS guide
// uses. The CSS overlay is:
//
//   width:        min(72vw, calc(52vh * 5 / 7))
//   aspect-ratio: 5/7       (so height = width * 7/5)
//   display:      flex centered in the viewport
//
// Here vw = videoWidth and vh = videoHeight (actual video pixel dimensions).
// ─────────────────────────────────────────────────────────────────────────────
function getCardGuide(vw: number, vh: number): CardRegion {
  const cardW = Math.min(0.72 * vw, (0.52 * vh * 5) / 7);
  const cardH = (cardW * 7) / 5;
  return {
    x: (vw - cardW) / 2,
    y: (vh - cardH) / 2,
    w: cardW,
    h: cardH,
  };
}

// Canonical output size for the guide-cropped card image.
// Large enough for Tesseract to read comfortably at native resolution.
const OUT_W = 630, OUT_H = 882;  // 5:7 @ ~90 dpi equivalent

// ── Server scan ────────────────────────────────────────────────────────────────
// Sends the full guide-cropped card image to the server's multi-pass OCR pipeline.
// Returns parsed { name, setCode, collectorNumber, isToken }.
async function runServerScan(imageB64: string): Promise<{ name: string; setCode: string; collectorNumber: string; isToken: boolean }> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ imageB64 }),
  });
  if (!res.ok) throw new Error(`Scan ${res.status}`);
  return res.json();
}

// ── Scryfall ───────────────────────────────────────────────────────────────────
function mapScryfall(d: any): ScannedCard {
  return {
    setCode: d.set, collectorNumber: d.collector_number, name: d.name,
    typeLine: d.type_line, manaCost: d.mana_cost, cmc: d.cmc, rarity: d.rarity,
    imageUri: d.image_uris?.normal ?? d.card_faces?.[0]?.image_uris?.normal,
    scryfallId: d.id, colors: d.colors ?? d.card_faces?.[0]?.colors,
    priceUsd: d.prices?.usd ?? null, priceEur: d.prices?.eur ?? null,
  };
}
async function fetchScryfallByName(name: string): Promise<ScannedCard | null> {
  if (!name.trim()) return null;
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.trim())}`
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d.object === "error" ? null : mapScryfall(d);
  } catch { return null; }
}
async function fetchScryfallById(
  setCode: string, collectorNumber: string
): Promise<ScannedCard | null> {
  if (!setCode || !collectorNumber) return null;
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/${setCode.toLowerCase().trim()}/${collectorNumber.trim()}`
    );
    if (!res.ok) return null;
    return mapScryfall(await res.json());
  } catch { return null; }
}

// Fetch all printings (different artworks) of a card by name
async function fetchScryfallPrintings(name: string): Promise<ScannedCard[]> {
  if (!name.trim()) return [];
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent('!"' + name.trim() + '"')}&unique=prints&order=released`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data
      .filter((d: any) => d.image_uris?.normal || d.card_faces?.[0]?.image_uris?.normal)
      .map(mapScryfall);
  } catch { return []; }
}

// ── Rarity pill colour ─────────────────────────────────────────────────────────
const rarityColor: Record<string, string> = {
  common: "bg-gray-500", uncommon: "bg-blue-500",
  rare: "bg-yellow-500", mythic: "bg-orange-500", special: "bg-purple-500",
};

// ── Deck picker ────────────────────────────────────────────────────────────────
function DeckPickerSheet({ decks, activeDeckId, onSelect, onClose, onCreateNew }: {
  decks: DeckWithCount[]; activeDeckId: string | null;
  onSelect: (id: string) => void; onClose: () => void; onCreateNew: () => void;
}) {
  return (
    <motion.div className="fixed inset-0 z-50 flex flex-col justify-end"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative bg-background rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 26, stiffness: 300 }}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/40">
          <h2 className="font-semibold">Switch Deck</h2>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-deck-picker">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {decks.map(deck => (
            <button key={deck.id} onClick={() => onSelect(deck.id)}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl transition-all ${
                activeDeckId === deck.id ? "bg-primary text-primary-foreground" : "bg-muted/60"
              }`} data-testid={`button-select-deck-${deck.id}`}>
              <div className="flex items-center gap-3">
                <Layers className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium text-sm">{deck.name}</span>
              </div>
              <Badge variant={activeDeckId === deck.id ? "secondary" : "outline"} className="text-xs">
                {deck.cardCount}
              </Badge>
            </button>
          ))}
          <button onClick={onCreateNew}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-muted/30 text-muted-foreground"
            data-testid="button-new-deck-from-scanner">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">New Deck</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CreateDeckSheet({ onClose, onCreate }: {
  onClose: () => void; onCreate: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: (n: string) => apiRequest("POST", "/api/decks", { name: n }),
    onSuccess: async (res) => {
      const deck = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ description: `"${deck.name}" created` });
      onCreate(deck.id);
    },
  });
  return (
    <motion.div className="fixed inset-0 z-50 flex flex-col justify-end"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative bg-background rounded-t-2xl px-5 pt-5"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 26, stiffness: 300 }}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 2.5rem)" }}>
        <h2 className="font-semibold mb-4">New Deck</h2>
        <input autoFocus
          className="w-full rounded-xl border border-input bg-muted/30 px-4 py-3.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Deck name" value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && create.mutate(name.trim())}
          data-testid="input-new-deck-name" />
        <div className="flex gap-3 mt-4">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={() => name.trim() && create.mutate(name.trim())}
            disabled={!name.trim() || create.isPending}
            data-testid="button-create-deck-scanner">Create</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Card Drawer ────────────────────────────────────────────────────────────────
function CardDrawer({ initial, deck, onAdd, onClose }: {
  initial: DrawerFields; deck: DeckWithCount | null;
  onAdd: (card: ScannedCard) => Promise<void>; onClose: () => void;
}) {
  const [cardName, setCardName] = useState(initial.cardName);
  const [setCode, setSetCode]   = useState(initial.setCode);
  const [number, setNumber]     = useState(initial.number);
  const [card, setCard]         = useState<ScannedCard | null>(null);
  const [state, setState]       = useState<"idle"|"loading"|"found"|"not_found">("idle");
  const [lastMode, setLastMode] = useState<"name"|"id"|null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [imgErr, setImgErr]     = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  // Artwork carousel state
  const [printings, setPrintings] = useState<ScannedCard[]>([]);
  const [printingIdx, setPrintingIdx] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (initial.cardName) doSearch("name", initial.cardName, initial.setCode, initial.number);
    else if (initial.setCode && initial.number) doSearch("id", "", initial.setCode, initial.number);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(
    mode: "name"|"id",
    name = cardName, sc = setCode, num = number,
  ) {
    setState("loading"); setCard(null); setImgErr(false); setLastMode(mode);
    setPrintings([]); setPrintingIdx(0);
    let result: ScannedCard | null = null;
    if (mode === "name") {
      result = await fetchScryfallByName(name);
      if (!result && sc.trim() && num.trim()) {
        result = await fetchScryfallById(sc, num);
        if (result) setLastMode("id");
      }
    } else {
      result = await fetchScryfallById(sc, num);
      if (!result && name.trim()) {
        result = await fetchScryfallByName(name);
        if (result) setLastMode("name");
      }
    }
    if (result) {
      setCard(result);
      setSetCode(result.setCode);
      setNumber(result.collectorNumber);
      setState("found");
      // Load all printings for the carousel
      const prints = await fetchScryfallPrintings(result.name);
      if (prints.length > 1) {
        setPrintings(prints);
        // Find the index of the current card in the printings
        const idx = prints.findIndex(p => p.setCode === result!.setCode && p.collectorNumber === result!.collectorNumber);
        setPrintingIdx(idx >= 0 ? idx : 0);
      }
    } else {
      setState("not_found");
      toast({ description: "Card not found — edit the fields and try again" });
    }
  }

  // Voice input via Web Speech API
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ description: "Voice input not supported in this browser" });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setCardName(transcript);
      setState("idle");
      setIsListening(false);
      // Auto-search after voice
      setTimeout(() => doSearch("name", transcript), 100);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [toast]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  // Carousel navigation
  const selectPrinting = useCallback((idx: number) => {
    const p = printings[idx];
    if (!p) return;
    setPrintingIdx(idx);
    setCard(p);
    setSetCode(p.setCode);
    setNumber(p.collectorNumber);
    setImgErr(false);
  }, [printings]);

  const price = card?.priceUsd ? `$${card.priceUsd}` : card?.priceEur ? `€${card.priceEur}` : null;

  return (
    <motion.div className="absolute inset-x-0 bottom-0 z-40"
      initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 320 }}>
      <div className="bg-background/97 backdrop-blur-2xl rounded-t-3xl shadow-2xl border-t border-border/50"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}>

        <button className="w-full flex items-center justify-center py-4"
          onClick={() => setCollapsed(c => !c)} data-testid="button-collapse-drawer">
          <div className="w-10 h-1.5 bg-muted-foreground/30 rounded-full" />
        </button>

        {collapsed && (
          <div className="px-5 pb-4 flex items-center gap-3">
            {state === "found" && card ? (
              <>
                <span className="text-sm font-semibold flex-1 truncate">{card.name}</span>
                {price && <span className="text-xs font-semibold text-green-500">{price}</span>}
                <Button size="sm" className="h-8 px-3" onClick={async () => {
                  setIsAdding(true); try { await onAdd(card); } finally { setIsAdding(false); }
                }} disabled={isAdding || !deck}>
                  {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onClose}>
                  <X className="w-3 h-3" />
                </Button>
              </>
            ) : (
              <>
                <span className="font-mono text-sm text-muted-foreground flex-1">
                  {cardName || (setCode && number ? `${setCode.toUpperCase()} #${number}` : "No info read")}
                </span>
                {state === "loading" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                <Button size="sm" variant="ghost" className="h-8" onClick={onClose}><X className="w-3 h-3" /></Button>
              </>
            )}
          </div>
        )}

        {!collapsed && (
          <div className="px-5 pb-2">
            <div className="mb-3">
              <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Type className="w-3 h-3" />Card Name
                {lastMode === "name" && state === "found" && (
                  <span className="text-[9px] bg-blue-500/15 text-blue-500 rounded-full px-1.5 py-0.5 font-semibold">matched by name</span>
                )}
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input value={cardName}
                    onChange={e => { setCardName(e.target.value); setState("idle"); }}
                    onKeyDown={e => e.key === "Enter" && doSearch("name")}
                    placeholder="e.g. Lightning Bolt"
                    className="w-full rounded-xl border border-input bg-muted/40 px-3.5 py-2.5 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring"
                    data-testid="input-card-name" />
                  <button
                    onClick={isListening ? stopListening : startListening}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isListening ? "bg-red-500 text-white animate-pulse" : "bg-red-500/15 text-red-500 hover:bg-red-500/25"}`}
                    data-testid="button-voice-input"
                    type="button">
                    <Mic className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Button size="sm" variant="secondary"
                  onClick={() => doSearch("name")}
                  disabled={state === "loading" || !cardName.trim()}
                  className="h-[42px] px-3 flex-shrink-0 text-xs"
                  data-testid="button-search-by-name">
                  <Search className="w-3.5 h-3.5 mr-1" />Name
                </Button>
              </div>
            </div>

            <div className="flex gap-2 items-end mb-3">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5">
                  <Hash className="w-3 h-3" />Set
                  {lastMode === "id" && state === "found" && (
                    <span className="text-[9px] bg-orange-500/15 text-orange-500 rounded-full px-1.5 py-0.5 font-semibold">matched by ID</span>
                  )}
                </label>
                <input value={setCode}
                  onChange={e => { setSetCode(e.target.value.toUpperCase()); setState("idle"); }}
                  onKeyDown={e => e.key === "Enter" && doSearch("id")}
                  placeholder="LTR"
                  className="w-full rounded-xl border border-input bg-muted/40 px-3.5 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring uppercase"
                  maxLength={6} data-testid="input-set-code" />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-1 block">
                  Collector #
                </label>
                <input value={number}
                  onChange={e => { setNumber(e.target.value); setState("idle"); }}
                  onKeyDown={e => e.key === "Enter" && doSearch("id")}
                  placeholder="230"
                  className="w-full rounded-xl border border-input bg-muted/40 px-3.5 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                  maxLength={8} data-testid="input-collector-number" />
              </div>
              <Button size="sm"
                variant={state === "not_found" ? "destructive" : "secondary"}
                onClick={() => doSearch("id")}
                disabled={state === "loading" || !setCode.trim() || !number.trim()}
                className="h-[42px] px-3 flex-shrink-0 text-xs"
                data-testid="button-search-by-id">
                {state === "loading"
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <><Search className="w-3.5 h-3.5 mr-1" />ID</>}
              </Button>
            </div>

            {state === "not_found" && (
              <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 px-3.5 py-2.5 rounded-xl mb-3">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                <p className="text-xs text-destructive">Card not found — correct the fields and retry</p>
              </div>
            )}
            {state === "idle" && !cardName.trim() && !setCode.trim() && (
              <p className="text-xs text-muted-foreground text-center py-1 mb-2">
                Enter card name or set code + collector # to search
              </p>
            )}

            {state === "found" && card && (
              <>
                <div className="flex gap-4 mb-4">
                  <div className="flex-shrink-0 w-24 relative">
                    <div className="rounded-xl overflow-hidden shadow-lg aspect-[5/7] bg-muted">
                      {card.imageUri && !imgErr ? (
                        <img src={card.imageUri} alt={card.name} className="w-full h-full object-cover"
                          onError={() => setImgErr(true)} data-testid="img-confirm-card" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <CreditCard className="w-8 h-8 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    {/* Artwork carousel arrows */}
                    {printings.length > 1 && (
                      <div className="flex items-center justify-between mt-1.5">
                        <button
                          onClick={() => selectPrinting((printingIdx - 1 + printings.length) % printings.length)}
                          className="w-6 h-6 rounded-full bg-muted flex items-center justify-center hover:bg-muted-foreground/20 transition-colors"
                          data-testid="button-prev-art">
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[9px] text-muted-foreground font-medium">
                          {printingIdx + 1}/{printings.length}
                        </span>
                        <button
                          onClick={() => selectPrinting((printingIdx + 1) % printings.length)}
                          className="w-6 h-6 rounded-full bg-muted flex items-center justify-center hover:bg-muted-foreground/20 transition-colors"
                          data-testid="button-next-art">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base leading-tight" data-testid="text-confirm-name">
                      {card.name}
                    </h3>
                    {card.typeLine && <p className="text-xs text-muted-foreground mt-1">{card.typeLine}</p>}
                    {card.manaCost && <p className="text-xs font-mono text-muted-foreground mt-1">{card.manaCost}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {card.rarity && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${rarityColor[card.rarity] ?? "bg-gray-500"}`}>
                          {card.rarity}
                        </span>
                      )}
                      <Badge variant="outline" className="text-xs uppercase">{card.setCode}</Badge>
                      <Badge variant="outline" className="text-xs">#{card.collectorNumber}</Badge>
                    </div>
                    {price && (
                      <div className="flex items-center gap-1.5 mt-2 bg-green-500/10 px-2.5 py-1.5 rounded-lg w-fit">
                        <DollarSign className="w-3 h-3 text-green-500" />
                        <span className="text-xs font-semibold" data-testid="text-card-price">{price}</span>
                        <span className="text-[10px] text-muted-foreground">market</span>
                      </div>
                    )}
                  </div>
                </div>

                {deck && (
                  <div className="px-3.5 py-2.5 bg-muted/50 rounded-xl flex items-center gap-2 mb-4">
                    <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-muted-foreground">Adding to</span>
                    <span className="text-xs font-semibold truncate">{deck.name}</span>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-11" onClick={onClose}
                    disabled={isAdding} data-testid="button-skip-card">
                    <X className="w-4 h-4 mr-1.5" />Skip
                  </Button>
                  <Button className="flex-1 h-11" onClick={async () => {
                    setIsAdding(true); try { await onAdd(card); } finally { setIsAdding(false); }
                  }} disabled={isAdding || !deck} data-testid="button-confirm-add">
                    {isAdding ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Check className="w-4 h-4 mr-1.5" />}
                    Add to Deck
                  </Button>
                </div>
              </>
            )}

            {state !== "found" && (
              <Button variant="ghost" className="w-full mt-3 text-muted-foreground text-xs h-9"
                onClick={onClose} data-testid="button-dismiss-drawer">Cancel</Button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Scanner ────────────────────────────────────────────────────────────────
export default function Scanner() {
  const { toast }  = useToast();
  const { user }   = useAuth();
  const videoRef      = useRef<HTMLVideoElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const processingRef = useRef(false);

  const [cameraReady, setCameraReady]     = useState(false);
  const [cameraError, setCameraError]     = useState<string | null>(null);
  const [frozen, setFrozen]               = useState(false);
  const [processing, setProcessing]       = useState(false);
  const [processingMsg, setProcessingMsg] = useState("");
  const [drawerFields, setDrawerFields]   = useState<DrawerFields | null>(null);
  const [showDeckPicker, setShowDeckPicker]   = useState(false);
  const [showCreateDeck, setShowCreateDeck]   = useState(false);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(() =>
    localStorage.getItem("activeDeckId")
  );
  const [addedCount, setAddedCount] = useState(0);

  const { data: decks } = useQuery<DeckWithCount[]>({ queryKey: ["/api/decks"] });
  const activeDeck = decks?.find(d => d.id === activeDeckId) ?? decks?.[0] ?? null;
  useEffect(() => {
    if (!activeDeckId && decks?.length) setActiveDeckId(decks[0].id);
  }, [decks, activeDeckId]);
  const saveActiveDeck = (id: string) => {
    setActiveDeckId(id); localStorage.setItem("activeDeckId", id);
  };

  // ── Camera init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function startCamera() {
      try {
        // 1. Initial request to ensure camera permission is fully granted
        // so we can read distinct hardware labels instead of generic ones.
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        } catch {
          // If device doesn't have an environment camera (e.g., standard PC), fallback generic
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        
        // 2. Enumerate available distinct hardware cameras
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === "videoinput");
        
        let bestDevice = null;
        const backCameras = videoInputs.filter(d => d.label.toLowerCase().includes("back"));
        
        if (backCameras.length > 0) {
          // Exclude virtual/switchable multi-cameras ("Dual", "Triple") which cause the toggling jump
          // Also explicitly exclude the lower-quality "Ultra Wide" and "Telephoto" to just use the primary wide lens.
          const standardLens = backCameras.find(d => 
            !d.label.toLowerCase().includes("ultra") &&
            !d.label.toLowerCase().includes("telephoto") &&
            !d.label.toLowerCase().includes("dual") &&
            !d.label.toLowerCase().includes("triple")
          );
          bestDevice = standardLens || backCameras[0];
        } else if (videoInputs.length > 0) {
          bestDevice = videoInputs[0];
        }

        // 3. Restart stream forcefully locked to our specific, stable hardware choice
        const constraints = bestDevice ? {
          video: {
            deviceId: { exact: bestDevice.deviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        } : {
          video: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        };

        // Shut down the temp stream
        stream.getTracks().forEach(t => t.stop());
        
        // Open the high-res, specific camera stream
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // If high-res constraints fail for some hardware reason, fallback safely
          stream = await navigator.mediaDevices.getUserMedia({ video: bestDevice ? { deviceId: { exact: bestDevice.deviceId } } : true });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (e: any) {
        if (e.name === "NotAllowedError") {
          setCameraError("Camera access denied. Please allow camera permissions in your browser settings and try reopening the app.");
        } else {
          setCameraError("Unable to access camera securely. " + (e.message || ""));
        }
      }
    }
    startCamera();
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  // ── Shutter ──────────────────────────────────────────────────────────────────
  const handleSnapshot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || processingRef.current || drawerFields) return;
    processingRef.current = true;
    setProcessing(true);
    navigator.vibrate?.(25);

    // 1. Capture full video frame
    setProcessingMsg("Capturing…");
    const live = liveCanvasRef.current!;
    live.width  = video.videoWidth;
    live.height = video.videoHeight;
    live.getContext("2d", { willReadFrequently: true })!.drawImage(video, 0, 0);
    setFrozen(true);

    // 2. Crop the guide rectangle — the SAME region the CSS overlay shows the user.
    //    getCardGuide MUST use the identical formula as the CSS width/height calculation.
    setProcessingMsg("Cropping card…");
    const guide = getCardGuide(live.width, live.height);

    const card = document.createElement("canvas");
    card.width  = OUT_W;
    card.height = OUT_H;
    const cctx = card.getContext("2d", { willReadFrequently: true })!;
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = "high";
    cctx.drawImage(
      live,
      Math.round(guide.x), Math.round(guide.y),
      Math.round(guide.w), Math.round(guide.h),
      0, 0, OUT_W, OUT_H,
    );

    // 3. Send full card image to server multi-pass OCR pipeline
    setProcessingMsg("Reading card…");
    const imageB64 = card.toDataURL("image/jpeg", 0.92);

    let scanResult = { name: "", setCode: "", collectorNumber: "", isToken: false };
    try {
      scanResult = await runServerScan(imageB64);
    } catch (err) {
      console.warn("Server scan error:", err);
      toast({ description: "OCR unavailable — enter details manually", variant: "destructive" });
    }

    console.log("[scan]", scanResult);

    setProcessing(false);
    setProcessingMsg("");
    processingRef.current = false;

    setDrawerFields({
      cardName: scanResult.name,
      setCode:  scanResult.setCode,
      number:   scanResult.collectorNumber,
    });
  }, [drawerFields, toast]);

  const resumeLive = useCallback(() => {
    setFrozen(false);
    setDrawerFields(null);
  }, []);

  const handleAddCard = useCallback(async (card: ScannedCard) => {
    if (!activeDeck) return;
    await apiRequest("POST", `/api/decks/${activeDeck.id}/cards`, {
      setCode: card.setCode, collectorNumber: card.collectorNumber, cardName: card.name,
      typeLine: card.typeLine, manaCost: card.manaCost, cmc: card.cmc, rarity: card.rarity,
      imageUri: card.imageUri, scryfallId: card.scryfallId, colors: card.colors,
      priceUsd: card.priceUsd, quantity: 1,
    });
    queryClient.invalidateQueries({ queryKey: ["/api/decks", activeDeck.id, "cards"] });
    queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
    setAddedCount(n => n + 1);
    navigator.vibrate?.([25, 40, 25]);
    toast({ description: `${card.name} added` });
    resumeLive();
  }, [activeDeck, toast, resumeLive]);

  const hasDecks = !!decks?.length;

  return (
    <div className="relative w-screen bg-black overflow-hidden select-none"
      style={{ height: "100dvh", overscrollBehavior: "none" }}>

      {/* Live feed */}
      <video ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-100 ${frozen ? "opacity-0" : "opacity-100"}`}
        muted playsInline data-testid="video-camera-feed" />

      {/* Frozen frame */}
      <canvas ref={liveCanvasRef}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-100 ${frozen ? "opacity-100" : "opacity-0"}`} />

      {/* ── Static guide overlay ── */}
      {!drawerFields && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {/* Vignette outside the card area */}
          <div className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse 75% 85% at 50% 50%, transparent 52%, rgba(0,0,0,0.6) 100%)" }} />

          {/* Card guide box — MUST match getCardGuide: min(72vw, 52vh*5/7) × 7/5 */}
          <div className="relative"
            style={{ width: "min(72vw, calc(52vh * 5 / 7))", aspectRatio: "5/7" }}>

            {/* Corner marks */}
            {["top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg",
              "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg",
              "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg",
              "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg",
            ].map((cls, i) => (
              <div key={i} className={`absolute w-8 h-8 border-white/90 m-0.5 ${cls}`} />
            ))}

            {/* Name region indicator — top ~2-18% */}
            <div className="absolute left-[1%] right-[22%]" style={{ top: "2%", height: "16%" }}>
              <div className={`w-full h-full rounded border ${
                processing ? "border-blue-400 bg-blue-400/25 animate-pulse" : "border-blue-400/50 bg-blue-400/8"
              }`} />
              <span className="absolute -top-5 left-0 text-[10px] font-semibold whitespace-nowrap text-blue-300 bg-black/60 px-1.5 py-0.5 rounded">
                Card name
              </span>
            </div>

            {/* Collector region indicator — bottom ~14-28% full width */}
            <div className="absolute left-0 right-0" style={{ bottom: "0%", height: "28%" }}>
              <div className={`w-full h-full rounded border ${
                processing ? "border-orange-400 bg-orange-400/25 animate-pulse" : "border-orange-400/50 bg-orange-400/8"
              }`} />
              <span className="absolute -top-5 left-0 text-[10px] font-semibold whitespace-nowrap text-orange-300 bg-black/60 px-1.5 py-0.5 rounded">
                Collector info
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Processing modal */}
      <AnimatePresence>
        {processing && (
          <motion.div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-black/80 backdrop-blur-md rounded-2xl px-7 py-5 flex flex-col items-center gap-3">
              <Loader2 className="w-9 h-9 text-white animate-spin" />
              <p className="text-white text-sm font-medium">{processingMsg}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera error */}
      {cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 px-8 text-center">
          <div className="bg-black/85 backdrop-blur-md rounded-2xl p-7 max-w-sm w-full">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm leading-relaxed mb-5">{cameraError}</p>
            <Link href="/decks"><Button variant="secondary" className="w-full">Open Decks</Button></Link>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-30 flex items-center px-4"
        style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}>
        <button onClick={() => { if (!drawerFields) setShowDeckPicker(true); }}
          className="flex items-center gap-2 bg-black/55 backdrop-blur-md text-white pl-3 pr-3.5 py-2 rounded-full border border-white/15 max-w-[65%]"
          data-testid="button-open-deck-picker">
          <Layers className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-xs font-semibold truncate">{activeDeck ? activeDeck.name : "Select Deck"}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60 ml-0.5" />
        </button>
      </div>

      {/* Bottom controls */}
      {!drawerFields && !cameraError && (
        <div className="absolute bottom-0 inset-x-0 z-20 flex flex-col items-center gap-4 px-6"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 2.5rem)" }}>
          <div className="h-7 flex items-center">
            {!cameraReady ? (
              <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10">
                <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
                <span className="text-white/60 text-xs">Starting camera…</span>
              </div>
            ) : !hasDecks ? (
              <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10">
                <AlertCircle className="w-3 h-3 text-yellow-400" />
                <span className="text-white/80 text-xs">Create a deck first</span>
              </div>
            ) : addedCount > 0 ? (
              <div className="bg-black/50 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10">
                <span className="text-white/70 text-xs" data-testid="text-added-count">
                  {addedCount} card{addedCount !== 1 ? "s" : ""} scanned
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-center gap-6 w-full">
            <Link href="/decks">
              <button className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center"
                data-testid="link-to-decks">
                <Layers className="w-5 h-5 text-white" />
              </button>
            </Link>

            <button onClick={handleSnapshot}
              disabled={!cameraReady || processing || !hasDecks}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-all active:scale-95 disabled:opacity-40"
              data-testid="button-snapshot">
              {processing
                ? <Loader2 className="w-7 h-7 text-white animate-spin" />
                : <div className="w-14 h-14 rounded-full bg-white" />}
            </button>

            <div className="w-11 h-11" />
          </div>

          {cameraReady && hasDecks && (
            <p className="text-white/50 text-[11px] text-center leading-relaxed">
              Fill the guide corners with the card, then tap
            </p>
          )}

          {!hasDecks && cameraReady && (
            <button onClick={() => setShowCreateDeck(true)}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-full text-sm font-semibold shadow-lg"
              data-testid="button-create-first-deck">
              <Plus className="w-4 h-4 inline mr-1.5" />Create First Deck
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {drawerFields && (
          <CardDrawer initial={drawerFields} deck={activeDeck} onAdd={handleAddCard} onClose={resumeLive} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showDeckPicker && (
          <DeckPickerSheet decks={decks ?? []} activeDeckId={activeDeck?.id ?? null}
            onSelect={id => { saveActiveDeck(id); setShowDeckPicker(false); }}
            onClose={() => setShowDeckPicker(false)}
            onCreateNew={() => { setShowDeckPicker(false); setShowCreateDeck(true); }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCreateDeck && (
          <CreateDeckSheet onClose={() => setShowCreateDeck(false)}
            onCreate={id => { saveActiveDeck(id); setShowCreateDeck(false); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
