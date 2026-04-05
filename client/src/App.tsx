import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
import Scanner from "@/pages/scanner";
import Decks from "@/pages/home";
import DeckDetail from "@/pages/deck";
import LoginPage from "@/pages/login";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { Layers, Loader2, X } from "lucide-react";

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

function PrivacyBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem("privacy_dismissed");
    if (!dismissed) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] bg-background/95 backdrop-blur-md border-t border-border p-4 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.2)]">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center gap-4 justify-between">
        <div className="text-xs sm:text-sm text-muted-foreground flex-1">
          <strong>Privacy Notice:</strong> We use strictly essential cookies to securely link your device to your anonymous guest profile, ensuring your decks are saved between sessions. By continuing to use DeckLense, you acknowledge our use of these essential cookies.
        </div>
        <Button className="w-full sm:w-auto flex-shrink-0 whitespace-nowrap" size="sm" onClick={() => {
          localStorage.setItem("privacy_dismissed", "true");
          setShow(false);
        }}>
          Got it
        </Button>
      </div>
    </div>
  );
}

function Router() {
  const { user, isLoading } = useAuth();

  return (
    <Switch>
      {/* Public route — accessible without login */}
      <Route path="/shared/:token">{() => <DeckDetail isShared />}</Route>
      {/* Auth-guarded routes */}
      {isLoading ? (
        <Route><LoadingScreen /></Route>
      ) : !user ? (
        <Route><LoginPage /></Route>
      ) : (
        <>
          <Route path="/" component={Scanner} />
          <Route path="/decks" component={Decks} />
          <Route path="/deck/:id">{() => <DeckDetail />}</Route>
          <Route component={NotFound} />
        </>
      )}
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
          <PrivacyBanner />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
