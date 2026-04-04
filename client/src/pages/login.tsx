import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-20 h-20 rounded-3xl bg-primary flex items-center justify-center shadow-xl shadow-primary/30">
            <Layers className="w-10 h-10 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">DeckLens</h1>
            <p className="text-muted-foreground text-sm mt-1">Magic: The Gathering · Card Scanner</p>
          </div>
        </div>

        {/* Feature list */}
        <div className="w-full space-y-3">
          {[
            ["📷", "Snap a card, identify it instantly"],
            ["⚡", "NPU-accelerated text detection"],
            ["📦", "Your decks synced across devices"],
            ["💰", "Market prices & deck analytics"],
          ].map(([icon, text]) => (
            <div key={text} className="flex items-center gap-3 px-4 py-3 bg-muted/50 rounded-xl">
              <span className="text-xl">{icon}</span>
              <span className="text-sm text-foreground/80">{text}</span>
            </div>
          ))}
        </div>

        {/* Sign in */}
        <div className="w-full flex flex-col gap-3">
          <a href="/api/login" className="w-full">
            <Button className="w-full h-12 text-base font-semibold shadow-lg" data-testid="button-sign-in">
              Sign in to continue
            </Button>
          </a>
          <p className="text-center text-xs text-muted-foreground px-4">
            Sign in with Google, GitHub, Apple, or email.{" "}
            <span className="font-medium text-foreground/70">No personal data is stored</span> — only your deck list.
          </p>
        </div>
      </div>
    </div>
  );
}
