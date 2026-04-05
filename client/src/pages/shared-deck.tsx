import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { motion } from "framer-motion";
import {
  Layers, CreditCard, ArrowLeft, TrendingUp, DollarSign,
  BarChart2, Landmark,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Deck, DeckCard } from "@shared/schema";

const WUBRG = ["W", "U", "B", "R", "G"];
const MTG_DOT: Record<string, string> = {
  W: "bg-yellow-200 border border-yellow-400",
  U: "bg-blue-500", B: "bg-neutral-700 border border-neutral-500",
  R: "bg-red-500",  G: "bg-green-600", C: "bg-gray-400",
};
const RARITY_RING: Record<string, string> = {
  uncommon: "ring-1 ring-blue-400/60",
  rare:     "ring-1 ring-yellow-400/60",
  mythic:   "ring-1 ring-orange-500/60",
};

function SharedCardTile({ card }: { card: DeckCard }) {
  const price = card.priceUsd ? `$${parseFloat(card.priceUsd).toFixed(2)}` : null;
  const colors = (card.colors ?? []).filter(c => WUBRG.includes(c));
  return (
    <div className={`bg-card border rounded-xl overflow-visible ${RARITY_RING[card.rarity ?? ""] ?? "border-border"}`}>
      <div className="relative aspect-[5/7] rounded-t-xl overflow-hidden bg-muted">
        {card.imageUri ? (
          <img src={card.imageUri} alt={card.cardName ?? "Card"} className="w-full h-full object-cover" />
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

export default function SharedDeckView() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery<{ deck: Deck; cards: DeckCard[]; cardCount: number }>({
    queryKey: ["/api/shared", token],
    queryFn: async () => {
      const r = await fetch(`/api/shared/${token}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!token,
  });

  const totalCards = data?.cards?.reduce((s, c) => s + c.quantity, 0) ?? 0;
  const totalValue = useMemo(() =>
    data?.cards?.reduce((s, c) => s + (parseFloat(c.priceUsd ?? "0") || 0) * c.quantity, 0) ?? 0,
    [data?.cards]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-5xl mx-auto">
          <Skeleton className="h-8 w-48 mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[5/7] rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Layers className="w-12 h-12 text-muted-foreground/40" />
        <h1 className="text-xl font-semibold text-foreground">Deck not found</h1>
        <p className="text-sm text-muted-foreground">This shared deck link may have expired or be invalid.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="font-semibold text-xl text-foreground tracking-tight truncate">{data.deck.name}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {totalCards} card{totalCards !== 1 ? "s" : ""}
                {totalValue > 0 && (
                  <span className="ml-2 text-green-500 font-medium">· ${totalValue.toFixed(2)}</span>
                )}
                <span className="ml-2">· Shared deck (read-only)</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 mt-4">
        {data.cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Layers className="w-8 h-8 text-muted-foreground/40 mb-4" />
            <h2 className="font-semibold text-foreground mb-1">This deck is empty</h2>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {data.cards.map(card => (
              <SharedCardTile key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
