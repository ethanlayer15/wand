/**
 * Viv Voice Profile — View and manage Ethan's writing style profile.
 * Allows triggering a scan of sent emails to build/update the voice profile.
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Sparkles,
  Mic,
  RefreshCw,
  Loader2,
  CheckCircle2,
  BookOpen,
  MessageSquare,
  Pen,
  User,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function VivVoiceProfile() {
  const [building, setBuilding] = useState(false);

  const profileQuery = trpc.viv.getVoiceProfile.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const buildMutation = trpc.viv.buildVoiceProfile.useMutation({
    onMutate: () => setBuilding(true),
    onSuccess: (data) => {
      setBuilding(false);
      profileQuery.refetch();
      if (data.success) {
        toast.success(`Voice profile built from ${data.sampleCount} sent emails`);
      } else {
        toast.error(data.error || "Failed to build voice profile");
      }
    },
    onError: () => {
      setBuilding(false);
      toast.error("Failed to build voice profile");
    },
  });

  const profileData = profileQuery.data;
  const profile = profileData?.profile;
  const isLoading = profileQuery.isLoading;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--viv-bg)", color: "var(--viv-cream)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b px-6 py-3 flex items-center justify-between" style={{ borderColor: "var(--viv-border)", background: "var(--viv-bg)" }}>
        <div className="flex items-center gap-3">
          <Link href="/viv">
            <button className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--viv-text-muted)] hover:text-[var(--viv-cream)] transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-[var(--viv-gold)]" />
            <span className="text-base font-semibold tracking-tight" style={{ color: "var(--viv-cream)" }}>Voice Profile</span>
            <span className="text-xs font-medium tracking-wide uppercase" style={{ color: "var(--viv-text-muted)" }}>by Viv</span>
          </div>
        </div>

        <button
          onClick={() => buildMutation.mutate()}
          disabled={building}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{ background: "var(--viv-gold)", color: "var(--viv-navy)" }}
        >
          {building ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {profile ? "Re-learn My Voice" : "Learn My Voice"}
        </button>
      </div>

      <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--viv-gold)" }} />
          </div>
        ) : !profile ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(var(--viv-gold-rgb),0.12)" }}>
              <Mic className="w-8 h-8 text-[var(--viv-gold)]" />
            </div>
            <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--viv-cream)" }}>
              No voice profile yet
            </h2>
            <p className="text-sm leading-relaxed max-w-md mb-8" style={{ color: "var(--viv-text-muted)" }}>
              Viv will scan your last 50–100 sent emails to learn how you write — your greeting style, tone, common phrases, and how you handle different topics. All AI draft replies will then sound like <em>you</em>, not generic AI.
            </p>
            <button
              onClick={() => buildMutation.mutate()}
              disabled={building}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: "var(--viv-gold)", color: "var(--viv-navy)" }}
            >
              {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {building ? "Analyzing sent emails..." : "Learn My Voice"}
            </button>
            {building && (
              <p className="text-xs mt-3" style={{ color: "var(--viv-text-muted)" }}>
                This takes 30–60 seconds. Viv is reading your sent emails…
              </p>
            )}
          </div>
        ) : (
          /* Profile display */
          <div className="space-y-6">
            {/* Status bar */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(var(--viv-gold-rgb),0.08)", border: "1px solid rgba(var(--viv-gold-rgb),0.2)" }}>
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--viv-cream)" }}>Voice profile active</p>
                <p className="text-xs" style={{ color: "var(--viv-text-muted)" }}>
                  All Viv draft replies use this profile.              {profileData?.lastUpdated ? new Date(profileData.lastUpdated).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "recently"}.
                </p>
              </div>
              {profileData?.sampleCount && (
                <div className="text-right">
                  <p className="text-lg font-bold" style={{ color: "var(--viv-gold)" }}>{profileData.sampleCount}</p>
                  <p className="text-xs" style={{ color: "var(--viv-text-muted)" }}>emails analyzed</p>
                </div>
              )}
            </div>

            {/* Profile sections */}
            {/* Greeting + Tone + Sign-off */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Greeting Style", value: profile.greetingStyle },
                { label: "Tone", value: profile.tone },
                { label: "Sign-off Style", value: profile.signOffStyle },
              ].map((item) => (
                <div key={item.label} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--viv-border)" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--viv-text-muted)" }}>{item.label}</p>
                  <p className="text-sm" style={{ color: "var(--viv-cream)" }}>{item.value}</p>
                </div>
              ))}
            </div>

            {/* Personality Traits */}
            {profile.personalityTraits && profile.personalityTraits.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <User className="w-4 h-4 text-[var(--viv-gold)]" />
                  <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--viv-cream)" }}>
                    Personality Traits
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {profile.personalityTraits.map((trait, i) => (
                    <span
                      key={i}
                      className="text-xs px-3 py-1.5 rounded-full font-medium"
                      style={{ background: "rgba(var(--viv-gold-rgb),0.12)", color: "var(--viv-gold)" }}
                    >
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Common Phrases */}
            {profile.commonPhrases && profile.commonPhrases.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="w-4 h-4 text-[var(--viv-gold)]" />
                  <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--viv-cream)" }}>
                    Common Phrases
                  </span>
                </div>
                <div className="space-y-2">
                  {profile.commonPhrases.map((phrase, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Pen className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--viv-text-muted)" }} />
                      <span className="text-sm italic" style={{ color: "var(--viv-cream)" }}>"{ phrase}"</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* System prompt preview */}
            {profile.systemPrompt && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-[var(--viv-gold)]" />
                  <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--viv-cream)" }}>
                    AI System Prompt
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "var(--viv-text-muted)" }}>
                    used in all draft replies
                  </span>
                </div>
                <div className="rounded-xl p-4 text-xs leading-relaxed" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--viv-border)", color: "var(--viv-text-muted)", fontFamily: "monospace" }}>
                  {profile.systemPrompt.slice(0, 600)}{profile.systemPrompt.length > 600 ? "…" : ""}
                </div>
              </div>
            )}

            {/* How it works */}
            <div className="rounded-xl p-5 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--viv-border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--viv-text-muted)" }}>How Voice Profile works</p>
              <div className="space-y-2 text-xs" style={{ color: "var(--viv-text-muted)" }}>
                <div className="flex items-start gap-2">
                  <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>Viv scans your last 50–100 sent emails to learn your writing style, tone, and common phrases.</span>
                </div>
                <div className="flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>Every AI draft reply includes your voice profile so drafts sound like you wrote them.</span>
                </div>
                <div className="flex items-start gap-2">
                  <Pen className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>When you edit a draft before sending, Viv stores the correction to refine your profile over time.</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
