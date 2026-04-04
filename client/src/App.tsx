import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Scanner from "@/pages/scanner";
import Decks from "@/pages/home";
import DeckDetail from "@/pages/deck";
import LoginPage from "@/pages/login";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { Layers, Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Layers className="w-8 h-8 text-primary" />
      </div>
      <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
    </div>
  );
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <LoginPage />;

  return (
    <Switch>
      <Route path="/" component={Scanner} />
      <Route path="/decks" component={Decks} />
      <Route path="/deck/:id" component={DeckDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
