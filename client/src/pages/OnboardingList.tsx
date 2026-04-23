/**
 * Onboarding — list + board views for property-onboarding projects.
 *
 * "List" view: card grid filtered by status. "Board" view: kanban with
 * one column per stage; a project card lives in the column of its
 * `currentStageIndex` (the latest-notified stage), with badges for any
 * earlier stages still open (since stages can run in parallel).
 */
import { useMemo, useState } from "react";
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
import { ClipboardList, Plus, Building2, AlertCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

type View = "list" | "board";
type StatusFilter = "active" | "blocked" | "done" | "cancelled" | "all";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  blocked: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  done: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  cancelled: "bg-zinc-200 text-zinc-700 hover:bg-zinc-200",
};

export default function OnboardingList() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [createOpen, setCreateOpen] = useState(false);

  const projectsQuery = trpc.onboarding.projects.list.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter },
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
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
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
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> New project
        </Button>
      </div>

      {/* Filters + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
    // Use the template with the most stages to define columns — avoids
    // label collisions when templates have different stage structures.
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
    return (
      <div className="text-sm text-muted-foreground">
        No templates configured yet.
      </div>
    );
  }

  const projectsByCol = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const p of projects) {
      const idx = p.currentStageIndex ?? 0;
      const list = m.get(idx) ?? [];
      list.push(p);
      m.set(idx, list);
    }
    return m;
  }, [projects]);

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
    <div className="w-full">
      <div className="flex gap-2 w-full">
        {columns.map((col) => {
          const cards = projectsByCol.get(col.idx) ?? [];
          const isOver = dragOverIdx === col.idx;
          return (
            <div
              key={col.idx}
              onDragOver={(e) => handleDragOver(e, col.idx)}
              onDragLeave={() => setDragOverIdx(null)}
              onDrop={(e) => handleDrop(e, col.idx)}
              className={`flex-1 min-w-0 rounded-lg p-2 transition-colors ${isOver ? "bg-blue-50 ring-2 ring-blue-200" : "bg-zinc-50"}`}
            >
              <div className="flex items-center justify-between px-1 py-1.5">
                <span className="text-xs font-medium text-zinc-600 uppercase tracking-wide truncate">
                  {col.label}
                </span>
                <span className="text-xs text-zinc-500">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((p) => (
                  <Card
                    key={p.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, p.id)}
                    onClick={() => onOpen(p.id)}
                    className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow bg-white"
                  >
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-1">
                        <p className="font-medium text-xs truncate flex-1">
                          {p.propertyName}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                          className="text-zinc-400 hover:text-red-500 transition-colors p-0.5 rounded shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      {p.address && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {p.address}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-1 pt-1">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] py-0 ${STATUS_BADGE[p.status] ?? ""}`}
                        >
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {p.templateSlug}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
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
              <p className="text-sm font-medium">Kickoff info</p>
              <p className="text-xs text-muted-foreground -mt-2">
                All optional except property name. Fill in the rest anytime.
              </p>
              {kickoffFields.map((f) => (
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
  return (
    <div className="space-y-1.5">
      <Label>{field.label}</Label>
      <Input
        type={inputType}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            field.type === "money" || field.type === "number"
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
