import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Layers, Trash2, Scan, CreditCard,
  ChevronRight, LogOut, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Deck, DeckCard } from "@shared/schema";

interface DeckWithCount extends Deck { cardCount: number; totalValue?: number }

function DeckCard({ deck, onDelete }: { deck: DeckWithCount; onDelete: () => void }) {
  const { data: cards } = useQuery<DeckCard[]>({
    queryKey: ["/api/decks", deck.id, "cards"],
    queryFn: async () => {
      const r = await fetch(`/api/decks/${deck.id}/cards`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const previews = cards?.filter(c => c.imageUri).slice(0, 3) ?? [];
  const rarityBorder: Record<string, string> = {
    uncommon: "border-blue-400", rare: "border-yellow-400", mythic: "border-orange-500",
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group bg-card border border-border rounded-2xl overflow-visible hover-elevate"
      data-testid={`card-deck-${deck.id}`}>
      <Link href={`/deck/${deck.id}`}>
        <div className="p-4">
          {/* Card preview strip */}
          <div className="h-20 bg-muted/40 rounded-xl mb-3 flex items-center justify-center overflow-hidden relative">
            {previews.length > 0 ? (
              <div className="flex items-end justify-center gap-1 pb-1">
                {previews.map((card, i) => (
                  <div key={card.id}
                    className={`rounded-md overflow-hidden shadow-md border-2 ${rarityBorder[card.rarity ?? ""] ?? "border-transparent"} flex-shrink-0`}
                    style={{ width: 40, height: 56, transform: `rotate(${(i - 1) * 4}deg) translateY(${i === 1 ? -4 : 0}px)`, zIndex: i === 1 ? 2 : 1 }}>
                    <img src={card.imageUri!} alt={card.cardName ?? ""} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-muted-foreground/50">
                <CreditCard className="w-5 h-5" />
                <span className="text-xs">Empty deck</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-foreground truncate">{deck.name}</h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-muted-foreground" data-testid={`text-card-count-${deck.id}`}>
                  {deck.cardCount} cards
                </span>
                {deck.totalValue != null && deck.totalValue > 0 && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="text-xs text-green-500 font-medium flex items-center gap-0.5">
                      <DollarSign className="w-2.5 h-2.5" />
                      {deck.totalValue.toFixed(2)}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
                data-testid={`button-delete-deck-${deck.id}`}>
                <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export default function Decks() {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const { toast } = useToast();
  const { user, logout } = useAuth();

  const { data: decks, isLoading } = useQuery<DeckWithCount[]>({
    queryKey: ["/api/decks"],
    queryFn: async () => {
      const r = await fetch("/api/decks");
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    }
  });

  const createDeck = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/decks", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      setCreating(false);
      setNewName("");
      toast({ description: "Deck created" });
    },
  });

  const deleteDeck = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/decks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ description: "Deck deleted" });
    },
  });

  const initials = user?.firstName
    ? `${user.firstName[0]}${user.lastName?.[0] ?? ""}`.toUpperCase()
    : "?";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-xl border-b border-border/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3 max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/">
              <button className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover-elevate"
                data-testid="link-back-to-scanner">
                <Scan className="w-4 h-4 text-foreground" />
              </button>
            </Link>
            <div>
              <h1 className="font-semibold text-foreground text-lg tracking-tight">My Decks</h1>
              <p className="text-xs text-muted-foreground">
                {decks?.length ?? 0} deck{(decks?.length ?? 0) !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCreating(true)} data-testid="button-create-deck">
              <Plus className="w-4 h-4 mr-1" />New Deck
            </Button>

            {/* User avatar + logout */}
            <div className="relative group/user">
              <button className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary hover-elevate"
                data-testid="button-user-menu">
                {user?.profileImageUrl
                  ? <img src={user.profileImageUrl} alt="" className="w-full h-full rounded-full object-cover" />
                  : initials}
              </button>
              <div className="absolute right-0 top-10 bg-background border border-border rounded-xl shadow-xl overflow-hidden w-40 opacity-0 pointer-events-none group-hover/user:opacity-100 group-hover/user:pointer-events-auto transition-all z-50">
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {user?.firstName ?? "User"}
                  </p>
                  {user?.email && (
                    <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                  )}
                </div>
                <button onClick={() => logout()}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  data-testid="button-logout">
                  <LogOut className="w-3.5 h-3.5" />Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">
        <AnimatePresence>
          {creating && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
              <div className="bg-card border border-border rounded-2xl p-4">
                <input autoFocus
                  className="w-full rounded-xl border border-input bg-muted/30 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring mb-3"
                  placeholder="Deck name" value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newName.trim()) createDeck.mutate(newName.trim());
                    if (e.key === "Escape") { setCreating(false); setNewName(""); }
                  }}
                  data-testid="input-deck-name" />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1"
                    onClick={() => { setCreating(false); setNewName(""); }}
                    data-testid="button-cancel-create">Cancel</Button>
                  <Button size="sm" className="flex-1"
                    onClick={() => newName.trim() && createDeck.mutate(newName.trim())}
                    disabled={!newName.trim() || createDeck.isPending}
                    data-testid="button-confirm-create-deck">Create</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
        ) : decks?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Layers className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <h2 className="font-semibold text-foreground mb-1">No decks yet</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-xs">
              Create a deck to start scanning and organizing your cards.
            </p>
            <Button onClick={() => setCreating(true)} data-testid="button-create-deck-empty">
              <Plus className="w-4 h-4 mr-1.5" />Create first deck
            </Button>
          </div>
        ) : (
          <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AnimatePresence mode="popLayout">
              {decks?.map(deck => (
                <DeckCard key={deck.id} deck={deck} onDelete={() => deleteDeck.mutate(deck.id)} />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
