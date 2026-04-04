import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Layers, Plus, Moon, Sun, Scan } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/components/theme-provider";
import type { Deck } from "@shared/schema";

interface DeckWithCount extends Deck {
  cardCount: number;
}

export function AppSidebar() {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  const { data: decks, isLoading } = useQuery<DeckWithCount[]>({
    queryKey: ["/api/decks"],
  });

  const activeDeckId = location.startsWith("/deck/")
    ? location.split("/")[2]
    : null;

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
            <Scan className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-sidebar-foreground tracking-tight">DeckLens</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-muted-foreground px-3 py-2">
            My Decks
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <SidebarMenuItem key={i}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Skeleton className="h-4 w-4 rounded" />
                      <Skeleton className="h-3 flex-1 rounded" />
                    </div>
                  </SidebarMenuItem>
                ))
              ) : decks && decks.length > 0 ? (
                decks.map((deck) => (
                  <SidebarMenuItem key={deck.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeDeckId === deck.id}
                      data-testid={`link-deck-${deck.id}`}
                    >
                      <Link href={`/deck/${deck.id}`}>
                        <Layers className="w-4 h-4 flex-shrink-0" />
                        <span className="flex-1 truncate text-sm">{deck.name}</span>
                        <Badge variant="secondary" className="text-xs font-medium ml-auto">
                          {deck.cardCount}
                        </Badge>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">No decks yet</p>
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          data-testid="button-theme-toggle"
          className="h-8 w-8"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
