/**
 * Onboarding project detail page.
 *
 * Layout: project header on top, one tab per stage (with status badge),
 * selected stage panel showing checklist (template + custom + per-item
 * notes), per-stage fields (template + custom), per-stage comments, and
 * action buttons (complete / reopen / notify next). Activity log lives in
 * a panel at the bottom.
 *
 * Stages are concurrent — completing one or notifying the next does not
 * block the other; the badges show what's actually open.
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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

  // Default to the latest active stage when data first lands
  useEffect(() => {
    if (data && activeStageIdx === null) {
      setActiveStageIdx(data.project.currentStageIndex ?? 0);
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

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/onboarding")}
          className="-ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Onboarding
        </Button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
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
                      : project.status === "blocked"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-zinc-200 text-zinc-700"
                }
              >
                {project.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Stage tabs */}
      <Tabs
        value={activeStageIdx !== null ? String(activeStageIdx) : undefined}
        onValueChange={(v) => setActiveStageIdx(Number(v))}
      >
        <TabsList className="flex-wrap h-auto">
          {stages.map((s: any) => (
            <TabsTrigger
              key={s.id}
              value={String(s.stageIndex)}
              className="gap-2"
            >
              <span>
                {stagesConfig[s.stageIndex]?.label ?? `Stage ${s.stageIndex + 1}`}
              </span>
              <Badge
                variant="secondary"
                className={`text-[10px] py-0 ${STATE_BADGE[s.state] ?? ""}`}
              >
                {STATE_LABEL[s.state] ?? s.state}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {stages.map((s: any) => (
          <TabsContent key={s.id} value={String(s.stageIndex)} className="mt-4">
            {activeStage && activeStageDef && s.id === activeStage.id ? (
              <StagePanel
                projectId={project.id}
                stage={activeStage}
                stageDef={activeStageDef}
                onMutate={() => projectQuery.refetch()}
                isLastStage={s.stageIndex === stages.length - 1}
                isKickoff={activeStage.stageIndex === 0}
                kickoffData={(project.kickoffData ?? {}) as Record<string, any>}
                kickoffSchema={(template?.kickoffFieldSchema ?? []) as FieldDef[]}
                propertyName={project.propertyName}
                projectAddress={project.address ?? undefined}
                templateName={template?.name}
                allStages={stages}
                allStagesConfig={stagesConfig}
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>

      {/* Activity log */}
      <ActivityLog events={events} />
    </div>
  );
}

// ── Stage Panel ───────────────────────────────────────────────────────
function StagePanel({
  projectId,
  stage,
  stageDef,
  onMutate,
  isLastStage,
  isKickoff = false,
  kickoffData = {},
  kickoffSchema = [],
  propertyName,
  projectAddress,
  templateName,
  allStages,
  allStagesConfig,
}: {
  projectId: number;
  stage: any;
  stageDef: {
    key: string;
    label: string;
    defaultChecklist: ChecklistItemDef[];
    defaultFields: FieldDef[];
  };
  onMutate: () => void;
  isLastStage: boolean;
  isKickoff?: boolean;
  kickoffData?: Record<string, any>;
  kickoffSchema?: FieldDef[];
  propertyName?: string;
  projectAddress?: string;
  templateName?: string;
  allStages?: any[];
  allStagesConfig?: Array<{ key: string; label: string; ownerRole?: string; defaultChecklist: ChecklistItemDef[]; defaultFields: FieldDef[] }>;
}) {
  const checklistState = (stage.checklistState ?? {}) as Record<string, any>;
  const stageData = (stage.stageData ?? {}) as Record<string, any>;

  // Custom items live inside checklistState too — separate by `custom: true`
  const templateItems = stageDef.defaultChecklist;
  const customItems = useMemo(() => {
    return Object.entries(checklistState)
      .filter(([, v]: any) => v?.custom)
      .map(([id, v]: any) => ({
        id,
        label: v.label as string,
        hint: v.hint as string | undefined,
      }));
  }, [checklistState]);

  // Custom fields live in stageData._custom (array)
  const customFields = Array.isArray(stageData._custom)
    ? (stageData._custom as Array<FieldDef & { value?: any }>)
    : [];

  const toggleItem = trpc.onboarding.stages.toggleChecklistItem.useMutation({
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
  const addField = trpc.onboarding.stages.addCustomField.useMutation({
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
  const completeStage = trpc.onboarding.stages.complete.useMutation({
    onSuccess: () => {
      toast.success("Stage marked complete");
      onMutate();
    },
    onError: (e) => toast.error(e.message),
  });
  const reopenStage = trpc.onboarding.stages.reopen.useMutation({
    onSuccess: () => {
      toast.success("Stage reopened");
      onMutate();
    },
    onError: (e) => toast.error(e.message),
  });
  const notifyNext = trpc.onboarding.stages.notifyNext.useMutation({
    onSuccess: () => {
      toast.success("Next stage notified");
      onMutate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [commentBody, setCommentBody] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  // Property Info card state
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

  // Filter schema fields that aren't already shown as top-level (address, property_name)
  const extraKickoffSchema = kickoffSchema.filter(
    (f) => !["address", "property_name"].includes(f.key),
  );
  const kickoffFields = extraKickoffSchema.filter(
    (f) => kickoffData[f.key] != null && kickoffData[f.key] !== "",
  );

  return (
    <div className="space-y-6">
      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {stage.state !== "done" ? (
          <Button
            onClick={() =>
              completeStage.mutate({ stageInstanceId: stage.id })
            }
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" /> Mark stage complete
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() =>
              reopenStage.mutate({ stageInstanceId: stage.id })
            }
            className="gap-1.5"
          >
            <RotateCw className="h-4 w-4" /> Reopen stage
          </Button>
        )}
        {!isLastStage && (
          <Button
            variant="secondary"
            onClick={() => notifyNext.mutate({ stageInstanceId: stage.id })}
            className="gap-1.5"
          >
            <ArrowRight className="h-4 w-4" /> Notify next stage
          </Button>
        )}
      </div>

      {/* Property Info card — only on stage 0 */}
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
                  Send email to team
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
                {extraKickoffSchema.map((f) => (
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
                    ) : (
                      <Input
                        type={f.type === "number" || f.type === "money" ? "number" : f.type === "url" ? "url" : f.type === "date" ? "date" : "text"}
                        value={(editKickoff[f.key] as string) ?? ""}
                        onChange={(e) => setEditKickoff((p) => ({ ...p, [f.key]: e.target.value }))}
                        className="mt-1"
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
                {kickoffFields.map((f) => (
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

      {/* Team assignments — kickoff only */}
      {isKickoff && allStages && allStagesConfig && allStagesConfig.length > 1 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-sm">Team</p>
            <div className="divide-y">
              {allStagesConfig.slice(1).map((cfg, i) => {
                const si = allStages[i + 1];
                if (!si) return null;
                return (
                  <StageAssignRow
                    key={cfg.key}
                    stageLabel={cfg.label}
                    stageInstance={si}
                    onMutate={onMutate}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklist — hidden on kickoff stage */}
      {!isKickoff && <Card>
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
          <div className="space-y-2">
            {templateItems.length === 0 && customItems.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No checklist items yet.
              </p>
            )}
            {templateItems.map((it) => (
              <ChecklistRow
                key={it.id}
                item={it}
                state={checklistState[it.id]}
                onToggle={(done, note) =>
                  toggleItem.mutate({
                    stageInstanceId: stage.id,
                    itemId: it.id,
                    done,
                    ...(note !== undefined ? { note } : {}),
                  })
                }
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
              />
            ))}
          </div>
        </CardContent>
      </Card>}

      {/* Fields — hidden on kickoff stage */}
      {!isKickoff && <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">Stage info</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddFieldOpen(true)}
              className="gap-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add field
            </Button>
          </div>
          {stageDef.defaultFields.length === 0 && customFields.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No fields defined for this stage. Add one if this property needs
              something extra captured.
            </p>
          )}
          <div className="space-y-3">
            {stageDef.defaultFields.map((f) => (
              <StageField
                key={f.key}
                field={f}
                value={stageData[f.key]}
                onSave={(v) =>
                  updateField.mutate({
                    stageInstanceId: stage.id,
                    fieldKey: f.key,
                    value: v,
                  })
                }
              />
            ))}
            {customFields.map((f) => (
              <StageField
                key={`custom_${f.key}`}
                field={f}
                value={stageData[f.key]}
                custom
                onSave={(v) =>
                  updateField.mutate({
                    stageInstanceId: stage.id,
                    fieldKey: f.key,
                    value: v,
                  })
                }
              />
            ))}
          </div>
        </CardContent>
      </Card>}

      {/* Comment — hidden on kickoff stage */}
      {!isKickoff && <Card>
        <CardContent className="p-4 space-y-2">
          <p className="font-medium text-sm flex items-center gap-1.5">
            <MessageSquarePlus className="h-4 w-4" /> Add a comment
          </p>
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
        </CardContent>
      </Card>}

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
      <AddFieldDialog
        open={addFieldOpen}
        onClose={() => setAddFieldOpen(false)}
        onSubmit={(payload) =>
          addField.mutate(
            { stageInstanceId: stage.id, ...payload },
            { onSuccess: () => setAddFieldOpen(false) },
          )
        }
      />
      {isKickoff && (
        <EmailTeamDialog
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

// ── Checklist Row (inline note editor) ────────────────────────────────
function ChecklistRow({
  item,
  state,
  onToggle,
  custom,
}: {
  item: ChecklistItemDef;
  state?: { done?: boolean; note?: string };
  onToggle: (done: boolean, note?: string) => void;
  custom?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(state?.note ?? "");

  return (
    <div className="border rounded-md p-2.5 space-y-2 hover:bg-zinc-50/50 transition-colors">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={!!state?.done}
          onCheckedChange={(c) => onToggle(c === true)}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug">
            {item.label}
            {custom && (
              <Badge
                variant="secondary"
                className="ml-2 text-[10px] py-0 bg-purple-100 text-purple-800"
              >
                custom
              </Badge>
            )}
          </p>
          {item.hint && (
            <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>
          )}
          {state?.note && !noteOpen && (
            <p className="text-xs text-zinc-700 italic mt-1">
              note: {state.note}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={() => {
            setDraftNote(state?.note ?? "");
            setNoteOpen((o) => !o);
          }}
        >
          {state?.note ? "Edit note" : "Add note"}
        </Button>
      </div>
      {noteOpen && (
        <div className="flex items-center gap-2 pl-6">
          <Input
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="e.g. waiting on photos from owner"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            onClick={() => {
              onToggle(!!state?.done, draftNote);
              setNoteOpen(false);
            }}
          >
            Save
          </Button>
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
        ? draft === "" || draft === null
          ? null
          : Number(draft)
        : field.type === "boolean"
          ? draft === "yes"
            ? true
            : draft === "no"
              ? false
              : null
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
            <Badge
              variant="secondary"
              className="ml-2 text-[10px] py-0 bg-purple-100 text-purple-800"
            >
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
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onBlur={commit}
          rows={2}
        />
      ) : field.type === "boolean" ? (
        <Select
          value={draft === true || draft === "yes" ? "yes" : draft === false || draft === "no" ? "no" : ""}
          onValueChange={(v) => {
            setDraft(v);
            setDirty(true);
            // Boolean changes commit on selection
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
            field.type === "money" || field.type === "number"
              ? "number"
              : field.type === "url"
                ? "url"
                : field.type === "date"
                  ? "date"
                  : "text"
          }
          value={draft ?? ""}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setLabel("");
          setHint("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a custom checklist item</DialogTitle>
          <DialogDescription>
            Specific to this property — won't change the template.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Replace lockbox code per owner"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Hint (optional)</Label>
            <Input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="More context"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!label.trim()}
            onClick={() => onSubmit(label.trim(), hint.trim() || undefined)}
          >
            Add item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Field Dialog ──────────────────────────────────────────────────
function AddFieldDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    key: string;
    label: string;
    type: FieldDef["type"];
    value?: any;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldDef["type"]>("text");

  function submit() {
    if (!label.trim()) return;
    const key = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
    onSubmit({ key: key || `field_${Date.now()}`, label: label.trim(), type });
    setLabel("");
    setType("text");
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setLabel("");
          setType("text");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a custom field</DialogTitle>
          <DialogDescription>
            Capture something this property needs that the template doesn't
            cover.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Field label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. HOA contact"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Short text</SelectItem>
                <SelectItem value="longtext">Long text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="money">Money</SelectItem>
                <SelectItem value="url">URL</SelectItem>
                <SelectItem value="boolean">Yes / No</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!label.trim()} onClick={submit}>
            Add field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Stage Assign Row ──────────────────────────────────────────────────
function StageAssignRow({
  stageLabel,
  stageInstance,
  onMutate,
}: {
  stageLabel: string;
  stageInstance: any;
  onMutate: () => void;
}) {
  const membersQuery = trpc.onboarding.projects.members.useQuery();
  const members = membersQuery.data ?? [];

  const assign = trpc.onboarding.stages.assign.useMutation({
    onSuccess: () => onMutate(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <p className="text-sm">{stageLabel}</p>
      <Select
        value={stageInstance.ownerUserId ? String(stageInstance.ownerUserId) : "__none__"}
        onValueChange={(v) =>
          assign.mutate({
            stageInstanceId: stageInstance.id,
            ownerUserId: v === "__none__" ? null : Number(v),
          })
        }
      >
        <SelectTrigger className="w-[180px] h-8 text-sm">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Unassigned</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              {m.name ?? m.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Email Team Dialog ─────────────────────────────────────────────────

const EMAIL_PRESETS = {
  kickoff: { label: "Kickoff announcement" },
  custom: { label: "Custom (blank)" },
} as const;

type PresetKey = keyof typeof EMAIL_PRESETS;

function buildKickoffBody(opts: {
  propertyName?: string;
  address?: string;
  kickoffData: Record<string, any>;
  kickoffSchema: FieldDef[];
  projectId: number;
  templateName?: string;
}): { subject: string; body: string } {
  const appUrl = window.location.origin;
  const fieldLines = opts.kickoffSchema
    .filter(
      (f) =>
        !["address", "property_name"].includes(f.key) &&
        opts.kickoffData[f.key] != null &&
        opts.kickoffData[f.key] !== "",
    )
    .map(
      (f) =>
        `  ${f.label}: ${typeof opts.kickoffData[f.key] === "boolean" ? (opts.kickoffData[f.key] ? "Yes" : "No") : opts.kickoffData[f.key]}`,
    )
    .join("\n");

  const lines = [
    "Hi team,",
    "",
    `A new property is ready for onboarding: ${opts.propertyName ?? "(unnamed)"}`,
    opts.address ? `Address: ${opts.address}` : null,
    opts.templateName ? `Template: ${opts.templateName}` : null,
    "",
    fieldLines ? `Property info:\n${fieldLines}` : null,
    "",
    `View in Wand: ${appUrl}/onboarding/${opts.projectId}`,
    "",
    "— Leisr Stays",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return {
    subject: `[Wand] New onboarding: ${opts.propertyName ?? "new property"}`,
    body: lines,
  };
}

function EmailTeamDialog({
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
  const [preset, setPreset] = useState<PresetKey>("kickoff");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());

  const membersQuery = trpc.onboarding.projects.members.useQuery(undefined, {
    enabled: open,
  });
  const members = membersQuery.data ?? [];

  const notifyTeam = trpc.onboarding.projects.notifyTeam.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Email sent to ${res.sentTo.length} member${res.sentTo.length === 1 ? "" : "s"}`,
      );
      onMutate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // Auto-populate subject + body when preset or open state changes
  useEffect(() => {
    if (!open) return;
    if (preset === "kickoff") {
      const built = buildKickoffBody({
        propertyName,
        address: projectAddress,
        kickoffData,
        kickoffSchema,
        projectId,
        templateName,
      });
      setSubject(built.subject);
      setBody(built.body);
    } else {
      setSubject("");
      setBody("");
    }
  }, [preset, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Select all members by default when dialog opens and members load
  useEffect(() => {
    if (open && members.length > 0) {
      setSelectedEmails(
        new Set(members.filter((m) => m.email).map((m) => m.email as string)),
      );
    }
  }, [open, members.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleEmail(email: string) {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function handleSend() {
    const to = [...selectedEmails];
    if (to.length === 0) {
      toast.error("Select at least one recipient");
      return;
    }
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    notifyTeam.mutate({ projectId, to, subject: subject.trim(), body: body.trim() });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send email to team</DialogTitle>
          <DialogDescription>
            Choose a template, review the message, and select recipients.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Template selector */}
          <div className="space-y-1.5">
            <Label>Email template</Label>
            <Select
              value={preset}
              onValueChange={(v) => setPreset(v as PresetKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(EMAIL_PRESETS) as [PresetKey, { label: string }][]).map(
                  ([key, { label }]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="font-mono text-xs"
              placeholder="Email body…"
            />
          </div>

          {/* Recipients */}
          <div className="space-y-2">
            <Label>Recipients</Label>
            {membersQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">
                Loading team members…
              </p>
            ) : members.filter((m) => m.email).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No team members with emails found.
              </p>
            ) : (
              <div className="border rounded-md p-3 space-y-2">
                {members
                  .filter((m) => m.email)
                  .map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`member-${m.id}`}
                        checked={selectedEmails.has(m.email as string)}
                        onCheckedChange={() => toggleEmail(m.email as string)}
                      />
                      <label
                        htmlFor={`member-${m.id}`}
                        className="text-sm cursor-pointer"
                      >
                        {m.name ?? m.email}
                        {m.name && m.email && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({m.email})
                          </span>
                        )}
                      </label>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              notifyTeam.isPending ||
              selectedEmails.size === 0 ||
              !subject.trim()
            }
            onClick={handleSend}
            className="gap-1.5"
          >
            <Mail className="h-4 w-4" />
            {notifyTeam.isPending
              ? "Sending…"
              : `Send to ${selectedEmails.size} member${selectedEmails.size === 1 ? "" : "s"}`}
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
