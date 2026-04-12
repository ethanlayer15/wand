/**
 * OpsInbox — Wanda's suggestion queue (the universal human-in-loop gate).
 *
 * Every Wanda workflow (Review Drafter, Task Triage, Performance Coach, etc.)
 * drops cards here. Ops can approve, edit, dismiss, or snooze.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Inbox, CheckCircle2, XCircle, ChevronDown, ChevronRight, Sparkles, Play, Pencil } from "lucide-react";
import { toast } from "sonner";

type StatusFilter = "pending" | "approved" | "dismissed";

function ReviewReplyPreview({ action, editedDraft, onEditDraft }: {
  action: any;
  editedDraft: string | null;
  onEditDraft: (draft: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const draft = editedDraft ?? action?.draft ?? "";

  return (
    <div className="space-y-2">
      <div className="font-medium text-muted-foreground text-xs mb-1">Draft Reply</div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => onEditDraft(e.target.value)}
            rows={5}
            className="text-sm"
          />
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
            Done editing
          </Button>
        </div>
      ) : (
        <div
          className="whitespace-pre-wrap bg-muted/50 rounded p-3 text-sm cursor-pointer hover:bg-muted/70 transition-colors relative group"
          onClick={() => setEditing(true)}
        >
          {draft}
          <Pencil className="h-3 w-3 absolute top-2 right-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  s,
  isPending,
  expanded,
  onToggle,
  onApprove,
  onDismiss,
  isApproving,
  isDismissing,
}: {
  s: any;
  isPending: boolean;
  expanded: boolean;
  onToggle: () => void;
  onApprove: (editedContent?: string) => void;
  onDismiss: () => void;
  isApproving: boolean;
  isDismissing: boolean;
}) {
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const isReviewReply = s.kind === "review_reply";
  const action = s.proposedAction as any;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="mt-0.5 text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm">{s.title}</h3>
            <Badge variant="outline" className="text-[10px]">{s.agentName}</Badge>
            <Badge variant="outline" className="text-[10px]">{s.kind}</Badge>
            {s.confidence != null && (
              <span className="text-[10px] text-muted-foreground">
                {Math.round(Number(s.confidence) * 100)}%
              </span>
            )}
          </div>
          {s.summary && (
            <p className="text-xs text-muted-foreground mt-1">{s.summary}</p>
          )}

          {expanded && (
            <div className="mt-3 space-y-3 text-xs">
              {s.reasoning && (
                <div>
                  <div className="font-medium text-muted-foreground mb-1">Reasoning</div>
                  <div className="whitespace-pre-wrap bg-muted/50 rounded p-2">{s.reasoning}</div>
                </div>
              )}

              {isReviewReply && action ? (
                <ReviewReplyPreview
                  action={action}
                  editedDraft={editedDraft}
                  onEditDraft={setEditedDraft}
                />
              ) : action ? (
                <div>
                  <div className="font-medium text-muted-foreground mb-1">Proposed action</div>
                  <pre className="whitespace-pre-wrap bg-muted/50 rounded p-2 text-[10px] overflow-x-auto">
                    {JSON.stringify(action, null, 2)}
                  </pre>
                </div>
              ) : null}

              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span>Created {new Date(s.createdAt).toLocaleString()}</span>
                {s.relatedListingId && <span>Listing #{s.relatedListingId}</span>}
                {s.relatedReviewId && <span>Review #{s.relatedReviewId}</span>}
                {s.relatedCleanerId && <span>Cleaner #{s.relatedCleanerId}</span>}
              </div>

              {s.executionResult && (
                <div className="text-[10px] text-muted-foreground bg-green-50 dark:bg-green-950/30 rounded p-2">
                  {s.executionResult}
                </div>
              )}
            </div>
          )}
        </div>

        {isPending && (
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="default"
              onClick={() => onApprove(editedDraft ?? undefined)}
              disabled={isApproving}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {editedDraft ? "Approve (edited)" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              disabled={isDismissing}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function OpsInbox() {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const suggestionsQuery = trpc.agent.listSuggestions.useQuery(
    { status, limit: 200 },
    { refetchInterval: 30_000 }
  );

  const utils = trpc.useUtils();

  const approveMutation = trpc.agent.approve.useMutation({
    onSuccess: (data) => {
      toast.success(data.executionMessage || "Suggestion approved");
      utils.agent.listSuggestions.invalidate();
      utils.agent.pendingCount.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const dismissMutation = trpc.agent.dismiss.useMutation({
    onSuccess: () => {
      toast.success("Suggestion dismissed");
      utils.agent.listSuggestions.invalidate();
      utils.agent.pendingCount.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const drafterMutation = trpc.agent.runReviewDrafter.useMutation({
    onSuccess: (data) => {
      toast.success(`Drafter done: ${data.drafted} drafted, ${data.skipped} skipped`);
      utils.agent.listSuggestions.invalidate();
      utils.agent.pendingCount.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const pendingCountQuery = trpc.agent.pendingCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Inbox className="h-6 w-6" />
            Ops Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Wand AI suggestions — review, edit, approve, or dismiss.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => drafterMutation.mutate({})}
            disabled={drafterMutation.isPending}
          >
            <Play className="h-3.5 w-3.5 mr-1" />
            {drafterMutation.isPending ? "Drafting..." : "Run Review Drafter"}
          </Button>
          <Badge variant="secondary" className="text-sm">
            {pendingCountQuery.data?.count ?? 0} pending
          </Badge>
        </div>
      </div>

      <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
        </TabsList>

        <TabsContent value={status} className="mt-4 space-y-2">
          {suggestionsQuery.isLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          )}

          {!suggestionsQuery.isLoading && suggestions.length === 0 && (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {status === "pending"
                  ? "No pending suggestions. Click \"Run Review Drafter\" to generate reply drafts."
                  : `No ${status} suggestions.`}
              </p>
            </div>
          )}

          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              isPending={status === "pending"}
              expanded={expandedIds.has(s.id)}
              onToggle={() => toggleExpand(s.id)}
              onApprove={(edited) => approveMutation.mutate({ id: s.id, editedContent: edited })}
              onDismiss={() => dismissMutation.mutate({ id: s.id })}
              isApproving={approveMutation.isPending}
              isDismissing={dismissMutation.isPending}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
