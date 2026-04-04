import { useEffect } from "react";
import { Layers, Loader2 } from "lucide-react";

export default function LoginPage() {
  useEffect(() => {
    // Automatically redirect to the login endpoint for a lean experience
    window.location.href = "/api/login";
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Layers className="w-8 h-8 text-primary animate-pulse" />
      </div>
      <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      <p className="text-sm text-muted-foreground animate-pulse">Redirecting to Sign In...</p>
    </div>
  );
}
