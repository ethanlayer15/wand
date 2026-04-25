/**
 * Onboarding — list + board views for property-onboarding projects.
 *
 * "List" view: card grid filtered by status. "Board" view: kanban with
 * one column per stage; a project card lives in the column of its
 * `currentStageIndex` (the latest-notified stage), with badges for any
 * earlier stages still open (since stages can run in parallel).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Plus, Building2, AlertCircle, Trash2, Settings, GripVertical, X, Pencil } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";

type View = "list" | "board";
type StatusFilter = "active" | "done";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  done: "Archived",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  done: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
};

export default function OnboardingList() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const projectsQuery = trpc.onboarding.projects.list.useQuery(
    { status: view === "board" ? "active" : statusFilter },
  );
  const templatesQuery = trpc.onboarding.templates.list.useQuery();

  const deleteProject = trpc.onboarding.projects.delete.useMutation({
    onSuccess: () => { toast.success("Project deleted"); projectsQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const moveProject = trpc.onboarding.projects.update.useMutation({
    onSuccess: () => projectsQuery.refetch(),
    onError: (e) => toast.error(e.message),
  });

  function handleDelete(id: number) {
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    deleteProject.mutate({ id });
  }
  function handleMove(id: number, stageIndex: number) {
    moveProject.mutate({ id, currentStageIndex: stageIndex });
  }

  const projects = projectsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-zinc-700" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Onboarding
            </h1>
            <p className="text-sm text-muted-foreground">
              Property onboarding projects
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New project
          </Button>
        </div>
      </div>

      {/* Filters + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {view === "list" && (
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="done">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="board">Board</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Body */}
      {projectsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading projects…</div>
      ) : projects.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : view === "list" ? (
        <ListView
          projects={projects}
          onOpen={(id) => setLocation(`/onboarding/${id}`)}
          onDelete={handleDelete}
        />
      ) : (
        <BoardView
          projects={projects}
          templates={templates}
          onOpen={(id) => setLocation(`/onboarding/${id}`)}
          onDelete={handleDelete}
          onMove={handleMove}
        />
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        templates={templates}
        onCreated={(id) => {
          setCreateOpen(false);
          projectsQuery.refetch();
          setLocation(`/onboarding/${id}`);
        }}
      />
      <OnboardingSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        templates={templates}
      />
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────
function ListView({
  projects,
  onOpen,
  onDelete,
}: {
  projects: any[];
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map((p) => (
        <Card
          key={p.id}
          onClick={() => onOpen(p.id)}
          className="cursor-pointer hover:shadow-md transition-shadow"
        >
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.propertyName}</p>
                {p.address && (
                  <p className="text-xs text-muted-foreground truncate">
                    {p.address}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="secondary"
                  className={STATUS_BADGE[p.status] ?? ""}
                >
                  {STATUS_LABEL[p.status] ?? p.status}
                </Badge>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                  className="text-zinc-400 hover:text-red-500 transition-colors p-0.5 rounded"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
              <span className="truncate">{p.templateName}</span>
              <span>Stage {p.currentStageIndex + 1}</span>
            </div>
            {p.creatorName && (
              <p className="text-xs text-muted-foreground">
                Created by {p.creatorName}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Board (kanban) view ───────────────────────────────────────────────
const COL_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-pink-500",
  "bg-indigo-500",
];

function BoardView({
  projects,
  templates,
  onOpen,
  onDelete,
  onMove,
}: {
  projects: any[];
  templates: any[];
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, stageIdx: number) => void;
}) {
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const columns = useMemo(() => {
    const richest = templates.reduce<any>((best, t) => {
      const len = (t.stagesConfig ?? []).length;
      return len > ((best?.stagesConfig ?? []).length ?? 0) ? t : best;
    }, null);
    if (!richest) return [];
    return ((richest.stagesConfig ?? []) as Array<{ label: string }>).map(
      (s, idx) => ({ idx, label: s.label }),
    );
  }, [templates]);

  if (columns.length === 0) {
    return <div className="text-sm text-muted-foreground">No templates configured yet.</div>;
  }

  const projectsByCol = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const p of projects) {
      const idx = p.currentStageIndex ?? 0;
      m.set(idx, [...(m.get(idx) ?? []), p]);
    }
    return m;
  }, [projects]);

  const stageLabel = useMemo(() => {
    const bySlug = new Map<string, Array<{ label: string }>>();
    for (const t of templates) {
      bySlug.set(t.slug, (t.stagesConfig ?? []) as Array<{ label: string }>);
    }
    return (slug: string, idx: number) => bySlug.get(slug)?.[idx]?.label ?? null;
  }, [templates]);

  function handleDragStart(e: React.DragEvent, projectId: number) {
    e.dataTransfer.setData("projectId", String(projectId));
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  }
  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const projectId = Number(e.dataTransfer.getData("projectId"));
    if (projectId) onMove(projectId, idx);
    setDragOverIdx(null);
  }

  return (
    <div className="flex gap-2 w-full">
      {columns.map((col) => {
        const cards = projectsByCol.get(col.idx) ?? [];
        const isOver = dragOverIdx === col.idx;
        const accentColor = COL_COLORS[col.idx % COL_COLORS.length];
        return (
          <div
            key={col.idx}
            onDragOver={(e) => handleDragOver(e, col.idx)}
            onDragLeave={() => setDragOverIdx(null)}
            onDrop={(e) => handleDrop(e, col.idx)}
            className={`flex-1 min-w-0 flex flex-col rounded-xl border transition-all ${
              isOver
                ? "border-blue-300 bg-blue-50 shadow-md"
                : "border-zinc-200 bg-zinc-50"
            }`}
          >
            {/* Column header */}
            <div className="flex items-center gap-1.5 px-2 pt-2.5 pb-2">
              <div className={`w-2 h-2 rounded-full shrink-0 ${accentColor}`} />
              <p className="text-xs font-semibold text-zinc-700 leading-tight flex-1 truncate">
                Stage {col.idx + 1}
              </p>
              {cards.length > 0 && (
                <span className="text-xs font-medium px-1 py-0.5 rounded-full bg-zinc-200 text-zinc-700">
                  {cards.length}
                </span>
              )}
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 px-2 pb-3 flex-1">
              {cards.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, p.id)}
                  onClick={() => onOpen(p.id)}
                  className="group bg-white rounded-lg border border-zinc-200 p-3 cursor-pointer hover:shadow-md hover:border-zinc-300 transition-all space-y-2"
                >
                  {/* Top row: name + delete */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-900 leading-snug break-words min-w-0">
                      {p.propertyName}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all p-0.5 rounded shrink-0 mt-0.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Actual stage label for this card's template */}
                  {(() => {
                    const label = stageLabel(p.templateSlug, p.currentStageIndex ?? 0);
                    return label ? (
                      <p className="text-xs font-medium text-blue-600 leading-snug">
                        {label}
                      </p>
                    ) : null;
                  })()}

                  {/* Status badge */}
                  <Badge
                    variant="secondary"
                    className={`text-[11px] py-0 h-5 ${STATUS_BADGE[p.status] ?? ""}`}
                  >
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardContent className="p-10 text-center space-y-3">
        <Building2 className="h-10 w-10 text-zinc-400 mx-auto" />
        <p className="text-zinc-700 font-medium">
          No onboarding projects yet.
        </p>
        <p className="text-sm text-muted-foreground">
          Spin one up from a template — anyone on the team can start it.
        </p>
        <Button onClick={onCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> New project
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────
type FieldDef = {
  key: string;
  label: string;
  type: "text" | "longtext" | "number" | "money" | "url" | "boolean" | "date";
  placeholder?: string;
};

function CreateProjectDialog({
  open,
  onClose,
  templates,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  templates: any[];
  onCreated: (projectId: number) => void;
}) {
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [kickoff, setKickoff] = useState<Record<string, any>>({});

  const create = trpc.onboarding.projects.create.useMutation({
    onSuccess: (res) => {
      toast.success("Onboarding project created");
      reset();
      onCreated(res.id);
    },
    onError: (e) => toast.error(e.message),
  });

  function reset() {
    setTemplateId(null);
    setKickoff({});
  }

  const template = templates.find((t) => t.id === templateId);
  const kickoffFields: FieldDef[] = template?.kickoffFieldSchema ?? [];

  function submit() {
    const propertyName = (kickoff.property_name as string | undefined)?.trim() ?? "";
    if (!templateId || !propertyName) {
      toast.error("Pick a template + property name");
      return;
    }
    create.mutate({
      templateId,
      propertyName,
      address: (kickoff.address as string | undefined)?.trim() || undefined,
      kickoffData: kickoff,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New onboarding project</DialogTitle>
          <DialogDescription>
            Pick a template + add what you know. You can leave fields blank and fill them in later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select
              value={templateId ? String(templateId) : ""}
              onValueChange={(v) => setTemplateId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {template?.description && (
              <p className="text-xs text-muted-foreground">
                {template.description}
              </p>
            )}
          </div>

          {template && kickoffFields.length > 0 && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-sm font-medium">Property Info</p>
              <p className="text-xs text-muted-foreground -mt-2">
                All optional except property name. Fill in the rest anytime.
              </p>
              {kickoffFields
                .filter((f) => f.key !== "pet_fee" || kickoff.pets_allowed === true)
                .map((f) => (
                  <KickoffField
                    key={f.key}
                    field={f}
                    value={kickoff[f.key]}
                    onChange={(v) =>
                      setKickoff((prev) => ({ ...prev, [f.key]: v }))
                    }
                  />
                ))}
            </div>
          )}

          {!template && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>Pick a template to see kickoff fields.</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Onboarding Settings Dialog ────────────────────────────────────────
type ChecklistItem = { id: string; label: string; hint?: string };
type StageConfig = { key: string; label: string; defaultChecklist: ChecklistItem[]; [k: string]: any };

function OnboardingSettingsDialog({
  open,
  onClose,
  templates,
}: {
  open: boolean;
  onClose: () => void;
  templates: any[];
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [settingsTab, setSettingsTab] = useState<"team" | "checklist">("team");
  const [defaults, setDefaults] = useState<Record<number, Record<string, string>>>({});
  const [checklistEdits, setChecklistEdits] = useState<Record<number, StageConfig[]>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const membersQuery = trpc.onboarding.projects.members.useQuery(undefined, { enabled: open });
  const members = membersQuery.data ?? [];

  const utils = trpc.useUtils();
  const setStageDefaults = trpc.onboarding.templates.setStageDefaults.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const updateChecklist = trpc.onboarding.templates.updateChecklist.useMutation({
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!open) return;
    const initialDefaults: Record<number, Record<string, string>> = {};
    const initialChecklists: Record<number, StageConfig[]> = {};
    for (const t of templates) {
      const saved = (t.stageOwnerDefaults ?? {}) as Record<string, number | null>;
      initialDefaults[t.id] = Object.fromEntries(
        Object.entries(saved).map(([k, v]) => [k, v != null ? String(v) : "__none__"]),
      );
      initialChecklists[t.id] = (t.stagesConfig ?? []) as StageConfig[];
    }
    setDefaults(initialDefaults);
    setChecklistEdits(initialChecklists);
    if (templates.length > 0 && selectedTemplateId === null) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [open, templates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!draggingId) return;
    function onMove(e: PointerEvent) {
      setCursorPos({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [draggingId]);

  const activeTemplateId = selectedTemplateId ?? templates[0]?.id ?? null;
  const activeTemplate = templates.find((t) => t.id === activeTemplateId);
  const stages: StageConfig[] = (checklistEdits[activeTemplateId!] ?? activeTemplate?.stagesConfig ?? []) as StageConfig[];
  const teamStages = stages;

  function getDefault(stageKey: string): string {
    return defaults[activeTemplateId!]?.[stageKey] ?? "__none__";
  }
  function setDefault(stageKey: string, value: string) {
    if (!activeTemplateId) return;
    setDefaults((prev) => ({
      ...prev,
      [activeTemplateId]: { ...(prev[activeTemplateId] ?? {}), [stageKey]: value },
    }));
  }

  function updateStageChecklist(stageKey: string, items: ChecklistItem[]) {
    if (!activeTemplateId) return;
    setChecklistEdits((prev) => {
      const config = (prev[activeTemplateId] ?? activeTemplate?.stagesConfig ?? []) as StageConfig[];
      return {
        ...prev,
        [activeTemplateId]: config.map((s) =>
          s.key === stageKey ? { ...s, defaultChecklist: items } : s,
        ),
      };
    });
  }

  function updateMultipleStages(updates: Record<string, ChecklistItem[]>) {
    if (!activeTemplateId) return;
    setChecklistEdits((prev) => {
      const config = (prev[activeTemplateId] ?? activeTemplate?.stagesConfig ?? []) as StageConfig[];
      return {
        ...prev,
        [activeTemplateId]: config.map((s) =>
          s.key in updates ? { ...s, defaultChecklist: updates[s.key] } : s,
        ),
      };
    });
  }

  function updateStageLabel(stageKey: string, label: string) {
    if (!activeTemplateId) return;
    setChecklistEdits((prev) => {
      const config = (prev[activeTemplateId] ?? activeTemplate?.stagesConfig ?? []) as StageConfig[];
      return {
        ...prev,
        [activeTemplateId]: config.map((s) =>
          s.key === stageKey ? { ...s, label } : s,
        ),
      };
    });
  }

  /** Find which stage currently holds an item by simple item id. */
  function findStageForItem(itemId: string): StageConfig | undefined {
    const config = (checklistEdits[activeTemplateId!] ?? activeTemplate?.stagesConfig ?? []) as StageConfig[];
    return config.find((s) => (s.defaultChecklist ?? []).some((i) => i.id === itemId));
  }

  /** Find which stage a sentinel (`__end_stageKey`), raw droppable key, or item id belongs to. */
  function resolveOver(overStr: string): { stage: StageConfig; itemId: string | null } | null {
    const config = (checklistEdits[activeTemplateId!] ?? activeTemplate?.stagesConfig ?? []) as StageConfig[];
    if (overStr.startsWith("__end_")) {
      const s = config.find((s) => s.key === overStr.slice("__end_".length));
      return s ? { stage: s, itemId: null } : null;
    }
    // Raw stage droppable key (useDroppable id = stage.key) — treat as "insert at end"
    const stageMatch = config.find((s) => s.key === overStr);
    if (stageMatch) return { stage: stageMatch, itemId: null };
    // Item id
    const s = config.find((s) => (s.defaultChecklist ?? []).some((i) => i.id === overStr));
    return s ? { stage: s, itemId: overStr } : null;
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
    const pe = event.activatorEvent as PointerEvent;
    if (pe?.clientX !== undefined) {
      setCursorPos({ x: pe.clientX, y: pe.clientY });
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const srcItemId = String(active.id);
    const srcStage = findStageForItem(srcItemId);
    if (!srcStage) return;

    const tgt = resolveOver(String(over.id));
    if (!tgt) return;

    if (srcStage.key === tgt.stage.key) {
      // Same stage — only sort if there's a real target item (not sentinel)
      if (!tgt.itemId) return;
      const items = srcStage.defaultChecklist ?? [];
      const oldIdx = items.findIndex((i) => i.id === srcItemId);
      const newIdx = items.findIndex((i) => i.id === tgt.itemId);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        updateStageChecklist(srcStage.key, arrayMove(items, oldIdx, newIdx));
      }
      return;
    }

    // Cross-stage: move item live into target stage
    const item = (srcStage.defaultChecklist ?? []).find((i) => i.id === srcItemId);
    if (!item) return;
    const newSrcItems = (srcStage.defaultChecklist ?? []).filter((i) => i.id !== srcItemId);
    const tgtItems = tgt.stage.defaultChecklist ?? [];
    const insertAt = tgt.itemId ? tgtItems.findIndex((i) => i.id === tgt.itemId) : tgtItems.length;
    const idx = insertAt === -1 ? tgtItems.length : insertAt;
    const newTgtItems = [...tgtItems.slice(0, idx), item, ...tgtItems.slice(idx)];
    updateMultipleStages({ [srcStage.key]: newSrcItems, [tgt.stage.key]: newTgtItems });
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const srcItemId = String(active.id);
    // After live onDragOver moves, item is in its current stage (not necessarily original)
    const srcStage = findStageForItem(srcItemId);
    if (!srcStage) return;

    const tgt = resolveOver(String(over.id));
    if (!tgt) return;

    if (srcStage.key === tgt.stage.key) {
      // Final same-stage reorder (handles both original same-stage and post-cross-stage fine-tuning)
      if (!tgt.itemId) return; // over sentinel — position already correct from onDragOver
      const items = srcStage.defaultChecklist ?? [];
      const oldIdx = items.findIndex((i) => i.id === srcItemId);
      const newIdx = items.findIndex((i) => i.id === tgt.itemId);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        updateStageChecklist(srcStage.key, arrayMove(items, oldIdx, newIdx));
      }
    }
    // Cross-stage already applied live in onDragOver — nothing to do here
  }

  // Find dragging item label by searching all stages (item may have moved cross-stage)
  const draggingLabel = useMemo(() => {
    if (!draggingId || !activeTemplateId) return "";
    const config = (checklistEdits[activeTemplateId] ?? activeTemplate?.stagesConfig ?? []) as StageConfig[];
    for (const s of config) {
      const found = (s.defaultChecklist ?? []).find((i) => i.id === draggingId);
      if (found) return found.label;
    }
    return "";
  }, [draggingId, checklistEdits, activeTemplateId, activeTemplate]);

  async function handleSave() {
    if (!activeTemplateId) return;
    const pending: Promise<any>[] = [];

    const raw = defaults[activeTemplateId] ?? {};
    const cleaned = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== "__none__").map(([k, v]) => [k, Number(v)]),
    );
    pending.push(setStageDefaults.mutateAsync({ templateId: activeTemplateId, defaults: cleaned }));

    const updatedConfig = checklistEdits[activeTemplateId];
    if (updatedConfig) {
      pending.push(updateChecklist.mutateAsync({ templateId: activeTemplateId, stagesConfig: updatedConfig }));
    }

    await Promise.all(pending);
    toast.success("Settings saved");
    utils.onboarding.templates.list.invalidate();
    onClose();
  }

  const isSaving = setStageDefaults.isPending || updateChecklist.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Onboarding settings</DialogTitle>
          <DialogDescription>
            Configure default team assignments and checklist tasks for each template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {templates.length > 1 && (
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select
                value={selectedTemplateId ? String(selectedTemplateId) : ""}
                onValueChange={(v) => setSelectedTemplateId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as any)}>
            <TabsList>
              <TabsTrigger value="team">Team</TabsTrigger>
              <TabsTrigger value="checklist">Checklist tasks</TabsTrigger>
            </TabsList>
          </Tabs>

          {settingsTab === "team" && (
            teamStages.length > 0 ? (
              <div className="space-y-1 border rounded-md divide-y">
                {teamStages.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <p className="text-sm">{s.label}</p>
                    <Select value={getDefault(s.key)} onValueChange={(v) => setDefault(s.key, v)}>
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
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No stages configured.</p>
            )
          )}

          {settingsTab === "checklist" && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className="space-y-4">
                {stages.map((s) => (
                  <ChecklistStageEditor
                    key={s.key}
                    stage={s}
                    activeId={draggingId}
                    onChange={(items) => updateStageChecklist(s.key, items)}
                    onLabelChange={(label) => updateStageLabel(s.key, label)}
                  />
                ))}
                {stages.length === 0 && (
                  <p className="text-sm text-muted-foreground">No stages configured.</p>
                )}
              </div>
              {draggingId && createPortal(
                <div
                  style={{
                    position: "fixed",
                    left: cursorPos.x + 12,
                    top: cursorPos.y - 16,
                    zIndex: 99999,
                    pointerEvents: "none",
                  }}
                  className="flex items-center gap-2 bg-white border border-zinc-300 rounded-md shadow-2xl px-2 py-0.5 ring-2 ring-blue-400/30 min-w-48"
                >
                  <GripVertical className="h-4 w-4 text-zinc-400 shrink-0" />
                  <div className="h-8 flex-1 rounded-md border border-zinc-200 bg-white px-3 flex items-center text-sm text-zinc-800">
                    {draggingLabel || "Task"}
                  </div>
                  <div className="w-4 shrink-0" />
                </div>,
                document.body
              )}
            </DndContext>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={isSaving || !activeTemplateId} onClick={handleSave}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChecklistStageEditor({
  stage,
  activeId,
  onChange,
  onLabelChange,
}: {
  stage: StageConfig;
  activeId: string | null;
  onChange: (items: ChecklistItem[]) => void;
  onLabelChange: (label: string) => void;
}) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [draftLabel, setDraftLabel] = useState(stage.label);

  useEffect(() => { setDraftLabel(stage.label); }, [stage.label]);

  function commitLabel() {
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== stage.label) onLabelChange(trimmed);
    else setDraftLabel(stage.label);
    setEditingLabel(false);
  }

  const items = stage.defaultChecklist ?? [];
  const sentinelId = `__end_${stage.key}`;
  // Simple item IDs — no stageKey prefix — so active.id remains valid in whichever
  // SortableContext the item lives in after a cross-stage live move.
  const dragIds = [...items.map((it) => it.id), sentinelId];
  const { setNodeRef: setDropRef, isOver: stageIsOver } = useDroppable({ id: stage.key });

  function updateItem(id: string, label: string) {
    onChange(items.map((it) => it.id === id ? { ...it, label } : it));
  }
  function deleteItem(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }
  function addItem() {
    const id = `task_${Date.now().toString(36)}`;
    onChange([...items, { id, label: "" }]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 group/header">
        {editingLabel ? (
          <Input
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") { setDraftLabel(stage.label); setEditingLabel(false); }
            }}
            className="h-7 text-sm font-medium"
          />
        ) : (
          <>
            <p className="text-sm font-medium">{stage.label}</p>
            <button
              onClick={() => { setDraftLabel(stage.label); setEditingLabel(true); }}
              className="opacity-0 group-hover/header:opacity-100 transition-opacity p-0.5 text-zinc-400 hover:text-zinc-700 rounded"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      <SortableContext items={dragIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setDropRef}
          className={`min-h-[32px] rounded-md transition-colors ${stageIsOver && items.length === 0 ? "bg-blue-50 border border-dashed border-blue-300 p-2" : ""}`}
        >
          {items.length === 0 && !activeId && (
            <p className="text-xs text-muted-foreground py-1 px-1">No tasks — add one below.</p>
          )}
          <div className="space-y-0.5">
            {items.map((it) => (
              <SortableTaskItem
                key={it.id}
                dragId={it.id}
                item={it}
                onUpdate={(label) => updateItem(it.id, label)}
                onDelete={() => deleteItem(it.id)}
              />
            ))}
            <SortableTaskSentinel dragId={sentinelId} /></div>
        </div>
      </SortableContext>
      <Button
        variant="ghost"
        size="sm"
        onClick={addItem}
        className="gap-1 text-muted-foreground h-8 mt-1"
      >
        <Plus className="h-3.5 w-3.5" /> Add task
      </Button>
    </div>
  );
}

function SortableTaskItem({
  dragId,
  item,
  onUpdate,
  onDelete,
}: {
  dragId: string;
  item: ChecklistItem;
  onUpdate: (label: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dragId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md ${isDragging ? "opacity-0" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 shrink-0 touch-none"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={item.label}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder="Task description…"
        className="h-8 text-sm"
      />
      <button
        onClick={onDelete}
        className="text-zinc-400 hover:text-red-500 transition-colors shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Invisible sortable sentinel at the end of each stage — gives closestCenter a target
 *  when the cursor is dragged below the last real item. */
function SortableTaskSentinel({ dragId }: { dragId: string }) {
  const { setNodeRef, transform, transition } = useSortable({ id: dragId });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="h-8 w-full"
      aria-hidden
    />
  );
}

function KickoffField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: any;
  onChange: (v: any) => void;
}) {
  if (field.type === "longtext") {
    return (
      <div className="space-y-1.5">
        <Label>{field.label}</Label>
        <Textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
        />
      </div>
    );
  }
  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <Label>{field.label}</Label>
        <Select
          value={value === true ? "yes" : value === false ? "no" : ""}
          onValueChange={(v) =>
            onChange(v === "yes" ? true : v === "no" ? false : undefined)
          }
        >
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }
  const inputType =
    field.type === "money" || field.type === "number"
      ? "number"
      : field.type === "url"
        ? "url"
        : field.type === "date"
          ? "date"
          : "text";

  if (field.type === "money") {
    return (
      <div className="space-y-1.5">
        <Label>{field.label}</Label>
        <div className="relative">
          {value !== undefined && value !== "" && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 pointer-events-none">$</span>
          )}
          <Input
            type="number"
            value={value ?? ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? undefined : Number(e.target.value))
            }
            placeholder={field.placeholder ?? "0"}
            className={value !== undefined && value !== "" ? "pl-6" : ""}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{field.label}</Label>
      <Input
        type={inputType}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            field.type === "number"
              ? e.target.value === ""
                ? undefined
                : Number(e.target.value)
              : e.target.value,
          )
        }
        placeholder={field.placeholder}
      />
    </div>
  );
}
