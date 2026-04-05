import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation, useParams, useSearch } from "wouter";
import {
  Archive,
  ArrowLeft,
  Clock,
  Forward,
  Mail,
  MailOpen,
  Reply,
  Send,
  Sparkles,
  Star,
  StarOff,
  Tag,
  X,
  Loader2,
  AlertCircle,
  Bell,
  Info,
  Volume2,
  Edit3,
  Check,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

// ── Helpers ────────────────────────────────────────────────────────────

const priorityConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  urgent: { label: "Urgent", color: "bg-viv-urgent text-white", icon: AlertCircle },
  important: { label: "Important", color: "bg-viv-important text-white", icon: Bell },
  fyi: { label: "FYI", color: "bg-viv-fyi text-white", icon: Info },
  noise: { label: "Noise", color: "bg-viv-noise/20 text-viv-noise", icon: Volume2 },
};

const categoryLabels: Record<string, string> = {
  owner_comms: "Owner Communications",
  guest_messages: "Guest Messages",
  vendor_maintenance: "Vendor / Maintenance",
  booking_platforms: "Booking Platforms",
  financial_invoices: "Financial / Invoices",
  marketing_newsletters: "Marketing / Newsletters",
  team_internal: "Team / Internal",
  other: "Other",
};

interface EmailAddress {
  name: string;
  address: string;
}

function senderName(from: EmailAddress[]): string {
  if (!from || from.length === 0) return "Unknown";
  return from[0].name || from[0].address.split("@")[0] || "Unknown";
}

function senderInitials(from: EmailAddress[]): string {
  const name = senderName(from);
  const parts = name.split(/[\s.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ── Component ──────────────────────────────────────────────────────────

export default function VivEmail() {
  const params = useParams<{ uid: string }>();
  const uid = parseInt(params.uid || "0", 10);
  const searchStr = useSearch();
  const autoReply = searchStr.includes("reply=true");
  const [, setLocation] = useLocation();

  const [replyOpen, setReplyOpen] = useState(autoReply);
  const [replyBody, setReplyBody] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // Fetch email
  const emailQuery = trpc.viv.email.useQuery({ uid }, { enabled: uid > 0 });
  const email = emailQuery.data;

  // Mutations
  const draftMutation = trpc.viv.draftReply.useMutation();
  const sendMutation = trpc.viv.send.useMutation();
  const archiveMutation = trpc.viv.archive.useMutation();
  const markReadMutation = trpc.viv.markRead.useMutation();
  const markUnreadMutation = trpc.viv.markUnread.useMutation();
  const starMutation = trpc.viv.star.useMutation();
  const unstarMutation = trpc.viv.unstar.useMutation();
  const snoozeMutation = trpc.viv.snooze.useMutation();

  // Auto-mark as read
  useEffect(() => {
    if (email && !email.isRead) {
      markReadMutation.mutate({ uid });
    }
  }, [email?.uid]);

  // Auto-open reply if ?reply=true
  useEffect(() => {
    if (autoReply && email) {
      handleDraftReply();
    }
  }, [autoReply, email?.uid]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          if (replyOpen) setReplyOpen(false);
          else setLocation("/viv");
          break;
        case "r":
          e.preventDefault();
          handleDraftReply();
          break;
        case "e":
          e.preventDefault();
          handleArchive();
          break;
        case "s":
          e.preventDefault();
          handleToggleStar();
          break;
        case "u":
          e.preventDefault();
          handleToggleRead();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [email, replyOpen]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleDraftReply = async () => {
    if (!email) return;
    setReplyOpen(true);
    setDraftLoading(true);

    try {
      const draft = await draftMutation.mutateAsync({
        uid: email.uid,
        subject: email.subject,
        from: email.from[0]?.address || "",
        fromName: senderName(email.from),
        bodyText: email.bodyText,
      });

      setReplySubject(draft.subject);
      setReplyBody(draft.body);
    } catch {
      toast.error("Failed to generate draft");
      setReplyBody("");
      setReplySubject(`Re: ${email.subject}`);
    } finally {
      setDraftLoading(false);
      setTimeout(() => replyRef.current?.focus(), 100);
    }
  };

  const handleSendReply = async () => {
    if (!email || !replyBody.trim()) return;
    setSending(true);

    try {
      await sendMutation.mutateAsync({
        to: email.from[0]?.address || "",
        subject: replySubject,
        body: replyBody,
        inReplyTo: email.messageId,
        references: email.references || [email.messageId],
      });

      toast.success("Reply sent");
      setReplyOpen(false);
      setReplyBody("");
    } catch {
      toast.error("Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const handleArchive = () => {
    if (!email) return;
    archiveMutation.mutate(
      { uid: email.uid, messageId: email.messageId },
      {
        onSuccess: () => {
          toast.success("Archived");
          setLocation("/viv");
        },
      }
    );
  };

  const handleToggleStar = () => {
    if (!email) return;
    if (email.isStarred) unstarMutation.mutate({ uid: email.uid });
    else starMutation.mutate({ uid: email.uid });
  };

  const handleToggleRead = () => {
    if (!email) return;
    if (email.isRead) markUnreadMutation.mutate({ uid: email.uid });
    else markReadMutation.mutate({ uid: email.uid });
  };

  const handleSnooze = (hours: number) => {
    if (!email) return;
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    snoozeMutation.mutate(
      { uid: email.uid, messageId: email.messageId, until },
      {
        onSuccess: () => {
          toast.success(`Snoozed for ${hours}h`);
          setSnoozeOpen(false);
        },
      }
    );
  };

  // ── Loading / Error ──────────────────────────────────────────────────

  if (emailQuery.isLoading) {
    return (
      <div className="h-[calc(100vh-0px)] flex items-center justify-center bg-viv-cream">
        <Loader2 className="h-6 w-6 animate-spin text-viv-gold" />
      </div>
    );
  }

  if (!email) {
    return (
      <div className="h-[calc(100vh-0px)] flex flex-col items-center justify-center bg-viv-cream text-viv-navy/40">
        <Mail className="h-10 w-10 mb-3" />
        <p className="text-sm">Email not found</p>
        <Button variant="ghost" size="sm" onClick={() => setLocation("/viv")} className="mt-3 text-viv-gold">
          Back to inbox
        </Button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col bg-viv-cream">
      {/* ── Top Bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-viv-cream-dark bg-white/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/viv")}
            className="h-8 w-8 p-0 text-viv-navy/60 hover:text-viv-navy"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-viv-gold" />
            <span className="text-sm font-medium text-viv-navy/60">Viv</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleDraftReply} className="h-8 gap-1.5 text-viv-navy/60 hover:text-viv-navy">
                <Reply className="h-3.5 w-3.5" />
                <span className="text-xs">Reply</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent><kbd>r</kbd></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleArchive} className="h-8 gap-1.5 text-viv-navy/60 hover:text-viv-navy">
                <Archive className="h-3.5 w-3.5" />
                <span className="text-xs">Archive</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent><kbd>e</kbd></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={() => setSnoozeOpen(true)} className="h-8 gap-1.5 text-viv-navy/60 hover:text-viv-navy">
                <Clock className="h-3.5 w-3.5" />
                <span className="text-xs">Snooze</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Snooze</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleToggleStar} className="h-8 w-8 p-0 text-viv-navy/60 hover:text-viv-gold">
                {email.isStarred ? <Star className="h-3.5 w-3.5 fill-viv-gold text-viv-gold" /> : <Star className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent><kbd>s</kbd></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleToggleRead} className="h-8 w-8 p-0 text-viv-navy/60 hover:text-viv-navy">
                {email.isRead ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent><kbd>u</kbd></TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Email Content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-6">
          {/* Subject */}
          <h1 className="text-2xl font-semibold text-viv-navy leading-tight mb-4">
            {email.subject}
          </h1>

          {/* Triage card */}
          {email.triage && (
            <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-viv-cream to-white border border-viv-cream-dark shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-viv-gold" />
                <span className="text-xs font-bold text-viv-navy/60 uppercase tracking-widest">Viv Analysis</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={`text-[10px] px-2 py-0.5 ${priorityConfig[email.triage.priority]?.color || "bg-muted"}`}>
                  {priorityConfig[email.triage.priority]?.label}
                </Badge>
                <span className="text-xs text-viv-navy/50 font-medium">
                  {categoryLabels[email.triage.category] || email.triage.category}
                </span>
              </div>
              <p className="text-sm text-viv-navy/70 leading-relaxed">{email.triage.summary}</p>
              <div className="flex items-center gap-1.5 mt-2">
                <Check className="h-3 w-3 text-viv-gold" />
                <span className="text-xs text-viv-gold-muted font-semibold">{email.triage.suggestedAction}</span>
              </div>
            </div>
          )}

          {/* Sender info */}
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-viv-cream-dark">
            <div className="h-10 w-10 rounded-full bg-viv-navy text-white flex items-center justify-center text-xs font-semibold">
              {senderInitials(email.from)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-viv-navy">{senderName(email.from)}</span>
                <span className="text-xs text-viv-navy/40">&lt;{email.from[0]?.address}&gt;</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-viv-navy/40 mt-0.5">
                <span>to {email.to.map((t) => t.name || t.address).join(", ")}</span>
                {email.cc && email.cc.length > 0 && (
                  <span>cc {email.cc.map((c) => c.name || c.address).join(", ")}</span>
                )}
              </div>
            </div>
            <span className="text-xs text-viv-navy/40">
              {new Date(email.date).toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>

          {/* Body */}
          {email.bodyHtml ? (
            <iframe
              srcDoc={email.bodyHtml}
              sandbox="allow-same-origin"
              className="w-full rounded-lg border border-viv-cream-dark"
              style={{ minHeight: 400, height: "auto" }}
              onLoad={(e) => {
                const iframe = e.currentTarget;
                try {
                  const doc = iframe.contentDocument || iframe.contentWindow?.document;
                  if (doc) {
                    iframe.style.height = doc.documentElement.scrollHeight + "px";
                  }
                } catch (_) {}
              }}
              title="Email content"
            />
          ) : (
            <div className="text-sm text-viv-navy/80 leading-relaxed whitespace-pre-wrap">
              {email.bodyText}
            </div>
          )}

          {/* Reply section */}
          {replyOpen && (
            <div className="mt-8 pt-6 border-t border-viv-cream-dark">
              <div className="flex items-center gap-2 mb-3">
                <Reply className="h-4 w-4 text-viv-navy/40" />
                <span className="text-sm font-medium text-viv-navy">Reply to {senderName(email.from)}</span>
                {draftLoading && (
                  <span className="flex items-center gap-1 text-xs text-viv-gold">
                    <Sparkles className="h-3 w-3 animate-pulse" />
                    Viv is drafting...
                  </span>
                )}
              </div>

              <Input
                value={replySubject}
                onChange={(e) => setReplySubject(e.target.value)}
                className="mb-2 text-sm bg-white border-viv-cream-dark"
                placeholder="Subject"
              />

              <Textarea
                ref={replyRef}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={draftLoading ? "Generating AI draft..." : "Write your reply..."}
                className="min-h-[200px] text-sm bg-white border-viv-cream-dark resize-y leading-relaxed"
                disabled={draftLoading}
              />

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleSendReply}
                    disabled={sending || !replyBody.trim()}
                    className="bg-viv-navy hover:bg-viv-navy-light text-white gap-1.5"
                  >
                    {sending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Send
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDraftReply}
                    disabled={draftLoading}
                    className="gap-1.5 border-viv-cream-dark text-viv-gold hover:text-viv-gold"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReplyOpen(false)}
                  className="text-viv-navy/40 hover:text-viv-navy"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Reply CTA when not open */}
          {!replyOpen && (
            <div className="mt-8 pt-6 border-t border-viv-cream-dark">
              <Button
                onClick={handleDraftReply}
                className="bg-viv-navy hover:bg-viv-navy-light text-white gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Draft Reply with Viv
              </Button>
              <p className="text-xs text-viv-navy/40 mt-2">
                Viv will analyze this email and draft a contextual reply using your property management data.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Snooze Dialog ───────────────────────────────────────────── */}
      <Dialog open={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-viv-gold" />
              Snooze Email
            </DialogTitle>
            <DialogDescription>
              This email will reappear in your inbox after the selected time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {[
              { label: "1 hour", hours: 1 },
              { label: "3 hours", hours: 3 },
              { label: "Tomorrow morning", hours: 18 },
              { label: "Tomorrow afternoon", hours: 24 },
              { label: "This weekend", hours: 72 },
              { label: "Next week", hours: 168 },
            ].map((opt) => (
              <Button
                key={opt.hours}
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(opt.hours)}
                className="justify-start text-sm border-viv-cream-dark hover:bg-viv-cream"
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
