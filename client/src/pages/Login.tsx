import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";

// Google "G" logo SVG
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// Wand icon for branding
function WandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <line x1="5" y1="27" x2="22" y2="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="4.5" cy="27.5" r="2" fill="currentColor" opacity="0.7" />
      <path d="M22 7 L23.2 9.8 L26 11 L23.2 12.2 L22 15 L20.8 12.2 L18 11 L20.8 9.8 Z" fill="#F08542" opacity="0.95" />
      <circle cx="27" cy="7" r="1" fill="#F08542" opacity="0.6" />
      <circle cx="25" cy="4" r="0.7" fill="#F08542" opacity="0.4" />
    </svg>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  domain_restricted: "Only @leisrstays.com Google accounts can sign in to Wand.",
  not_invited: "You don't have an invitation yet. Ask your admin to invite you.",
  google_auth_denied: "Google sign-in was cancelled. Please try again.",
  google_auth_failed: "Google sign-in failed. Please try again.",
};

export default function Login() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  // Parse error from URL
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const error = params.get("error");
    if (error && ERROR_MESSAGES[error]) {
      toast.error(ERROR_MESSAGES[error]);
      // Clean the URL
      window.history.replaceState({}, "", "/login");
    }
  }, [searchString]);

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      setLocation("/");
    }
  }, [loading, user, setLocation]);

  const handleGoogleSignIn = () => {
    const origin = window.location.origin;
    window.location.href = `/api/auth/google?origin=${encodeURIComponent(origin)}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo and branding */}
        <div className="flex flex-col items-center mb-8">
          <WandIcon className="h-12 w-12 text-foreground mb-3" />
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Outfit, sans-serif" }}>
            Wand
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Property Management Intelligence
          </p>
        </div>

        <Card className="border shadow-sm">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-lg">Welcome back</CardTitle>
            <CardDescription>
              Sign in with your LeisrStays Google account
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <Button
              variant="outline"
              className="w-full h-11 gap-3 text-sm font-medium bg-white hover:bg-gray-50 border-gray-300"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <GoogleIcon className="h-5 w-5" />
              Sign in with Google
            </Button>

            <p className="text-xs text-muted-foreground text-center mt-4">
              Only <span className="font-medium">@leisrstays.com</span> accounts are allowed.
              <br />
              Contact your admin if you need an invitation.
            </p>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Powered by LeisrStays
        </p>
      </div>
    </div>
  );
}
