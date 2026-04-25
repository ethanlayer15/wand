/**
 * Onboarding project detail page — sidebar nav + stage panel layout.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Plus,
  CheckCircle2,
  RotateCw,
  ArrowRight,
  MessageSquarePlus,
  Mail,
  CheckCheck,
  Clock,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const STATE_BADGE: Record<string, string> = {
  not_started: "bg-zinc-100 text-zinc-700",
  in_progress: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
};

const STATE_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

type FieldDef = {
  key: string;
  label: string;
  type: "text" | "longtext" | "number" | "money" | "url" | "boolean" | "date";
  placeholder?: string;
};

type ChecklistItemDef = { id: string; label: string; hint?: string };

export default function OnboardingProject({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const projectQuery = trpc.onboarding.projects.get.useQuery({ id });
  const data = projectQuery.data;

  const [activeStageIdx, setActiveStageIdx] = useState<number | null>(null);
  const [notifyNextOpen, setNotifyNextOpen] = useState(false);
  const [completeProjectOpen, setCompleteProjectOpen] = useState(false);

  const completeProject = trpc.onboarding.projects.update.useMutation({
    onSuccess: () => {
      toast.success("Project archived");
      setLocation("/onboarding");
    },
    onError: (e) => toast.error(e.message),
  });

  const completeStage = trpc.onboarding.stages.complete.useMutation({
    onSuccess: () => {
      toast.success("Stage marked complete");
      projectQuery.refetch();
      const d = projectQuery.data;
      if (!d || activeStageIdx === null) return;
      const stgs = d.stages as any[];
      const curSt = stgs.find((s: any) => s.stageIndex === activeStageIdx);
      const nextSt = curSt ? stgs.find((s: any) => s.stageIndex === curSt.stageIndex + 1) : undefined;
      if (curSt && curSt.stageIndex < stgs.length - 1 && !nextSt?.notifiedAt) {
        setNotifyNextOpen(true);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const reopenStage = trpc.onboarding.stages.reopen.useMutation({
    onSuccess: () => { toast.success("Stage reopened"); projectQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const notifyNext = trpc.onboarding.stages.notifyNext.useMutation({
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (data && activeStageIdx === null) {
      setActiveStageIdx(0);
    }
  }, [data, activeStageIdx]);

  if (projectQuery.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading project…</div>
    );
  }
  if (!data) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">Project not found.</p>
        <Button variant="ghost" onClick={() => setLocation("/onboarding")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Onboarding
        </Button>
      </div>
    );
  }

  const { project, template, stages, events } = data;

  const stagesConfig = (template?.stagesConfig ?? []) as Array<{
    key: string;
    label: string;
    ownerRole?: string;
    defaultChecklist: ChecklistItemDef[];
    defaultFields: FieldDef[];
  }>;

  const activeStage =
    activeStageIdx !== null
      ? stages.find((s: any) => s.stageIndex === activeStageIdx)
      : undefined;
  const activeStageDef =
    activeStageIdx !== null ? stagesConfig[activeStageIdx] : undefined;
  const nextStage = activeStage
    ? (stages.find((ns: any) => ns.stageIndex === activeStage.stageIndex + 1) ?? null)
    : null;
  const isLastStage = activeStage ? activeStage.stageIndex === stages.length - 1 : false;

  return (
    <div className="flex flex-col h-svh overflow-hidden pt-6 px-6 pb-6">
      {/* Header */}
      <div className="shrink-0 space-y-2 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/onboarding")}
          className="-ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Onboarding
        </Button>
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.propertyName}
            </h1>
            {project.address && (
              <p className="text-sm text-muted-foreground">{project.address}</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Badge variant="secondary">{template?.name}</Badge>
              <Badge
                variant="secondary"
                className={
                  project.status === "active"
                    ? "bg-blue-100 text-blue-800"
                    : project.status === "done"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-zinc-200 text-zinc-700"
                }
              >
                {project.status === "done" ? "Archived" : project.status}
              </Badge>
            </div>
          </div>
          {project.status !== "done" && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 flex-nowrap justify-end">
                {activeStage && (
                  activeStage.state !== "done" ? (
                    <Button
                      onClick={() => completeStage.mutate({ stageInstanceId: activeStage.id })}
                      disabled={completeStage.isPending}
                      className="gap-1.5"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {completeStage.isPending ? "Completing…" : "Mark stage complete"}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => reopenStage.mutate({ stageInstanceId: activeStage.id })}
                      disabled={reopenStage.isPending}
                      className="gap-1.5"
                    >
                      <RotateCw className="h-4 w-4" />
                      {reopenStage.isPending ? "Reopening…" : "Reopen stage"}
                    </Button>
                  )
                )}
                <Button
                  variant="outline"
                  className="gap-1.5 text-zinc-600 border-zinc-300 hover:bg-zinc-50"
                  onClick={() => setCompleteProjectOpen(true)}
                >
                  <CheckCheck className="h-4 w-4" />
                  Archive project
                </Button>
              </div>
              {/* Notification status — fixed height so buttons don't jump */}
              <div className="h-7 flex items-center justify-end">
                {activeStage && !isLastStage && nextStage?.notifiedAt && (
                  <div className="flex items-center gap-2 flex-nowrap justify-end">
                    {nextStage.notificationReceivedAt ? (
                      <div className="flex items-center gap-1.5 text-sm text-emerald-700 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Next stage notified — confirmed
                      </div>
                    ) : !nextStage.notificationSkipped ? (
                      <>
                        <div className="flex items-center gap-1.5 text-sm text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          Waiting on next stage confirmation
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setNotifyNextOpen(true)}
                          className="h-7 px-2 text-xs text-muted-foreground gap-1"
                        >
                          <ArrowRight className="h-3 w-3" />
                          Re-notify
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 text-sm text-zinc-500">
                          <ArrowRight className="h-3.5 w-3.5" />
                          Notification skipped
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setNotifyNextOpen(true)}
                          className="h-7 px-2 text-xs text-muted-foreground gap-1"
                        >
                          <ArrowRight className="h-3 w-3" />
                          Notify now
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Two-column: stage navigator + panel */}
      <div className="flex gap-6 flex-1 min-h-0 overflow-hidden">
        {/* Stage navigator */}
        <nav className="w-48 shrink-0 space-y-0.5 pt-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          {stages.map((s: any) => {
            const isActive = s.stageIndex === activeStageIdx;
            const isDone = s.state === "done";
            const isInProgress = s.state === "in_progress";
            const label = stagesConfig[s.stageIndex]?.label ?? `Stage ${s.stageIndex + 1}`;
            return (
              <button
                key={s.id}
                onClick={() => setActiveStageIdx(s.stageIndex)}
                className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle2 className={`h-4 w-4 ${isActive ? "text-emerald-400" : "text-emerald-500"}`} />
                  ) : isInProgress ? (
                    <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${isActive ? "border-blue-400" : "border-blue-500"}`}>
                      <div className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-blue-400" : "bg-blue-500"}`} />
                    </div>
                  ) : (
                    <div className={`h-4 w-4 rounded-full border-2 ${isActive ? "border-zinc-500" : "border-zinc-300"}`} />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{label}</p>
                  {s.stageIndex > 0 && (
                    <p className="text-xs mt-0.5 truncate leading-snug text-zinc-400">
                      {s.ownerName ? s.ownerName.split(" ")[0] : "Unassigned"}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Stage panel */}
        <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          <div className="pb-8">
            {activeStage && activeStageDef ? (
              <StagePanel
                projectId={project.id}
                stage={activeStage}
                stageDef={activeStageDef}
                events={events}
                onMutate={() => projectQuery.refetch()}
                isLastStage={isLastStage}
                isKickoff={activeStage.stageIndex === 0}
                kickoffData={(project.kickoffData ?? {}) as Record<string, any>}
                kickoffSchema={(template?.kickoffFieldSchema ?? []) as FieldDef[]}
                propertyName={project.propertyName}
                projectAddress={project.address ?? undefined}
                templateName={template?.name}
                nextStage={nextStage}
                onOpenNotifyNext={() => setNotifyNextOpen(true)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Archive project confirmation dialog */}
      <Dialog open={completeProjectOpen} onOpenChange={(o) => { if (!o) setCompleteProjectOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive this project?</DialogTitle>
            <DialogDescription>
              Only do this when every stage is fully done and the property is live.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span>
              Don't confuse this with completing a single stage — use{" "}
              <strong>Mark stage complete</strong> for that.
              Archiving the project is permanent and removes it from the active pipeline.
            </span>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompleteProjectOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={completeProject.isPending}
              onClick={() => completeProject.mutate({ id: project.id, status: "done" })}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              <CheckCheck className="h-4 w-4" />
              {completeProject.isPending ? "Archiving…" : "Yes, archive project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notify next stage dialog */}
      {activeStage && activeStageDef && !isLastStage && (
        <NotifyNextDialog
          open={notifyNextOpen}
          onClose={() => setNotifyNextOpen(false)}
          stageInstanceId={activeStage.id}
          projectId={project.id}
          propertyName={project.propertyName}
          currentStageName={activeStageDef.label}
          currentStageOwnerName={activeStage.ownerName ?? null}
          nextStageName={stagesConfig[activeStage.stageIndex + 1]?.label ?? null}
          nextStageOwnerName={nextStage?.ownerName ?? null}
          nextStageOwnerSlackId={(nextStage as any)?.ownerSlackUserId ?? null}
          isSameOwner={nextStage?.ownerUserId != null && nextStage.ownerUserId === activeStage.ownerUserId}
          notifyNext={notifyNext}
          onMutate={() => projectQuery.refetch()}
        />
      )}
    </div>
  );
}

// ── Stage Panel ───────────────────────────────────────────────────────
function StagePanel({
  projectId,
  stage,
  stageDef,
  events,
  onMutate,
  isLastStage,
  isKickoff = false,
  kickoffData = {},
  kickoffSchema = [],
  propertyName,
  projectAddress,
  templateName,
  nextStage,
  onOpenNotifyNext,
}: {
  projectId: number;
  stage: any;
  stageDef: {
    key: string;
    label: string;
    defaultChecklist: ChecklistItemDef[];
    defaultFields: FieldDef[];
  };
  events: any[];
  onMutate: () => void;
  isLastStage: boolean;
  isKickoff?: boolean;
  kickoffData?: Record<string, any>;
  kickoffSchema?: FieldDef[];
  propertyName?: string;
  projectAddress?: string;
  templateName?: string;
  nextStage?: any | null;
  onOpenNotifyNext: () => void;
}) {
  const checklistState = (stage.checklistState ?? {}) as Record<string, any>;
  const stageData = (stage.stageData ?? {}) as Record<string, any>;

  const templateItems = stageDef.defaultChecklist;
  const customItems = useMemo(() => {
    return Object.entries(checklistState)
      .filter(([, v]: any) => v?.custom && !v?.hidden)
      .map(([id, v]: any) => ({
        id,
        label: v.label as string,
        hint: v.hint as string | undefined,
      }));
  }, [checklistState]);

  const visibleTemplateItems = templateItems.filter((it) => !checklistState[it.id]?.hidden);
  const checklistTotal = visibleTemplateItems.length + customItems.length;
  const checklistDone = [...visibleTemplateItems, ...customItems].filter(
    (it) => checklistState[it.id]?.done,
  ).length;

  const customFields = Array.isArray(stageData._custom)
    ? (stageData._custom as Array<FieldDef & { value?: any }>)
    : [];

  const toggleItem = trpc.onboarding.stages.toggleChecklistItem.useMutation({
    onSuccess: () => onMutate(),
    onError: (e) => toast.error(e.message),
  });
  const updateItemMeta = trpc.onboarding.stages.updateChecklistItemMeta.useMutation({
    onSuccess: () => onMutate(),
    onError: (e) => toast.error(e.message),
  });
  const addItem = trpc.onboarding.stages.addCustomChecklistItem.useMutation({
    onSuccess: () => onMutate(),
    onError: (e) => toast.error(e.message),
  });
  const updateField = trpc.onboarding.stages.updateField.useMutation({
    onSuccess: () => onMutate(),
    onError: (e) => toast.error(e.message),
  });
  const comment = trpc.onboarding.stages.comment.useMutation({
    onSuccess: () => {
      setCommentBody("");
      onMutate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteComment = trpc.onboarding.stages.deleteComment.useMutation({
    onSuccess: () => onMutate(),
    onError: (e) => toast.error(e.message),
  });
  const markReceived = trpc.onboarding.stages.markNotificationReceived.useMutation({
    onSuccess: () => { toast.success("Marked as received"); onMutate(); },
    onError: (e) => toast.error(e.message),
  });

  const stageComments = useMemo(() => {
    return [...(events ?? [])]
      .filter((e: any) => e.stageInstanceId === stage.id && e.eventType === "comment_added")
      .reverse();
  }, [events, stage.id]);

  const [commentBody, setCommentBody] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(propertyName ?? "");
  const [editAddress, setEditAddress] = useState(projectAddress ?? "");
  const [editKickoff, setEditKickoff] = useState<Record<string, any>>(kickoffData);

  const updateProject = trpc.onboarding.projects.update.useMutation({
    onSuccess: () => { setEditing(false); onMutate(); toast.success("Property info saved"); },
    onError: (e) => toast.error(e.message),
  });

  function savePropertyInfo() {
    if (!editName.trim()) { toast.error("Property name is required"); return; }
    updateProject.mutate({
      id: projectId,
      propertyName: editName.trim(),
      address: editAddress.trim() || undefined,
      kickoffData: editKickoff,
    });
  }

  const extraKickoffSchema = kickoffSchema.filter(
    (f) => !["address", "property_name"].includes(f.key),
  );
  const kickoffFields = extraKickoffSchema.filter(
    (f) => kickoffData[f.key] != null && kickoffData[f.key] !== "",
  );

  return (
    <div className="space-y-5">
      {/* Stage header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Badge variant="secondary" className={`${STATE_BADGE[stage.state] ?? ""}`}>
            {STATE_LABEL[stage.state] ?? stage.state}
          </Badge>
          {!isKickoff && stage.ownerName && (
            <span className="text-sm text-muted-foreground">{stage.ownerName}</span>
          )}
        </div>
        {!isKickoff && checklistTotal > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {checklistDone}/{checklistTotal} done
          </span>
        )}
      </div>

      {/* Handoff received banner */}
      {stage.notifiedAt && !stage.notificationReceivedAt && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <Clock className="h-4 w-4 shrink-0" />
            This stage has been handed off to you — let the team know you're on it.
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={markReceived.isPending}
            onClick={() => markReceived.mutate({ stageInstanceId: stage.id })}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark as received
          </Button>
        </div>
      )}
      {stage.notificationReceivedAt && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Handoff confirmed — you've acknowledged this stage.
        </div>
      )}

      {/* Property Info card — kickoff only */}
      {isKickoff && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="font-medium text-sm">Property Info</p>
              <div className="flex items-center gap-2">
                {editing ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditName(propertyName ?? ""); setEditAddress(projectAddress ?? ""); setEditKickoff(kickoffData); }}>
                      Cancel
                    </Button>
                    <Button size="sm" disabled={updateProject.isPending} onClick={savePropertyInfo}>
                      {updateProject.isPending ? "Saving…" : "Save"}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setEmailDialogOpen(true)}
                >
                  <Mail className="h-4 w-4" />
                  Send slack to team
                </Button>
              </div>
            </div>

            {editing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Property name *</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="e.g. Laurel Cove" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Address</Label>
                  <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="123 Main St, City, ST 12345" />
                </div>
                {extraKickoffSchema
                  .filter((f) => f.key !== "pet_fee" || editKickoff.pets_allowed === true)
                  .map((f) => (
                  <div key={f.key} className={f.type === "longtext" ? "sm:col-span-2" : ""}>
                    <Label className="text-xs text-muted-foreground">{f.label}</Label>
                    {f.type === "longtext" ? (
                      <Textarea
                        value={(editKickoff[f.key] as string) ?? ""}
                        onChange={(e) => setEditKickoff((p) => ({ ...p, [f.key]: e.target.value }))}
                        rows={3}
                        className="mt-1"
                      />
                    ) : f.type === "boolean" ? (
                      <Select
                        value={editKickoff[f.key] === true ? "yes" : editKickoff[f.key] === false ? "no" : ""}
                        onValueChange={(v) => setEditKickoff((p) => ({ ...p, [f.key]: v === "yes" ? true : v === "no" ? false : undefined }))}
                      >
                        <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : f.type === "money" ? (
                      <div className="relative mt-1">
                        {(editKickoff[f.key] !== undefined && editKickoff[f.key] !== "") && (
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 pointer-events-none">$</span>
                        )}
                        <Input
                          type="number"
                          value={(editKickoff[f.key] as string) ?? ""}
                          onChange={(e) => setEditKickoff((p) => ({ ...p, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder={f.placeholder ?? "0"}
                          className={(editKickoff[f.key] !== undefined && editKickoff[f.key] !== "") ? "pl-6" : ""}
                        />
                      </div>
                    ) : (
                      <Input
                        type={f.type === "number" ? "number" : f.type === "url" ? "url" : f.type === "date" ? "date" : "text"}
                        value={(editKickoff[f.key] as string) ?? ""}
                        onChange={(e) => setEditKickoff((p) => ({ ...p, [f.key]: e.target.value }))}
                        className="mt-1"
                        placeholder={f.placeholder}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {propertyName && (
                  <div>
                    <p className="text-xs text-muted-foreground">Property name</p>
                    <p className="text-sm font-medium">{propertyName}</p>
                  </div>
                )}
                {projectAddress && (
                  <div>
                    <p className="text-xs text-muted-foreground">Address</p>
                    <p className="text-sm">{projectAddress}</p>
                  </div>
                )}
                {kickoffFields
                  .filter((f) => f.key !== "pet_fee" || kickoffData.pets_allowed === true)
                  .map((f) => (
                  <div key={f.key} className={f.type === "longtext" ? "sm:col-span-2" : "min-w-0"}>
                    <p className="text-xs text-muted-foreground">{f.label}</p>
                    {f.type === "url" ? (
                      <a
                        href={String(kickoffData[f.key])}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline truncate block"
                        title={String(kickoffData[f.key])}
                      >
                        {String(kickoffData[f.key])}
                      </a>
                    ) : f.type === "money" ? (
                      <p className="text-sm">${kickoffData[f.key]}</p>
                    ) : (
                      <p className="text-sm truncate">
                        {typeof kickoffData[f.key] === "boolean"
                          ? kickoffData[f.key] ? "Yes" : "No"
                          : String(kickoffData[f.key])}
                      </p>
                    )}
                  </div>
                ))}
                {!propertyName && !projectAddress && kickoffFields.length === 0 && (
                  <p className="text-xs text-muted-foreground col-span-2">No info provided yet — click Edit to add.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Checklist */}
      {(templateItems.length > 0 || customItems.length > 0 || !isKickoff) && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm">Checklist</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddItemOpen(true)}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Add item
              </Button>
            </div>
            <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden -mt-1">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: checklistTotal > 0 ? `${(checklistDone / checklistTotal) * 100}%` : "0%" }}
              />
            </div>
            <div className="space-y-0.5">
              {templateItems.length === 0 && customItems.length === 0 && (
                <p className="text-xs text-muted-foreground">No checklist items yet.</p>
              )}
              {visibleTemplateItems.map((it) => (
                <ChecklistRow
                  key={it.id}
                  item={{ ...it, label: checklistState[it.id]?.labelOverride ?? it.label }}
                  state={checklistState[it.id]}
                  onToggle={(done, note) =>
                    toggleItem.mutate({
                      stageInstanceId: stage.id,
                      itemId: it.id,
                      done,
                      ...(note !== undefined ? { note } : {}),
                    })
                  }
                  onRename={(label) => updateItemMeta.mutate({ stageInstanceId: stage.id, itemId: it.id, label })}
                  onDelete={() => updateItemMeta.mutate({ stageInstanceId: stage.id, itemId: it.id, hidden: true })}
                />
              ))}
              {customItems.map((it) => (
                <ChecklistRow
                  key={it.id}
                  item={it}
                  custom
                  state={checklistState[it.id]}
                  onToggle={(done, note) =>
                    toggleItem.mutate({
                      stageInstanceId: stage.id,
                      itemId: it.id,
                      done,
                      ...(note !== undefined ? { note } : {}),
                    })
                  }
                  onRename={(label) => updateItemMeta.mutate({ stageInstanceId: stage.id, itemId: it.id, label })}
                  onDelete={() => updateItemMeta.mutate({ stageInstanceId: stage.id, itemId: it.id, hidden: true })}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Comments — hidden on kickoff */}
      {!isKickoff && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-sm flex items-center gap-1.5">
              <MessageSquarePlus className="h-4 w-4" /> Comments
            </p>

            {stageComments.length > 0 && (
              <div className="space-y-3 divide-y divide-zinc-100">
                {stageComments.map((e: any) => (
                  <div key={e.id} className="flex items-start gap-2 group pt-3 first:pt-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-zinc-800">{e.actorName ?? "Someone"}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(e.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-700 mt-0.5 whitespace-pre-wrap">{(e.data as any)?.body}</p>
                    </div>
                    <button
                      onClick={() => deleteComment.mutate({ eventId: e.id })}
                      disabled={deleteComment.isPending}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-zinc-400 hover:text-red-500 rounded shrink-0 mt-0.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a note for the team about this stage…"
                rows={2}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!commentBody.trim() || comment.isPending}
                  onClick={() =>
                    comment.mutate({
                      stageInstanceId: stage.id,
                      body: commentBody.trim(),
                    })
                  }
                >
                  {comment.isPending ? "Posting…" : "Post comment"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <AddItemDialog
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        onSubmit={(label, hint) =>
          addItem.mutate(
            { stageInstanceId: stage.id, label, hint },
            { onSuccess: () => setAddItemOpen(false) },
          )
        }
      />
      {isKickoff && (
        <SlackTeamDialog
          open={emailDialogOpen}
          onClose={() => setEmailDialogOpen(false)}
          projectId={projectId}
          propertyName={propertyName}
          projectAddress={projectAddress}
          kickoffData={kickoffData}
          kickoffSchema={kickoffSchema}
          templateName={templateName}
          onMutate={onMutate}
        />
      )}
    </div>
  );
}

// ── Checklist Row ─────────────────────────────────────────────────────
function ChecklistRow({
  item,
  state,
  onToggle,
  onRename,
  onDelete,
  custom,
}: {
  item: ChecklistItemDef;
  state?: { done?: boolean; note?: string; hidden?: boolean };
  onToggle: (done: boolean, note?: string) => void;
  onRename?: (label: string) => void;
  onDelete?: () => void;
  custom?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(state?.note ?? "");
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(item.label);
  const isDone = !!state?.done;

  function commitRename() {
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== item.label) onRename?.(trimmed);
    else setDraftLabel(item.label);
    setEditing(false);
  }

  return (
    <div className="group">
      <div className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg hover:bg-zinc-50 transition-colors">
        <Checkbox
          checked={isDone}
          onCheckedChange={(c) => onToggle(c === true)}
          className="mt-[3px] shrink-0"
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              autoFocus
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setDraftLabel(item.label); setEditing(false); }
              }}
              className="h-7 text-sm"
            />
          ) : (
            <p className={`text-sm leading-snug transition-colors ${isDone ? "line-through text-zinc-400" : "text-zinc-800"}`}>
              {item.label}
              {custom && (
                <Badge variant="secondary" className="ml-2 text-[10px] py-0 bg-purple-100 text-purple-800">
                  custom
                </Badge>
              )}
            </p>
          )}
          {item.hint && !editing && (
            <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>
          )}
          {state?.note && !noteOpen && !editing && (
            <p className="text-xs text-zinc-500 italic mt-0.5">Note: {state.note}</p>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
            <button
              onClick={() => { setDraftNote(state?.note ?? ""); setNoteOpen((o) => !o); }}
              className="px-1.5 py-0.5 text-[11px] rounded text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              {state?.note ? "note" : "+ note"}
            </button>
            {onRename && (
              <button onClick={() => { setDraftLabel(item.label); setEditing(true); }} className="p-1 text-zinc-400 hover:text-zinc-700 rounded">
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} className="p-1 text-zinc-400 hover:text-red-500 rounded">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
      {noteOpen && (
        <div className="flex items-center gap-2 pl-9 pb-1.5 pr-2">
          <Input
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="e.g. waiting on photos from owner"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") { onToggle(isDone, draftNote); setNoteOpen(false); }
              if (e.key === "Escape") setNoteOpen(false);
            }}
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs shrink-0"
            onClick={() => { onToggle(isDone, draftNote); setNoteOpen(false); }}
          >
            Save
          </Button>
          <button
            className="p-1 text-zinc-400 hover:text-zinc-600 rounded shrink-0"
            onClick={() => setNoteOpen(false)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Stage Field (inline editor) ───────────────────────────────────────
function StageField({
  field,
  value,
  onSave,
  custom,
}: {
  field: FieldDef;
  value: any;
  onSave: (v: any) => void;
  custom?: boolean;
}) {
  const [draft, setDraft] = useState<any>(value ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
    setDirty(false);
  }, [value]);

  function commit() {
    if (!dirty) return;
    onSave(
      field.type === "money" || field.type === "number"
        ? draft === "" || draft === null ? null : Number(draft)
        : field.type === "boolean"
          ? draft === "yes" ? true : draft === "no" ? false : null
          : draft,
    );
    setDirty(false);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">
          {field.label}
          {custom && (
            <Badge variant="secondary" className="ml-2 text-[10px] py-0 bg-purple-100 text-purple-800">
              custom
            </Badge>
          )}
        </Label>
        {dirty && (
          <Button size="sm" className="h-6 text-xs px-2" onClick={commit}>
            Save
          </Button>
        )}
      </div>
      {field.type === "longtext" ? (
        <Textarea
          value={draft ?? ""}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          onBlur={commit}
          rows={2}
        />
      ) : field.type === "boolean" ? (
        <Select
          value={draft === true || draft === "yes" ? "yes" : draft === false || draft === "no" ? "no" : ""}
          onValueChange={(v) => {
            setDraft(v);
            setDirty(true);
            onSave(v === "yes" ? true : v === "no" ? false : null);
            setDirty(false);
          }}
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={
            field.type === "money" || field.type === "number" ? "number"
              : field.type === "url" ? "url"
                : field.type === "date" ? "date"
                  : "text"
          }
          value={draft ?? ""}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          onBlur={commit}
          placeholder={field.placeholder}
        />
      )}
    </div>
  );
}

// ── Add Item Dialog ───────────────────────────────────────────────────
function AddItemDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (label: string, hint?: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [hint, setHint] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setLabel(""); setHint(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a custom checklist item</DialogTitle>
          <DialogDescription>Specific to this property — won't change the template.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Replace lockbox code per owner" />
          </div>
          <div className="space-y-1.5">
            <Label>Hint (optional)</Label>
            <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="More context" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!label.trim()} onClick={() => onSubmit(label.trim(), hint.trim() || undefined)}>
            Add item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Notify Next Stage Dialog ──────────────────────────────────────────

function buildNotifyNextMessage(opts: {
  propertyName?: string;
  currentStageName: string;
  currentStageOwnerName: string | null;
  nextStageName: string | null;
  nextStageOwnerName: string | null;
  nextStageOwnerSlackId: string | null;
  projectId: number;
}): string {
  const mention = opts.nextStageOwnerSlackId
    ? `<@${opts.nextStageOwnerSlackId}>`
    : opts.nextStageOwnerName
      ? `*${opts.nextStageOwnerName.split(" ")[0]}*`
      : "team";

  const property = opts.propertyName ?? "a new property";
  const next = opts.nextStageName ?? "your stage";

  return [
    `Hey ${mention}!`,
    "",
    `The stage *${opts.currentStageName}* for *${property}* has been completed. *${next}* is ready to be started!`,
  ].join("\n");
}

function NotifyNextDialog({
  open,
  onClose,
  stageInstanceId,
  projectId,
  propertyName,
  currentStageName,
  currentStageOwnerName,
  nextStageName,
  nextStageOwnerName,
  nextStageOwnerSlackId,
  isSameOwner,
  notifyNext,
  onMutate,
}: {
  open: boolean;
  onClose: () => void;
  stageInstanceId: number;
  projectId: number;
  propertyName?: string;
  currentStageName: string;
  currentStageOwnerName: string | null;
  nextStageName: string | null;
  nextStageOwnerName: string | null;
  nextStageOwnerSlackId: string | null;
  isSameOwner: boolean;
  notifyNext: ReturnType<typeof trpc.onboarding.stages.notifyNext.useMutation>;
  onMutate: () => void;
}) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setMessage(buildNotifyNextMessage({
      propertyName,
      currentStageName,
      currentStageOwnerName,
      nextStageName,
      nextStageOwnerName,
      nextStageOwnerSlackId,
      projectId,
    }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSend() {
    notifyNext.mutate(
      { stageInstanceId, slackMessage: message.trim() || undefined },
      {
        onSuccess: () => { toast.success("Next stage notified"); onMutate(); onClose(); },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function handleSkip() {
    notifyNext.mutate(
      { stageInstanceId },
      {
        onSuccess: () => { onMutate(); onClose(); },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const toName = nextStageOwnerName ? nextStageOwnerName.split(" ")[0] : "next stage";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Notify {toName} — {nextStageName ?? "next stage"}</DialogTitle>
          <DialogDescription>
            {nextStageOwnerSlackId
              ? `This will post to #onboarding and @mention ${nextStageOwnerName?.split(" ")[0] ?? "them"} directly.`
              : nextStageOwnerName
                ? `${nextStageOwnerName.split(" ")[0]} doesn't have a Slack account linked — this will post to #onboarding without a mention.`
                : "This will post to #onboarding."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-zinc-50 border px-3 py-2 text-xs text-zinc-500 space-y-0.5">
            <p className="font-medium text-zinc-700">Stage handoff</p>
            <p>Completing: <span className="font-medium text-zinc-800">{currentStageName}</span></p>
            <p>Handing off to: <span className="font-medium text-zinc-800">{nextStageName ?? "next stage"}</span>
              {nextStageOwnerName ? ` → ${nextStageOwnerName}` : ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder="Type a message…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={notifyNext.isPending} onClick={handleSkip}>
            Skip message
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={notifyNext.isPending || !message.trim()}
            onClick={handleSend}
            className="gap-1.5"
          >
            <ArrowRight className="h-4 w-4" />
            {notifyNext.isPending ? "Sending…" : `Notify ${toName}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Slack Team Dialog ─────────────────────────────────────────────────

type SlackPreset = "kickoff" | "custom";

function buildSlackMessage(opts: {
  propertyName?: string;
  address?: string;
  kickoffData: Record<string, any>;
  kickoffSchema: FieldDef[];
  projectId: number;
  templateName?: string;
}): string {
  const appUrl = window.location.origin;
  const fieldLines = opts.kickoffSchema
    .filter(
      (f) =>
        !["address", "property_name"].includes(f.key) &&
        opts.kickoffData[f.key] != null &&
        opts.kickoffData[f.key] !== "" &&
        !(f.key === "pet_fee" && opts.kickoffData.pets_allowed !== true),
    )
    .map((f) => {
      const val = typeof opts.kickoffData[f.key] === "boolean"
        ? (opts.kickoffData[f.key] ? "Yes" : "No")
        : f.type === "money"
          ? `$${opts.kickoffData[f.key]}`
          : opts.kickoffData[f.key];
      return `• *${f.label}:* ${val}`;
    })
    .join("\n");

  return [
    `🏠 *New property onboarding started: ${opts.propertyName ?? "(unnamed)"}*`,
    opts.address ? `📍 ${opts.address}` : null,
    opts.templateName ? `📋 Template: ${opts.templateName}` : null,
    fieldLines ? `\n${fieldLines}` : null,
    `\n<${appUrl}/onboarding/${opts.projectId}|View in Wand>`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function SlackTeamDialog({
  open,
  onClose,
  projectId,
  propertyName,
  projectAddress,
  kickoffData,
  kickoffSchema,
  templateName,
  onMutate,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  propertyName?: string;
  projectAddress?: string;
  kickoffData: Record<string, any>;
  kickoffSchema: FieldDef[];
  templateName?: string;
  onMutate: () => void;
}) {
  const [preset, setPreset] = useState<SlackPreset>("kickoff");
  const [message, setMessage] = useState("");

  const notifyTeam = trpc.onboarding.projects.notifyTeam.useMutation({
    onSuccess: () => {
      toast.success("Slack sent to team");
      onMutate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!open) return;
    if (preset === "kickoff") {
      setMessage(buildSlackMessage({
        propertyName,
        address: projectAddress,
        kickoffData,
        kickoffSchema,
        projectId,
        templateName,
      }));
    } else {
      setMessage("");
    }
  }, [preset, open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send slack to team</DialogTitle>
          <DialogDescription>
            Review the message before sending it to the #onboarding Slack channel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as SlackPreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kickoff">Kickoff announcement</SelectItem>
                <SelectItem value="custom">Custom (blank)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={10}
              className="font-mono text-xs"
              placeholder="Type a message…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={notifyTeam.isPending || !message.trim()}
            onClick={() => notifyTeam.mutate({ projectId, message: message.trim() })}
            className="gap-1.5"
          >
            <Mail className="h-4 w-4" />
            {notifyTeam.isPending ? "Sending…" : "Send slack to team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Activity Log ──────────────────────────────────────────────────────
function ActivityLog({ events }: { events: any[] }) {
  if (events.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <p className="font-medium text-sm">Activity</p>
        <ul className="space-y-1.5 text-xs">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className="text-muted-foreground tabular-nums w-[110px] shrink-0">
                {new Date(e.createdAt).toLocaleString()}
              </span>
              <span className="font-mono text-[11px] text-zinc-600 w-[160px] shrink-0">
                {e.eventType}
              </span>
              <span className="flex-1 text-zinc-700 break-words">
                {summarizeEvent(e)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function summarizeEvent(e: any): string {
  const d = e.data ?? {};
  switch (e.eventType) {
    case "project_created":
      return `Project created from template ${d.templateSlug ?? d.templateId}`;
    case "stage_started":
      return `Stage ${(d.stageIndex ?? 0) + 1} (${d.stageKey ?? ""}) started${d.auto ? " automatically" : ""}`;
    case "stage_completed":
      return `Stage ${(d.stageIndex ?? 0) + 1} (${d.stageKey ?? ""}) marked complete`;
    case "stage_reopened":
      return `Stage ${(d.stageIndex ?? 0) + 1} reopened${d.reason ? ` — ${d.reason}` : ""}`;
    case "notify_next":
      return `Notified next stage (${d.toStageKey ?? d.toStageIndex})${d.currentStageStillOpen ? " — current still open" : ""}`;
    case "checklist_item_toggled":
      return `Checklist item ${d.itemId} → ${d.done ? "done" : "undone"}`;
    case "checklist_item_added":
      return `Custom checklist item added: ${d.label ?? d.itemId}`;
    case "field_updated":
      return `Field ${d.fieldKey ?? ""} updated${d.custom ? " (custom)" : ""}`;
    case "owner_reassigned":
      return `Stage ${(d.stageIndex ?? 0) + 1} reassigned`;
    case "comment_added":
      return d.body ? `Comment: ${d.body}` : "Comment added";
    case "status_changed":
      return `Status → ${d.newStatus ?? "?"}${d.auto ? " (auto)" : ""}`;
    default:
      return JSON.stringify(d);
  }
}
