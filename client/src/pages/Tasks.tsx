import { trpc } from "@/lib/trpc";
import { PropertyCombobox } from "@/components/PropertyCombobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Star,
  Wrench,
  CheckCircle2,
  GripVertical,
  User,
  Archive,
  Eye,
  MapPin,
  AlertTriangle,
  ArrowRight,
  Image as ImageIcon,
  Clock,
  Cloud,
  CloudOff,
  Loader2,
  Copy,
  Filter,
  HardHat,
  Sparkles,
  ShieldCheck,
  XCircle,
  Lightbulb,
  Undo2,
  Zap,
  PenSquare,
  CalendarDays,
  UserCircle,
  ClipboardCheck,
  Tag,
  Building,
  Hexagon,
  RotateCcw,
  Send,
  Upload,
  X,
  Paperclip,
  Link,
  Camera,
  Play,
  Trash2,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type TaskType = {
  id: number;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "created" | "needs_review" | "up_next" | "in_progress" | "completed" | "ignored" | "ideas_for_later";
  category: "maintenance" | "cleaning" | "improvements";
  source: "airbnb_review" | "guest_message" | "manual" | "breezeway" | "wand_manual" | "review";
  taskType: "maintenance" | "housekeeping" | "inspection" | "safety" | "other" | null;
  syncStatus: "synced" | "pending_push" | "sync_error" | null;
  lastSyncedAt: Date | null;
  breezewayUpdatedAt: Date | null;
  breezewayCreatedAt: Date | null;
  hiddenFromBoard: boolean | null;
  assignedTo: string | null;
  breezewayTaskId: string | null;
  breezewayPushedAt: Date | null;
  breezewayHomeId: number | null;
  breezewayCreatorName: string | null;
  hostawayReservationId: string | null;
  arrivalDate: Date | null;
  departureDate: Date | null;
  createdAt: Date;
  dueDate: Date | null;
  listingId: number | null;
  externalId: string | null;
  externalSource: "hostaway" | "breezeway" | null;
  updatedAt: Date;
  listingName: string | null;
  isUrgent: boolean | null;
  resolutionStatus: "none" | "monitoring" | "likely_resolved" | "auto_resolved" | "reopened" | null;
  resolutionConfidence: number | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
  resolutionMessageId: string | null;
  monitoringExpiresAt: Date | null;
};

// 4 static board columns
const BOARD_STATUSES = ["created", "needs_review", "up_next", "in_progress"] as const;

// All statuses for labels
const STATUS_LABELS: Record<string, string> = {
  created: "In Queue",
  needs_review: "Needs Review",
  up_next: "Up Next",
  in_progress: "In Progress",
  completed: "Done",
  ignored: "Ignored",
  ideas_for_later: "Ideas for Later",
};

const STATUS_DOTS: Record<string, string> = {
  created: "bg-blue-500",
  needs_review: "bg-yellow-500",
  up_next: "bg-cyan-500",
  in_progress: "bg-orange-500",
  completed: "bg-emerald-500",
  ignored: "bg-gray-300",
  ideas_for_later: "bg-violet-500",
};

const STATUS_BG: Record<string, string> = {
  created: "bg-blue-50 dark:bg-blue-950/30",
  needs_review: "bg-yellow-50 dark:bg-yellow-950/30",
  up_next: "bg-cyan-50 dark:bg-cyan-950/30",
  in_progress: "bg-orange-50 dark:bg-orange-950/30",
  completed: "bg-emerald-50 dark:bg-emerald-950/30",
  ignored: "bg-gray-50 dark:bg-gray-950/30",
  ideas_for_later: "bg-violet-50 dark:bg-violet-950/30",
};

// Archive tab definitions
const ARCHIVE_TABS = [
  { value: "completed", label: "Done", icon: CheckCircle2 },
  { value: "ignored", label: "Ignored", icon: XCircle },
  { value: "ideas_for_later", label: "Ideas for Later", icon: Lightbulb },
] as const;

const TASK_TYPE_ICONS: Record<string, React.ReactNode> = {
  maintenance: <Wrench className="h-3.5 w-3.5" />,
  housekeeping: <Sparkles className="h-3.5 w-3.5" />,
  inspection: <ClipboardCheck className="h-3.5 w-3.5" />,
  safety: <ShieldCheck className="h-3.5 w-3.5" />,
  improvements: <Lightbulb className="h-3.5 w-3.5" />,
  other: <Tag className="h-3.5 w-3.5" />,
};

const TASK_TYPE_LABELS: Record<string, string> = {
  maintenance: "Maintenance",
  housekeeping: "Cleaning",
  inspection: "Inspection",
  safety: "Safety",
  improvements: "Improvements",
  other: "Other",
};

const TASK_TYPE_COLORS: Record<string, string> = {
  maintenance: "text-orange-500",
  housekeeping: "text-sky-500",
  inspection: "text-indigo-500",
  safety: "text-red-500",
  improvements: "text-amber-500",
  other: "text-gray-400",
};

function sourceIcon(source: string, size = "h-3 w-3") {
  switch (source) {
    case "airbnb_review":
      return <Star className={size} />;
    case "guest_message":
      return <MessageSquare className={size} />;
    case "breezeway":
      return <Cloud className={size} />;
    case "wand_manual":
      return <PenSquare className={size} />;
    case "review":
      return <Star className={size} />;
    default:
      return <Wrench className={size} />;
  }
}

/** Source icon color classes */
function sourceIconColor(source: string): string {
  switch (source) {
    case "guest_message":
      return "text-green-600 dark:text-green-400";
    case "breezeway":
      return "text-blue-600 dark:text-blue-400";
    case "airbnb_review":
    case "review":
      return "text-purple-600 dark:text-purple-400";
    case "wand_manual":
    case "manual":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

/** Priority left border color */
const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-400",
};

/** Format date compactly: "Mar 22" */
function formatShortDate(date: Date | string | null): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sourceLabel(source: string) {
  switch (source) {
    case "airbnb_review":
      return "Review";
    case "guest_message":
      return "Guest Msg";
    case "breezeway":
      return "Breezeway";
    case "wand_manual":
      return "Manual";
    case "review":
      return "Review";
    default:
      return "Manual";
  }
}

/** Source badge with color coding */
function SourceBadge({ source }: { source: string }) {
  const isBreezeway = source === "breezeway";
  const isGuestMsg = source === "guest_message";
  const isReview = source === "airbnb_review" || source === "review";
  const isManual = source === "wand_manual" || source === "manual";

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
        isBreezeway
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
          : isGuestMsg
            ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
            : isReview
              ? "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
              : isManual
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      {sourceIcon(source)}
      {sourceLabel(source)}
    </span>
  );
}

/** Sync status indicator for Breezeway tasks */
function SyncStatusIndicator({ syncStatus }: { syncStatus: string | null }) {
  if (!syncStatus) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            {syncStatus === "synced" && (
              <Cloud className="h-3 w-3 text-emerald-500" />
            )}
            {syncStatus === "pending_push" && (
              <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
            )}
            {syncStatus === "sync_error" && (
              <CloudOff className="h-3 w-3 text-red-500" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {syncStatus === "synced" && "Synced with Breezeway"}
          {syncStatus === "pending_push" && "Syncing to Breezeway..."}
          {syncStatus === "sync_error" && "Sync error — will retry"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Duplicate detection: check if tasks share the same property within a 7-day window */
function isDuplicateCandidate(task: TaskType, allTasks: TaskType[]): boolean {
  if (!task.listingId) return false;
  const taskDate = new Date(task.createdAt).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return allTasks.some(
    (other) =>
      other.id !== task.id &&
      other.listingId === task.listingId &&
      other.source !== task.source &&
      Math.abs(new Date(other.createdAt).getTime() - taskDate) < sevenDays
  );
}

/** Extract the "issue" from the task description */
function extractIssue(task: TaskType): string | null {
  if (!task.description) return null;
  const issuesMatch = task.description.match(/Issues:\s*(.+)/);
  if (issuesMatch) return issuesMatch[1].trim();
  const summaryMatch = task.description.match(/Summary:\s*(.+)/);
  if (summaryMatch) return summaryMatch[1].trim();
  const firstLine = task.description.split("\n")[0];
  return firstLine.length > 120 ? firstLine.slice(0, 120) + "..." : firstLine;
}

/** Extract image URLs from message body text */
function extractImageUrls(body: string | null): string[] {
  if (!body) return [];
  const urlRegex = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?[^\s"'<>]*)?/gi;
  return [...new Set(body.match(urlRegex) || [])];
}

// ── Draggable Task Card ─────────────────────────────────────────────

function DraggableTaskCard({
  task,
  teamMembers,
  onPushToBreezeway,
  pushingTaskId,
  onAssigneeChange,
  onCardClick,
  isDuplicate,
  showStatusBadge = false,
  onToggleUrgent,
}: {
  task: TaskType;
  teamMembers: Array<{ id: number; name: string }>;
  onPushToBreezeway: (taskId: number) => void;
  pushingTaskId: number | null;
  onAssigneeChange: (taskId: number, assignedTo: string | null) => void;
  onCardClick: (task: TaskType) => void;
  isDuplicate: boolean;
  showStatusBadge?: boolean;
  onToggleUrgent?: (taskId: number, isUrgent: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `task-${task.id}`,
    data: { type: "task", task, status: task.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <TaskCardInner
        task={task}
        teamMembers={teamMembers}
        onPushToBreezeway={onPushToBreezeway}
        pushingTaskId={pushingTaskId}
        onAssigneeChange={onAssigneeChange}
        dragListeners={listeners}
        onCardClick={onCardClick}
        isDuplicate={isDuplicate}
        showStatusBadge={showStatusBadge}
        onToggleUrgent={onToggleUrgent}
      />
    </div>
  );
}

// ── Task Card Inner (shared between draggable and overlay) ──────────

function TaskCardInner({
  task,
  teamMembers,
  onPushToBreezeway,
  pushingTaskId,
  onAssigneeChange,
  dragListeners,
  isOverlay = false,
  onCardClick,
  isDuplicate = false,
  showStatusBadge = false,
  onToggleUrgent,
}: {
  task: TaskType;
  teamMembers: Array<{ id: number; name: string }>;
  onPushToBreezeway: (taskId: number) => void;
  pushingTaskId: number | null;
  onAssigneeChange: (taskId: number, assignedTo: string | null) => void;
  dragListeners?: Record<string, unknown>;
  isOverlay?: boolean;
  onCardClick?: (task: TaskType) => void;
  isDuplicate?: boolean;
  showStatusBadge?: boolean;
  onToggleUrgent?: (taskId: number, isUrgent: boolean) => void;
}) {
  const isBreezeway = task.source === "breezeway";
  const borderColor = PRIORITY_BORDER[task.priority] || "border-l-gray-300";
  const hasCheckDates = task.arrivalDate || task.departureDate;
  const assigneeName = task.assignedTo;
  const assigneeInitial = assigneeName ? assigneeName.charAt(0).toUpperCase() : null;

  return (
    <Card
      className={`border-l-4 ${borderColor} p-4 hover:shadow-lg transition-all cursor-pointer ${
        isOverlay ? "shadow-xl ring-2 ring-primary/30 rotate-[2deg]" : ""
      } ${isDuplicate ? "ring-1 ring-amber-400 dark:ring-amber-600" : ""} ${
        task.isUrgent ? "ring-1 ring-red-400 dark:ring-red-600 bg-red-50/30 dark:bg-red-950/10" : ""
      }`}
      onClick={() => onCardClick?.(task)}
    >
      <div className="flex items-start gap-2.5">
        {/* Drag handle */}
        <div
          className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors"
          {...dragListeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Row 1: Property name (prominent, no truncation) */}
          {task.listingName && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 leading-snug">
                {task.listingName}
              </span>
            </div>
          )}

          {/* Row 2: Task type icon + Short issue summary */}
          <div className="flex items-start gap-1.5">
            {task.taskType && TASK_TYPE_ICONS[task.taskType] && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`mt-0.5 shrink-0 ${TASK_TYPE_COLORS[task.taskType] || "text-gray-400"}`}>
                      {TASK_TYPE_ICONS[task.taskType]}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    {TASK_TYPE_LABELS[task.taskType] || task.taskType}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <p className="text-sm font-medium leading-snug">
              {task.title}
            </p>
          </div>

          {/* Row 3: Meta row — source icon + priority badge + status badge + check dates */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source icon only (no text) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`inline-flex items-center ${sourceIconColor(task.source)}`}>
                    {sourceIcon(task.source, "h-3.5 w-3.5")}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {sourceLabel(task.source)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Priority badge */}
            <Badge
              variant={
                task.priority === "high" || task.priority === "urgent"
                  ? "destructive"
                  : task.priority === "medium"
                    ? "default"
                    : "secondary"
              }
              className="text-[10px] h-[18px] px-1.5 font-bold"
            >
              {task.priority.toUpperCase()}
            </Badge>

            {/* Status badge — shown in Urgent lane */}
            {showStatusBadge && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  task.status === "created"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                    : task.status === "needs_review"
                      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300"
                      : task.status === "up_next"
                        ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300"
                        : "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300"
                }`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[task.status]}`} />
                {STATUS_LABELS[task.status]}
              </span>
            )}

            {/* Sync status for Breezeway */}
            {isBreezeway && task.syncStatus && (
              <SyncStatusIndicator syncStatus={task.syncStatus} />
            )}

            {/* Duplicate indicator */}
            {isDuplicate && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center">
                      <Copy className="h-3 w-3 text-amber-500" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    Possible duplicate — same property, different source
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Breezeway task link */}
            {task.breezewayTaskId && (
              <Badge
                variant="outline"
                className="text-[9px] h-[18px] px-1 text-cyan-600 border-cyan-200"
              >
                BW #{task.breezewayTaskId}
              </Badge>
            )}

            {/* Auto-resolution badge */}
            {task.resolutionStatus === "auto_resolved" && (
              <Badge className="text-[9px] h-[18px] px-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                Auto-Resolved
              </Badge>
            )}
            {task.resolutionStatus === "likely_resolved" && (
              <Badge className="text-[9px] h-[18px] px-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                Likely Resolved
              </Badge>
            )}
            {task.resolutionStatus === "monitoring" && task.source === "guest_message" && (
              <Badge variant="outline" className="text-[9px] h-[18px] px-1.5 text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-800">
                <Eye className="h-2.5 w-2.5 mr-0.5" />
                Monitoring
              </Badge>
            )}
            {task.resolutionStatus === "reopened" && (
              <Badge variant="outline" className="text-[9px] h-[18px] px-1.5 text-orange-600 border-orange-200 dark:text-orange-400 dark:border-orange-800">
                <RotateCcw className="h-2.5 w-2.5 mr-0.5" />
                Reopened
              </Badge>
            )}
          </div>

          {/* Row 4: Check-in/out dates + created date + assignee avatar */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-3">
              {/* Check-in / Check-out dates */}
              {hasCheckDates && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  <span>
                    {formatShortDate(task.arrivalDate)}
                    {task.arrivalDate && task.departureDate && " → "}
                    {formatShortDate(task.departureDate)}
                  </span>
                </span>
              )}

              {/* Date created */}
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {task.createdAt
                  ? formatShortDate(task.createdAt)
                  : ""}
              </span>
            </div>

            {/* Assignee avatar (icon only, no dropdown) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center">
                    {assigneeInitial ? (
                      <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                        {assigneeInitial}
                      </span>
                    ) : (
                      <UserCircle className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {assigneeName || "Unassigned"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Average Rating Widget ─────────────────────────────────────────

function AvgRatingWidget() {
  const { data } = trpc.dashboard.avgRating.useQuery({ timeRange: "30d" });
  const rating = data?.avgRating != null ? Number(data.avgRating).toFixed(2) : "—";
  const count = data?.reviewCount ?? 0;

  return (
    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
      <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
      <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
        {rating}
      </span>
      <span className="text-xs text-muted-foreground">
        ({count} reviews)
      </span>
    </div>
  );
}

// ── Task Detail Sheet ──────────────────────────────────────────────

function TaskDetailSheet({
  task,
  open,
  onOpenChange,
}: {
  task: TaskType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { data: detail, isLoading } = trpc.tasks.detail.useQuery(
    { taskId: task?.id ?? 0 },
    { enabled: open && !!task }
  );

  // Fetch live Breezeway task detail (photos, creator) when it's a Breezeway task
  const isBreezewayTask = task?.source === "breezeway" && !!task?.breezewayTaskId;
  const breezewayTaskIdNum = task?.breezewayTaskId ? parseInt(task.breezewayTaskId, 10) : 0;
  const { data: bwDetail, isLoading: bwDetailLoading } = trpc.breezeway.tasks.getById.useQuery(
    { taskId: breezewayTaskIdNum },
    { enabled: open && isBreezewayTask && !isNaN(breezewayTaskIdNum) && breezewayTaskIdNum > 0 }
  );

  // Inline title editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  const updateTitleMut = trpc.tasks.updateTitle.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      utils.tasks.detail.invalidate({ taskId: task?.id ?? 0 });
      setEditingTitle(false);
      toast.success("Title updated");
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
      setEditingTitle(false);
    },
  });

  const startEditTitle = () => {
    if (!task) return;
    setTitleDraft(task.title);
    setEditingTitle(true);
    // Focus the textarea on next tick after render
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const saveTitle = () => {
    if (!task) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === task.title) {
      setEditingTitle(false);
      return;
    }
    updateTitleMut.mutate({ taskId: task.id, title: trimmed });
  };

  const cancelEditTitle = () => {
    setEditingTitle(false);
    setTitleDraft("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        <SheetHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Task Detail</SheetTitle>
            {task && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const url = `${window.location.origin}/task/${task.id}`;
                  navigator.clipboard.writeText(url);
                  toast.success("Task link copied to clipboard");
                }}
              >
                <Link className="h-3.5 w-3.5" />
                Copy Link
              </Button>
            )}
          </div>
          <SheetDescription className="sr-only">
            Full task details with conversation history
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)] px-6 pb-6">
          {isLoading ? (
            <div className="space-y-4 pt-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-32" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : detail && task ? (
            <div className="space-y-5 pt-2 pb-8">
              {/* Task header info */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={
                      task.priority === "high" || task.priority === "urgent"
                        ? "destructive"
                        : task.priority === "medium"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {task.priority.toUpperCase()}
                  </Badge>
                  {task.isUrgent && (
                    <Badge variant="destructive" className="gap-1">
                      <Zap className="h-3 w-3" />
                      URGENT
                    </Badge>
                  )}
                  <Badge variant="outline">
                    {STATUS_LABELS[task.status] || task.status}
                  </Badge>
                  <SourceBadge source={task.source} />
                  {task.source === "breezeway" && task.taskType && (
                    <Badge variant="outline" className="text-xs">
                      {TASK_TYPE_LABELS[task.taskType] || task.taskType}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-blue-600 border-blue-200">
                    {task.category}
                  </Badge>
                </div>

                {/* Inline editable title */}
                {editingTitle ? (
                  <div className="space-y-1.5">
                    <Textarea
                      ref={titleInputRef}
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          saveTitle();
                        }
                        if (e.key === "Escape") {
                          cancelEditTitle();
                        }
                      }}
                      onBlur={saveTitle}
                      className="font-semibold text-base leading-snug min-h-[60px] resize-none"
                      rows={2}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={saveTitle}
                        disabled={updateTitleMut.isPending}
                      >
                        {updateTitleMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs px-2"
                        onClick={cancelEditTitle}
                        disabled={updateTitleMut.isPending}
                      >
                        Cancel
                      </Button>
                      <span className="text-[10px] text-muted-foreground">Enter to save · Esc to cancel</span>
                    </div>
                  </div>
                ) : (
                  <div
                    className="group flex items-start gap-1.5 cursor-pointer"
                    onClick={startEditTitle}
                    title="Click to edit title"
                  >
                    <h3 className="font-semibold text-base leading-snug flex-1">
                      {task.title}
                    </h3>
                    <PenSquare className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity mt-0.5 shrink-0" />
                  </div>
                )}

                {detail.task.listingName && (
                  <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg px-3 py-2">
                    <MapPin className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                        {detail.task.listingName}
                      </p>
                      {detail.task.listingAddress && (
                        <p className="text-xs text-muted-foreground">
                          {detail.task.listingAddress}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <span className="inline-flex items-center gap-1" title={task.source === "breezeway" && task.breezewayCreatedAt ? "Breezeway creation date" : "Wand import date"}>
                    <Clock className="h-3 w-3" />
                    {task.source === "breezeway" && task.breezewayCreatedAt
                      ? new Date(task.breezewayCreatedAt).toLocaleString()
                      : task.createdAt
                      ? new Date(task.createdAt).toLocaleString()
                      : "Unknown"}
                  </span>
                  {task.assignedTo && (
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {task.assignedTo}
                    </span>
                  )}
                  {(task.arrivalDate || task.departureDate) && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {formatShortDate(task.arrivalDate)}
                      {task.arrivalDate && task.departureDate && " \u2192 "}
                      {formatShortDate(task.departureDate)}
                    </span>
                  )}
                  {task.breezewayTaskId && (
                    <a
                      href={`https://app.breezeway.io/task/${task.breezewayTaskId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-cyan-600 hover:text-cyan-700 hover:underline"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      BW #{task.breezewayTaskId}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {task.breezewayCreatorName && !bwDetail?.created_by?.name && (
                    <span className="inline-flex items-center gap-1">
                      <UserCircle className="h-3 w-3 text-cyan-500" />
                      <span className="text-muted-foreground">by</span>
                      <span>{task.breezewayCreatorName}</span>
                    </span>
                  )}
                  {task.source === "breezeway" && task.syncStatus && (
                    <span className="inline-flex items-center gap-1">
                      <SyncStatusIndicator syncStatus={task.syncStatus} />
                      <span className="capitalize">{task.syncStatus.replace("_", " ")}</span>
                    </span>
                  )}
                  {task.source === "guest_message" && task.hostawayReservationId && (
                    <a
                      href={`https://dashboard.hostaway.com/reservations/${task.hostawayReservationId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View in Hostaway
                    </a>
                  )}
                </div>
              </div>

              <Separator />

              {task.description && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    {task.source === "breezeway" ? "Description" : "Analysis"}
                  </h4>
                  <div className="bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed">
                    {task.description}
                  </div>
                </div>
              )}

              {/* Resolution Intelligence Panel */}
              {task.source === "guest_message" && task.resolutionStatus && task.resolutionStatus !== "none" && (
                <div className="space-y-3">
                  <Separator />
                  <div className={`rounded-lg border p-4 space-y-3 ${
                    task.resolutionStatus === "auto_resolved"
                      ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
                      : task.resolutionStatus === "likely_resolved"
                        ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                        : task.resolutionStatus === "reopened"
                          ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800"
                          : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {task.resolutionStatus === "auto_resolved" && (
                          <><CheckCircle2 className="h-4 w-4 text-emerald-600" /><span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Auto-Resolved</span></>
                        )}
                        {task.resolutionStatus === "likely_resolved" && (
                          <><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="text-sm font-semibold text-amber-700 dark:text-amber-300">Likely Resolved</span></>
                        )}
                        {task.resolutionStatus === "monitoring" && (
                          <><Eye className="h-4 w-4 text-blue-600" /><span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Monitoring</span></>
                        )}
                        {task.resolutionStatus === "reopened" && (
                          <><RotateCcw className="h-4 w-4 text-orange-600" /><span className="text-sm font-semibold text-orange-700 dark:text-orange-300">Reopened by Manager</span></>
                        )}
                      </div>
                      {task.resolutionConfidence != null && task.resolutionConfidence > 0 && (
                        <Badge variant="outline" className={`text-xs ${
                          task.resolutionConfidence >= 85
                            ? "text-emerald-600 border-emerald-300"
                            : task.resolutionConfidence >= 60
                              ? "text-amber-600 border-amber-300"
                              : "text-gray-500 border-gray-300"
                        }`}>
                          {task.resolutionConfidence}% confidence
                        </Badge>
                      )}
                    </div>

                    {task.resolutionReason && (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {task.resolutionReason}
                      </p>
                    )}

                    {task.resolvedAt && (
                      <p className="text-xs text-muted-foreground">
                        Resolved {new Date(task.resolvedAt).toLocaleString()}
                      </p>
                    )}

                    {task.resolutionStatus === "monitoring" && task.monitoringExpiresAt && (
                      <p className="text-xs text-muted-foreground">
                        Monitoring until {new Date(task.monitoringExpiresAt).toLocaleString()}
                      </p>
                    )}

                    {/* Action buttons */}
                    <ResolutionActions task={task} onOpenChange={onOpenChange} />
                  </div>
                </div>
              )}

              {/* Breezeway Live Detail: Creator + Photos */}
              {isBreezewayTask && (
                <div className="space-y-3">
                  {bwDetailLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-24" />
                    </div>
                  ) : bwDetail ? (
                    <>
                      {/* Creator */}
                      {(bwDetail.created_by?.name || task.breezewayCreatorName) && (
                        <div className="flex items-center gap-2 text-sm">
                          <UserCircle className="h-4 w-4 text-cyan-500 shrink-0" />
                          <span className="text-muted-foreground">Created by:</span>
                          <span className="font-medium">
                            {bwDetail.created_by?.name || task.breezewayCreatorName}
                          </span>
                        </div>
                      )}
                      {/* Notes from Breezeway */}
                      {bwDetail.notes && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</p>
                          <div className="bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed">
                            {bwDetail.notes}
                          </div>
                        </div>
                      )}
                      {/* Photos */}
                      {bwDetail.photos && bwDetail.photos.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold flex items-center gap-2">
                            <ImageIcon className="h-4 w-4 text-purple-500" />
                            Photos
                            <Badge variant="secondary" className="text-xs h-5">
                              {bwDetail.photos.length}
                            </Badge>
                          </h4>
                          <div className="grid grid-cols-2 gap-2">
                            {bwDetail.photos.map((photo) => (
                              <a
                                key={photo.id}
                                href={photo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block rounded-lg overflow-hidden border hover:opacity-90 transition-opacity"
                              >
                                <img
                                  src={photo.thumbnail_url || photo.url}
                                  alt="Task photo"
                                  className="w-full h-32 object-cover"
                                  loading="lazy"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}

              <Separator />

              {/* Photos & Videos */}
              <TaskAttachmentsSection taskId={task.id} />

              <Separator />

              {/* Internal Comments */}
              <TaskCommentsSection taskId={task.id} comments={detail.comments} />

              <Separator />

              {/* Conversation Thread */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-blue-500" />
                  Conversation Thread
                  {detail.messages.length > 0 && (
                    <Badge variant="secondary" className="text-xs h-5">
                      {detail.messages.length}
                    </Badge>
                  )}
                </h4>

                {detail.messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No messages linked to this task.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {detail.messages.map((msg) => {
                      const isLinked = detail.linkedMessageIds.includes(msg.id);
                      const imageUrls = extractImageUrls(msg.body);
                      return (
                        <div
                          key={msg.id}
                          className={`rounded-lg p-3 text-sm space-y-1.5 ${
                            msg.isIncoming
                              ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900"
                              : "bg-muted/40 border border-border"
                          } ${isLinked ? "ring-1 ring-amber-300 dark:ring-amber-700" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-xs">
                                {msg.isIncoming ? "Guest" : "Host"}
                              </span>
                              {isLinked && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-600 border-amber-300">
                                  analyzed
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {msg.sentAt ? new Date(msg.sentAt).toLocaleString() : ""}
                            </span>
                          </div>

                          <p className="whitespace-pre-wrap leading-relaxed text-sm">
                            {msg.body || "(empty message)"}
                          </p>

                          {isLinked && msg.aiAnalyzed && (
                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                              {msg.aiCategory && (
                                <Badge variant="outline" className="text-[10px] h-5">
                                  {msg.aiCategory}
                                </Badge>
                              )}
                              {msg.aiSentiment && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] h-5 ${
                                    msg.aiSentiment === "negative"
                                      ? "text-red-600 border-red-200"
                                      : msg.aiSentiment === "positive"
                                        ? "text-green-600 border-green-200"
                                        : ""
                                  }`}
                                >
                                  {msg.aiSentiment}
                                </Badge>
                              )}
                              {msg.aiUrgency && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] h-5 ${
                                    msg.aiUrgency === "high" || msg.aiUrgency === "critical"
                                      ? "text-red-600 border-red-200"
                                      : ""
                                  }`}
                                >
                                  {msg.aiUrgency} urgency
                                </Badge>
                              )}
                            </div>
                          )}

                          {imageUrls.length > 0 && (
                            <div className="mt-2 flex gap-2 flex-wrap">
                              {imageUrls.map((url, i) => (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block rounded-md overflow-hidden border hover:ring-2 hover:ring-primary/50 transition-all"
                                >
                                  <img
                                    src={url}
                                    alt={`Guest photo ${i + 1}`}
                                    className="h-24 w-24 object-cover"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = "none";
                                    }}
                                  />
                                </a>
                              ))}
                            </div>
                          )}

                          {isLinked &&
                            msg.aiIssues &&
                            Array.isArray(msg.aiIssues) &&
                            msg.aiIssues.length > 0 && (
                              <div className="mt-2 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1.5">
                                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase mb-0.5">
                                  Issues Detected
                                </p>
                                <ul className="text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
                                  {msg.aiIssues.map((issue: string, i: number) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="mt-0.5">•</span>
                                      <span>{issue}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              Task not found
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── Resolution Action Buttons ────────────────────────────────────────

function ResolutionActions({ task, onOpenChange }: { task: TaskType; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const reopenMut = trpc.tasks.reopenResolved.useMutation({
    onSuccess: () => {
      toast.success("Task reopened");
      utils.tasks.list.invalidate();
      utils.tasks.detail.invalidate({ taskId: task.id });
      onOpenChange(false);
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const confirmMut = trpc.tasks.confirmResolution.useMutation({
    onSuccess: () => {
      toast.success("Resolution confirmed");
      utils.tasks.list.invalidate();
      utils.tasks.detail.invalidate({ taskId: task.id });
      onOpenChange(false);
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  return (
    <div className="flex items-center gap-2 pt-1">
      {(task.resolutionStatus === "auto_resolved" || task.resolutionStatus === "likely_resolved") && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
          onClick={() => reopenMut.mutate({ taskId: task.id })}
          disabled={reopenMut.isPending}
        >
          <RotateCcw className="h-3 w-3" />
          {reopenMut.isPending ? "Reopening..." : "Reopen Task"}
        </Button>
      )}
      {task.resolutionStatus === "likely_resolved" && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
          onClick={() => confirmMut.mutate({ taskId: task.id })}
          disabled={confirmMut.isPending}
        >
          <CheckCircle2 className="h-3 w-3" />
          {confirmMut.isPending ? "Confirming..." : "Confirm Resolved"}
        </Button>
      )}
    </div>
  );
}

// ── Task Comments Section ────────────────────────────────────────────

// ── Task Attachments Section ──────────────────────────────────────────

function TaskAttachmentsSection({ taskId }: { taskId: number }) {
  const utils = trpc.useUtils();
  const { data: attachments, isLoading } = trpc.tasks.getAttachments.useQuery({ taskId });
  const uploadMut = trpc.tasks.uploadAttachment.useMutation({
    onSuccess: () => {
      utils.tasks.getAttachments.invalidate({ taskId });
      toast.success("File uploaded");
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });
  const deleteMut = trpc.tasks.deleteAttachment.useMutation({
    onSuccess: () => {
      utils.tasks.getAttachments.invalidate({ taskId });
      toast.success("Attachment removed");
    },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const handleUpload = async (files: FileList) => {
    const currentCount = attachments?.length ?? 0;
    const remaining = 10 - currentCount;
    if (remaining <= 0) { toast.error("Maximum 10 files per task"); return; }
    for (let i = 0; i < Math.min(files.length, remaining); i++) {
      const f = files[i];
      if (f.size > 50 * 1024 * 1024) { toast.error(`${f.name} exceeds 50MB limit`); continue; }
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
      await uploadMut.mutateAsync({ taskId, fileName: f.name, mimeType: f.type, size: f.size, base64Data: base64 });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-violet-500" />
          Photos & Videos
          {attachments && attachments.length > 0 && (
            <Badge variant="secondary" className="text-xs h-5">{attachments.length}</Badge>
          )}
        </h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => fileRef.current?.click()}
          disabled={uploadMut.isPending}
        >
          {uploadMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          Add
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => { if (e.target.files) handleUpload(e.target.files); e.target.value = ""; }}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-2"><Skeleton className="aspect-square rounded-md" /><Skeleton className="aspect-square rounded-md" /></div>
      ) : attachments && attachments.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="relative group rounded-md overflow-hidden border bg-muted aspect-square cursor-pointer">
              {att.mimeType.startsWith("video/") ? (
                <div
                  className="w-full h-full flex items-center justify-center bg-black/10"
                  onClick={() => window.open(att.url, "_blank")}
                >
                  <Play className="h-6 w-6 text-muted-foreground" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1 truncate">Video</span>
                </div>
              ) : (
                <img
                  src={att.url}
                  alt={att.fileName}
                  className="w-full h-full object-cover"
                  onClick={() => setLightboxUrl(att.url)}
                />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); deleteMut.mutate({ attachmentId: att.id }); }}
                className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No attachments yet.</p>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-8"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2" onClick={() => setLightboxUrl(null)}>
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function TaskCommentsSection({
  taskId,
  comments,
}: {
  taskId: number;
  comments: Array<{
    id: number;
    taskId: number;
    userId: number;
    userName: string;
    content: string;
    createdAt: Date;
  }>;
}) {
  const [newComment, setNewComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const utils = trpc.useUtils();

  const addCommentMut = trpc.tasks.addComment.useMutation({
    onSuccess: () => {
      setNewComment("");
      utils.tasks.detail.invalidate({ taskId });
      toast.success("Comment added");
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const handleSubmit = () => {
    const trimmed = newComment.trim();
    if (!trimmed) return;
    addCommentMut.mutate({ taskId, content: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <PenSquare className="h-4 w-4 text-violet-500" />
        Comments
        {comments.length > 0 && (
          <Badge variant="secondary" className="text-xs h-5">
            {comments.length}
          </Badge>
        )}
      </h4>

      {/* Existing comments */}
      {comments.length > 0 && (
        <div className="space-y-2">
          {comments.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-xs flex items-center gap-1">
                  <UserCircle className="h-3 w-3 text-violet-500" />
                  {c.userName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-sm">
                {c.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Add comment form */}
      <div className="space-y-2">
        <Textarea
          ref={textareaRef}
          placeholder="Add a note or status update..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[60px] text-sm resize-none"
          rows={2}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to send
          </span>
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleSubmit}
            disabled={!newComment.trim() || addCommentMut.isPending}
          >
            {addCommentMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {addCommentMut.isPending ? "Posting..." : "Post"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Droppable Column (for In Queue / In Progress) ──────────────────

function DroppableColumn({
  status,
  columnTasks,
  teamMembers,
  onPushToBreezeway,
  pushingTaskId,
  onAssigneeChange,
  isLoading,
  onCardClick,
  allTasks,
  onToggleUrgent,
}: {
  status: string;
  columnTasks: TaskType[];
  teamMembers: Array<{ id: number; name: string }>;
  onPushToBreezeway: (taskId: number) => void;
  pushingTaskId: number | null;
  onAssigneeChange: (taskId: number, assignedTo: string | null) => void;
  isLoading: boolean;
  onCardClick: (task: TaskType) => void;
  allTasks: TaskType[];
  onToggleUrgent: (taskId: number, isUrgent: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: "column", status },
  });

  return (
    <div className="flex flex-col gap-3 min-w-0 flex-1">
      {/* Column header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg ${STATUS_BG[status]}`}
      >
        <div className={`h-2.5 w-2.5 rounded-full ${STATUS_DOTS[status]}`} />
        <h3 className="font-semibold text-sm">{STATUS_LABELS[status]}</h3>
        <Badge variant="secondary" className="ml-auto text-xs h-5">
          {columnTasks.length}
        </Badge>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`space-y-2 flex-1 min-h-[200px] rounded-lg border-2 border-dashed p-2 transition-colors ${
          isOver
            ? "border-primary/50 bg-primary/5"
            : "border-transparent"
        }`}
      >
        {isLoading ? (
          <>
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </>
        ) : columnTasks.length > 0 ? (
          columnTasks.map((task) => (
            <DraggableTaskCard
              key={task.id}
              task={task}
              teamMembers={teamMembers}
              onPushToBreezeway={onPushToBreezeway}
              pushingTaskId={pushingTaskId}
              onAssigneeChange={onAssigneeChange}
              onCardClick={onCardClick}
              isDuplicate={isDuplicateCandidate(task, allTasks)}
              onToggleUrgent={onToggleUrgent}
            />
          ))
        ) : (
          <div className="flex items-center justify-center h-[100px] text-xs text-muted-foreground">
            {isOver ? (
              <span className="text-primary font-medium">Drop here</span>
            ) : (
              "No tasks"
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Urgent Lane Drop Zone ──────────────────────────────────────────

function UrgentLane({
  urgentTasks,
  teamMembers,
  onPushToBreezeway,
  pushingTaskId,
  onAssigneeChange,
  onCardClick,
  allTasks,
  onToggleUrgent,
}: {
  urgentTasks: TaskType[];
  teamMembers: Array<{ id: number; name: string }>;
  onPushToBreezeway: (taskId: number) => void;
  pushingTaskId: number | null;
  onAssigneeChange: (taskId: number, assignedTo: string | null) => void;
  onCardClick: (task: TaskType) => void;
  allTasks: TaskType[];
  onToggleUrgent: (taskId: number, isUrgent: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "urgent-lane",
    data: { type: "urgent-lane" },
  });

  return (
    <div className="mb-4">
      {/* Urgent lane header */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 border-b-0">
        <Zap className="h-4 w-4 text-red-600 dark:text-red-400" />
        <h3 className="font-bold text-sm text-red-700 dark:text-red-400">Urgent</h3>
        <Badge
          className="ml-1 text-xs h-5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800"
          variant="outline"
        >
          {urgentTasks.length}
        </Badge>
        <span className="text-xs text-red-500 dark:text-red-400 ml-auto">
          Drag tasks here to mark urgent · drag out to remove
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`min-h-[80px] rounded-b-lg border-2 border-t-0 p-3 transition-all duration-200 ${
          isOver
            ? "border-red-500 bg-red-100 dark:bg-red-900/30 border-solid"
            : "border-red-200 dark:border-red-800 border-dashed bg-red-50/50 dark:bg-red-950/20"
        }`}
      >
        {urgentTasks.length === 0 ? (
          <div className="flex items-center justify-center h-[60px] text-xs text-red-400 dark:text-red-500">
            {isOver ? (
              <span className="text-red-600 font-medium flex items-center gap-1">
                <Zap className="h-3.5 w-3.5" /> Drop to mark urgent
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                No urgent tasks — drag a card here to escalate
              </span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {urgentTasks.map((task) => (
              <DraggableTaskCard
                key={task.id}
                task={task}
                teamMembers={teamMembers}
                onPushToBreezeway={onPushToBreezeway}
                pushingTaskId={pushingTaskId}
                onAssigneeChange={onAssigneeChange}
                onCardClick={onCardClick}
                isDuplicate={isDuplicateCandidate(task, allTasks)}
                showStatusBadge={true}
                onToggleUrgent={onToggleUrgent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dynamic Bottom Drop Zone ───────────────────────────────────────

function BottomDropZone({
  status,
  label,
  icon: Icon,
  color,
  hoverColor,
}: {
  status: string;
  label: string;
  icon: React.ElementType;
  color: string;
  hoverColor: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: "column", status },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed py-5 px-4 transition-all duration-200 ${
        isOver
          ? `${hoverColor} border-solid scale-[1.02] shadow-lg`
          : `${color} hover:border-solid`
      }`}
    >
      <Icon className={`h-5 w-5 ${isOver ? "scale-110" : ""} transition-transform`} />
      <span className="font-semibold text-sm">{label}</span>
    </div>
  );
}

// ── Manual Task Creation Dialog ────────────────────────────────────

function NewTaskDialog({
  open,
  onOpenChange,
  listings,
  teamMembers,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listings: Array<{ id: number; hostawayId: string; name: string; internalName?: string | null }>;
  teamMembers: Array<{ id: number; name: string }>;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [taskType, setTaskType] = useState<string>("maintenance");
  const [listingId, setListingId] = useState<string>("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [status, setStatus] = useState<string>("created");

  // File upload state
  type PendingFile = { file: File; name: string; type: string; preview: string };
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (files: FileList) => {
    const remaining = 10 - pendingFiles.length;
    if (remaining <= 0) { toast.error("Maximum 10 files allowed"); return; }
    const newFiles: PendingFile[] = [];
    for (let i = 0; i < Math.min(files.length, remaining); i++) {
      const f = files[i];
      if (f.size > 50 * 1024 * 1024) { toast.error(`${f.name} exceeds 50MB limit`); continue; }
      newFiles.push({ file: f, name: f.name, type: f.type, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : "" });
    }
    setPendingFiles((prev) => [...prev, ...newFiles]);
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => { const copy = [...prev]; if (copy[idx]?.preview) URL.revokeObjectURL(copy[idx].preview); copy.splice(idx, 1); return copy; });
  };

  const uploadAttachment = trpc.tasks.uploadAttachment.useMutation();

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: async (result) => {
      // Upload pending files if any
      if (pendingFiles.length > 0 && result?.id) {
        setIsUploading(true);
        let uploadedCount = 0;
        for (const pf of pendingFiles) {
          try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
              reader.onload = () => {
                const dataUrl = reader.result as string;
                resolve(dataUrl.split(",")[1]);
              };
              reader.onerror = reject;
              reader.readAsDataURL(pf.file);
            });
            await uploadAttachment.mutateAsync({
              taskId: result.id,
              fileName: pf.name,
              mimeType: pf.type,
              size: pf.file.size,
              base64Data: base64,
            });
            uploadedCount++;
          } catch (err) {
            console.error(`Failed to upload ${pf.name}:`, err);
          }
        }
        setIsUploading(false);
        if (uploadedCount > 0) toast.success(`Task created with ${uploadedCount} file(s)`);
        else toast.success("Task created (some uploads failed)");
      } else {
        toast.success("Task created successfully");
      }
      onOpenChange(false);
      onSuccess();
      // Reset form
      setTitle("");
      setDescription("");
      setPriority("medium");
      setTaskType("maintenance");
      setListingId("");
      setAssignedTo("");
      setStatus("created");
      pendingFiles.forEach((pf) => { if (pf.preview) URL.revokeObjectURL(pf.preview); });
      setPendingFiles([]);
    },
    onError: (err) => {
      toast.error(`Failed to create task: ${err.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    createTask.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      taskType: taskType as any,
      listingId: listingId ? parseInt(listingId) : undefined,
      assignedTo: assignedTo || undefined,
      status: status as any,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenSquare className="h-5 w-5 text-amber-600" />
            Create Manual Task
          </DialogTitle>
          <DialogDescription>
            Create a task manually. It will appear on the board with a "Manual" source badge.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="task-title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="task-title"
              placeholder="e.g. Fix broken AC unit in master bedroom"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              placeholder="Additional details about the task..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Priority */}
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">
                    <span className="flex items-center gap-1.5 text-red-600">
                      <Zap className="h-3.5 w-3.5" />
                      Urgent
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Task Type */}
            <div className="space-y-1.5">
              <Label>Task Type</Label>
              <Select value={taskType} onValueChange={setTaskType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="housekeeping">Housekeeping</SelectItem>
                  <SelectItem value="inspection">Inspection</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                  <SelectItem value="improvements">Improvements</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Property */}
            <div className="space-y-1.5">
              <Label>Property</Label>
              <PropertyCombobox
                properties={listings.map((l) => ({
                  id: l.id,
                  name: l.internalName || l.name,
                }))}
                value={listingId || "none"}
                onValueChange={(v) => setListingId(v === "none" ? "" : v)}
                allLabel="No property"
                placeholder="Select property…"
                className="w-full"
              />
            </div>

            {/* Assignee */}
            <div className="space-y-1.5">
              <Label>Assign To</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.name}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Initial Status */}
          <div className="space-y-1.5">
            <Label>Initial Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created">In Queue</SelectItem>
                <SelectItem value="needs_review">Needs Review</SelectItem>
                <SelectItem value="up_next">Up Next</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Photo/Video Upload */}
          <div className="space-y-1.5">
            <Label>Photos / Videos <span className="text-muted-foreground text-xs">(max 10)</span></Label>
            <div
              className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors ${
                pendingFiles.length >= 10 ? "border-muted bg-muted/20 cursor-not-allowed" : "border-border hover:border-primary/50 cursor-pointer"
              }`}
              onClick={() => {
                if (pendingFiles.length < 10) fileInputRef.current?.click();
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleFileSelect(e.dataTransfer.files);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFileSelect(e.target.files);
                  e.target.value = "";
                }}
              />
              <Camera className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm text-muted-foreground">
                {pendingFiles.length >= 10 ? "Maximum 10 files reached" : "Click or drag files here"}
              </p>
            </div>
            {pendingFiles.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mt-2">
                {pendingFiles.map((pf, idx) => (
                  <div key={idx} className="relative group rounded-md overflow-hidden border bg-muted aspect-square">
                    {pf.type.startsWith("video/") ? (
                      <div className="w-full h-full flex items-center justify-center bg-black/10">
                        <Play className="h-5 w-5 text-muted-foreground" />
                      </div>
                    ) : (
                      <img src={pf.preview} alt={pf.name} className="w-full h-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePendingFile(idx); }}
                      className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1 truncate">
                      {pf.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {priority === "urgent" && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2 text-sm text-red-700 dark:text-red-400">
              <Zap className="h-4 w-4 shrink-0" />
              This task will be automatically added to the Urgent lane.
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createTask.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTask.isPending || isUploading || !title.trim()}
              className={priority === "urgent" ? "bg-red-600 hover:bg-red-700" : ""}
            >
              {(createTask.isPending || isUploading) ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {isUploading ? "Uploading files..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Tasks Page ─────────────────────────────────────────────────

export default function Tasks() {
  const utils = trpc.useUtils();
  const permissions = usePermissions();
  const { user } = useAuth();
  const { data: tasks, isLoading, refetch } = trpc.tasks.list.useQuery();
  const { data: teamMembers = [] } = trpc.tasks.teamMembers.useQuery();
  const { data: listingsData = [] } = trpc.listings.list.useQuery();
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [pushingTaskId, setPushingTaskId] = useState<number | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState("");
  const [reviewPipelineRunning, setReviewPipelineRunning] = useState(false);
  const [reviewPipelinePhase, setReviewPipelinePhase] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [archiveTab, setArchiveTab] = useState<string>("completed");
  const [activeDragTask, setActiveDragTask] = useState<TaskType | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>("all");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [podFilter, setPodFilter] = useState<string>("all");
  const [showMyTasks, setShowMyTasks] = useState(false);

  // Pods data for filtering
  const { data: podsData = [] } = trpc.pods.list.useQuery();

  // Detail sheet state
  const [detailTask, setDetailTask] = useState<TaskType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const handleCardClick = (task: TaskType) => {
    setDetailTask(task);
    setDetailOpen(true);
  };

  // Deep link: open task detail sheet from ?openTask=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openTaskId = params.get("openTask");
    if (openTaskId && tasks) {
      const id = parseInt(openTaskId, 10);
      const found = tasks.find((t: any) => t.id === id);
      if (found) {
        setDetailTask(found as TaskType);
        setDetailOpen(true);
      }
      // Clean up the URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [tasks]);

  // Require 8px movement before starting drag to allow clicks on buttons
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  // Pipeline polling
  const { data: pipelineStatus } = trpc.tasks.pipelineStatus.useQuery(
    undefined,
    {
      enabled: pipelineRunning,
      refetchInterval: pipelineRunning ? 2000 : false,
    }
  );

  useEffect(() => {
    if (!pipelineStatus) return;
    if (pipelineStatus.running) {
      const phaseLabels: Record<string, string> = {
        syncing: "Syncing messages...",
        analyzing: `Analyzing (${pipelineStatus.synced} synced)...`,
        creating_tasks: `Creating tasks (${pipelineStatus.analyzed} analyzed)...`,
      };
      setPipelinePhase(phaseLabels[pipelineStatus.phase] || "Running...");
    } else if (pipelineStatus.phase === "done" && pipelineRunning) {
      toast.success(
        `Pipeline complete: ${pipelineStatus.synced} synced, ${pipelineStatus.analyzed} analyzed, ${pipelineStatus.tasksCreated} tasks created, ${pipelineStatus.tasksUpdated} updated`
      );
      setPipelineRunning(false);
      setPipelinePhase("");
      refetch();
    } else if (pipelineStatus.phase === "error" && pipelineRunning) {
      toast.error(`Pipeline error: ${pipelineStatus.error || "Unknown error"}`);
      setPipelineRunning(false);
      setPipelinePhase("");
    }
  }, [pipelineStatus]);

  // Review Pipeline polling
  const { data: reviewPipelineStatus } = trpc.tasks.reviewPipelineStatus.useQuery(
    undefined,
    {
      enabled: reviewPipelineRunning,
      refetchInterval: reviewPipelineRunning ? 2000 : false,
    }
  );

  useEffect(() => {
    if (!reviewPipelineStatus) return;
    if (reviewPipelineStatus.running) {
      const phaseLabels: Record<string, string> = {
        syncing: "Syncing reviews...",
        analyzing: `Analyzing (${reviewPipelineStatus.synced} synced)...`,
        creating_tasks: `Creating tasks (${reviewPipelineStatus.analyzed} analyzed)...`,
      };
      setReviewPipelinePhase(phaseLabels[reviewPipelineStatus.phase] || "Running...");
    } else if (reviewPipelineStatus.phase === "done" && reviewPipelineRunning) {
      const parts: string[] = [];
      if (reviewPipelineStatus.synced > 0) parts.push(`${reviewPipelineStatus.synced} synced`);
      if ((reviewPipelineStatus as any).oldMarked > 0) parts.push(`${(reviewPipelineStatus as any).oldMarked} old reviews skipped`);
      parts.push(`${reviewPipelineStatus.analyzed} analyzed`);
      if (reviewPipelineStatus.tasksCreated > 0) parts.push(`${reviewPipelineStatus.tasksCreated} tasks created`);
      toast.success(
        `Review pipeline complete: ${parts.join(", ")}`
      );
      setReviewPipelineRunning(false);
      setReviewPipelinePhase("");
      refetch();
    } else if (reviewPipelineStatus.phase === "error" && reviewPipelineRunning) {
      toast.error(`Review pipeline error: ${reviewPipelineStatus.error || "Unknown error"}`);
      setReviewPipelineRunning(false);
      setReviewPipelinePhase("");
    }
  }, [reviewPipelineStatus]);

  // ── Mutations ──────────────────────────────────────────────────────

  const pushToBreezeway = trpc.tasks.pushToBreezeway.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(
          `Task pushed to Breezeway${data.breezewayTaskId ? ` (ID: ${data.breezewayTaskId})` : ""}`
        );
      } else {
        toast.error(data.error || "Failed to push to Breezeway");
      }
      setPushingTaskId(null);
      refetch();
    },
    onError: (err) => {
      toast.error(`Push failed: ${err.message}`);
      setPushingTaskId(null);
    },
  });

  const updateStatus = trpc.tasks.updateStatus.useMutation({
    onMutate: async ({ taskId, status }) => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, (old) =>
        old?.map((t) => (t.id === taskId ? { ...t, status } : t))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) utils.tasks.list.setData(undefined, ctx.previous);
      toast.error("Failed to update task status");
    },
    onSettled: () => {
      utils.tasks.list.invalidate();
    },
  });

  const updateAssignee = trpc.tasks.updateAssignee.useMutation({
    onMutate: async ({ taskId, assignedTo }) => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, (old) =>
        old?.map((t) => (t.id === taskId ? { ...t, assignedTo } : t))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) utils.tasks.list.setData(undefined, ctx.previous);
      toast.error("Failed to update assignee");
    },
    onSettled: () => {
      utils.tasks.list.invalidate();
    },
  });

  const toggleUrgentMutation = trpc.tasks.toggleUrgent.useMutation({
    onMutate: async ({ taskId, isUrgent }) => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, (old) =>
        old?.map((t) => (t.id === taskId ? { ...t, isUrgent } : t))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) utils.tasks.list.setData(undefined, ctx.previous);
      toast.error("Failed to update urgent status");
    },
    onSettled: () => {
      utils.tasks.list.invalidate();
    },
  });

  const triggerPipeline = trpc.tasks.triggerGuestMessagePipeline.useMutation({
    onSuccess: (data) => {
      if (data.started) {
        toast.info("Pipeline started in background. Polling for progress...");
      } else {
        toast.warning(data.message);
        setPipelineRunning(false);
      }
    },
    onError: (err) => {
      toast.error(`Pipeline failed to start: ${err.message}`);
      setPipelineRunning(false);
    },
  });

  const triggerReviewPipeline = trpc.tasks.triggerReviewPipeline.useMutation({
    onSuccess: (data) => {
      if (data.started) {
        toast.info("Review pipeline started in background. Polling for progress...");
      } else {
        toast.warning(data.message);
        setReviewPipelineRunning(false);
      }
    },
    onError: (err) => {
      toast.error(`Review pipeline failed to start: ${err.message}`);
      setReviewPipelineRunning(false);
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────

  const handlePushToBreezeway = (taskId: number) => {
    setPushingTaskId(taskId);
    pushToBreezeway.mutate({ taskId });
  };

  const handleAssigneeChange = (taskId: number, assignedTo: string | null) => {
    updateAssignee.mutate({ taskId, assignedTo });
  };

  const handleRestoreTask = (taskId: number) => {
    updateStatus.mutate({ taskId, status: "created" });
    toast.success("Task restored to In Queue");
  };

  const handleToggleUrgent = (taskId: number, isUrgent: boolean) => {
    toggleUrgentMutation.mutate({ taskId, isUrgent });
    toast.success(isUrgent ? "Task marked as urgent" : "Task removed from urgent lane");
  };

  // ── Filtering ──────────────────────────────────────────────────────

  const allTasks = (tasks || []) as TaskType[];

  // Team members only see tasks assigned to them
  const visibleTasks = permissions.isMember
    ? allTasks.filter((t) => t.assignedTo === user?.name)
    : allTasks;

  // Filter out hidden Breezeway tasks (reassigned away)
  const nonHiddenTasks = visibleTasks.filter((t) => !t.hiddenFromBoard);

  // Active = board column statuses (In Queue, Needs Review, Up Next, In Progress)
  const activeTasks = nonHiddenTasks.filter(
    (t) => t.status === "created" || t.status === "needs_review" || t.status === "up_next" || t.status === "in_progress"
  );

  // Urgent tasks = active tasks with isUrgent=true
  const urgentTasks = activeTasks.filter((t) => t.isUrgent);

  // Archived categories
  const doneTasks = nonHiddenTasks.filter((t) => t.status === "completed");
  const ignoredTasks = nonHiddenTasks.filter((t) => t.status === "ignored");
  const ideasTasks = nonHiddenTasks.filter((t) => t.status === "ideas_for_later");
  const totalArchived = doneTasks.length + ignoredTasks.length + ideasTasks.length;

  const archiveTasksByTab: Record<string, TaskType[]> = {
    completed: doneTasks,
    ignored: ignoredTasks,
    ideas_for_later: ideasTasks,
  };

  // Choose which set to filter
  const displayTasks = showArchive
    ? archiveTasksByTab[archiveTab] || []
    : activeTasks;

  // Apply source filter
  const sourceFiltered =
    sourceFilter === "all"
      ? displayTasks
      : sourceFilter === "guest_message"
        ? displayTasks.filter((t) => t.source === "guest_message")
        : sourceFilter === "review"
          ? displayTasks.filter((t) => t.source === "review" || t.source === "airbnb_review")
          : sourceFilter === "wand_manual"
            ? displayTasks.filter((t) => t.source === "wand_manual" || t.source === "manual")
            : displayTasks.filter((t) => t.source === sourceFilter);

  // Apply pod filter
  // Build a set of listing IDs that belong to the selected pod from listingsData
  const podListingIds = useMemo(() => {
    if (podFilter === "all") return null;
    const podId = Number(podFilter);
    const ids = new Set<number>();
    for (const l of listingsData) {
      if ((l as any).podId === podId) ids.add(l.id);
    }
    return ids;
  }, [podFilter, listingsData]);

  const podFiltered =
    podFilter === "all" || !podListingIds
      ? sourceFiltered
      : sourceFiltered.filter((t) => t.listingId !== null && podListingIds.has(t.listingId));

  // Apply property filter
  const propertyFiltered =
    propertyFilter === "all"
      ? podFiltered
      : podFiltered.filter((t) => t.listingId !== null && String(t.listingId) === propertyFilter);

  // Apply task type filter
  const typeFiltered =
    taskTypeFilter === "all"
      ? propertyFiltered
      : propertyFiltered.filter((t) => t.taskType === taskTypeFilter);

  // Apply "My Tasks" filter
  const myTasksFiltered = showMyTasks
    ? typeFiltered.filter((t) => t.assignedTo === user?.name)
    : typeFiltered;

  // Apply category filter
  const filteredTasks =
    selectedCategory === "all"
      ? myTasksFiltered
      : myTasksFiltered.filter((t) => t.category === selectedCategory);

  const categories = [
    { value: "all", label: "All", count: myTasksFiltered.length },
    {
      value: "maintenance",
      label: "Maintenance",
      count: myTasksFiltered.filter((t) => t.category === "maintenance").length,
    },
    {
      value: "cleaning",
      label: "Cleaning",
      count: myTasksFiltered.filter((t) => t.category === "cleaning").length,
    },
    {
      value: "improvements",
      label: "Improvements",
      count: myTasksFiltered.filter((t) => t.category === "improvements").length,
    },
  ];

  // Unique properties for property filter — includes ALL listings, not just ones with tasks
  const propertyOptions = useMemo(() => {
    // Start with task counts per listing
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const t of displayTasks) {
      if (t.listingId != null && t.listingName) {
        const key = String(t.listingId);
        const existing = map.get(key);
        if (existing) {
          existing.count++;
        } else {
          map.set(key, { id: key, name: t.listingName, count: 1 });
        }
      }
    }
    // Merge in all listings that don't have tasks yet
    for (const l of listingsData) {
      const key = String(l.id);
      if (!map.has(key)) {
        const displayName = (l as any).internalName || l.name || `Listing #${l.id}`;
        map.set(key, { id: key, name: displayName, count: 0 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [displayTasks, listingsData]);

  // Counts for source filter
  const breezewayCount = displayTasks.filter((t) => t.source === "breezeway").length;
  const guestMsgCount = displayTasks.filter(
    (t) => t.source === "guest_message"
  ).length;
  const manualCount = displayTasks.filter(
    (t) => t.source === "wand_manual" || t.source === "manual"
  ).length;
  const reviewCount = displayTasks.filter(
    (t) => t.source === "review" || t.source === "airbnb_review"
  ).length;

  // Board columns: In Queue, Needs Review, Up Next, In Progress
  // Exclude urgent tasks from regular columns (they appear in the urgent lane)
  const tasksByStatus = BOARD_STATUSES.map((status) => ({
    status,
    tasks: filteredTasks.filter((t) => t.status === status && !t.isUrgent),
  }));

  // Filtered urgent tasks (apply same filters)
  const filteredUrgentTasks = filteredTasks.filter((t) => t.isUrgent);

  // ── DnD handlers ──────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as any;
    if (data?.task) setActiveDragTask(data.task);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragTask(null);
    const { active, over } = event;
    if (!over) return;

    const draggedTask = (active.data.current as any)?.task as TaskType;
    if (!draggedTask) return;

    const overData = over.data.current as any;

    // Dropped onto urgent lane → mark as urgent
    if (overData?.type === "urgent-lane") {
      if (!draggedTask.isUrgent) {
        handleToggleUrgent(draggedTask.id, true);
      }
      return;
    }

    // Dropped onto a regular column → if task was urgent, remove urgent flag
    let targetStatus: string | null = null;
    if (overData?.type === "column") {
      targetStatus = overData.status;
    } else if (overData?.type === "task") {
      targetStatus = overData.status;
    }

    if (targetStatus) {
      // If dragged from urgent lane to a regular column, remove urgent flag
      if (draggedTask.isUrgent && (targetStatus === "created" || targetStatus === "needs_review" || targetStatus === "up_next" || targetStatus === "in_progress")) {
        handleToggleUrgent(draggedTask.id, false);
      }

      if (targetStatus !== draggedTask.status) {
        const toastMessages: Record<string, string> = {
          completed: "Task marked as Done",
          ignored: "Task archived (Ignored)",
          ideas_for_later: "Task saved to Ideas for Later",
          created: "Task moved to In Queue",
          needs_review: "Task moved to Needs Review",
          up_next: "Task moved to Up Next",
          in_progress: "Task moved to In Progress",
        };
        toast.success(toastMessages[targetStatus] || `Task moved to ${STATUS_LABELS[targetStatus]}`);
        updateStatus.mutate({
          taskId: draggedTask.id,
          status: targetStatus as any,
        });
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6 w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="wand-page-title">Tasks</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {activeTasks.length} active · {totalArchived} archived
                {urgentTasks.length > 0 && ` · ${urgentTasks.length} urgent`}
                {breezewayCount > 0 && ` · ${breezewayCount} from Breezeway`}
                {guestMsgCount > 0 && ` · ${guestMsgCount} from guest messages`}
              </p>
            </div>
            <AvgRatingWidget />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={showArchive ? "default" : "outline"}
                    onClick={() => setShowArchive(!showArchive)}
                  >
                    {showArchive ? (
                      <Eye className="h-4 w-4 mr-2" />
                    ) : (
                      <Archive className="h-4 w-4 mr-2" />
                    )}
                    {showArchive
                      ? "Active Board"
                      : `Archive (${totalArchived})`}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {showArchive
                    ? "Switch back to active task board"
                    : "View Done, Ignored, and Ideas for Later tasks"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {permissions.canRunPipeline && (
              <>
                <Button
                  size="sm"
                  variant={pipelineRunning ? "secondary" : "outline"}
                  disabled={pipelineRunning}
                  className={pipelineRunning ? "opacity-90 cursor-wait" : ""}
                  onClick={() => {
                    setPipelineRunning(true);
                    triggerPipeline.mutate();
                  }}
                >
                  {pipelineRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  {pipelineRunning
                    ? pipelinePhase || "Starting pipeline..."
                    : "Run Message Pipeline"}
                </Button>
                <Button
                  size="sm"
                  variant={reviewPipelineRunning ? "secondary" : "outline"}
                  disabled={reviewPipelineRunning}
                  className={reviewPipelineRunning ? "opacity-90 cursor-wait" : ""}
                  onClick={() => {
                    setReviewPipelineRunning(true);
                    triggerReviewPipeline.mutate();
                  }}
                >
                  {reviewPipelineRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Star className="h-4 w-4 mr-2" />
                  )}
                  {reviewPipelineRunning
                    ? reviewPipelinePhase || "Starting pipeline..."
                    : "Run Review Pipeline"}
                </Button>
              </>
            )}
            {permissions.isManagerOrAbove && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700"
                onClick={() => setNewTaskOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Task
              </Button>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && setViewMode(v as any)}
          >
            <ToggleGroupItem value="board" aria-label="Board view">
              <LayoutGrid className="h-4 w-4 mr-2" />
              Board
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List className="h-4 w-4 mr-2" />
              List
            </ToggleGroupItem>
          </ToggleGroup>

          <Separator orientation="vertical" className="h-6" />

          {/* Source filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 text-xs w-[150px]">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="breezeway">Breezeway ({breezewayCount})</SelectItem>
                <SelectItem value="guest_message">Guest Messages ({guestMsgCount})</SelectItem>
                <SelectItem value="review">Reviews ({reviewCount})</SelectItem>
                <SelectItem value="wand_manual">Manual ({manualCount})</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Pod filter */}
          <Select value={podFilter} onValueChange={setPodFilter}>
            <SelectTrigger className="h-8 text-xs w-[160px]">
              <div className="flex items-center gap-1.5 truncate">
                <Hexagon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {podFilter === "all"
                    ? `All Pods (${podsData.length})`
                    : podsData.find((p: any) => String(p.id) === podFilter)?.name || "Pod"}
                </span>
              </div>
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">All Pods ({podsData.length})</SelectItem>
              {podsData.map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name} ({p.propertyCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Property filter */}
          <PropertyCombobox
            properties={propertyOptions.map((p) => ({
              id: p.id,
              name: p.name,
              sublabel: p.count > 0 ? `${p.count} task${p.count !== 1 ? "s" : ""}` : undefined,
            }))}
            value={propertyFilter}
            onValueChange={setPropertyFilter}
            allLabel={`All Properties (${propertyOptions.length})`}
            placeholder="Select property…"
            className="h-8 text-xs w-[180px]"
            showIcon
          />

          {/* Task Type filter */}
          <Select value={taskTypeFilter} onValueChange={setTaskTypeFilter}>
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue placeholder="Task Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="housekeeping">Housekeeping</SelectItem>
              <SelectItem value="inspection">Inspection</SelectItem>
              <SelectItem value="safety">Safety</SelectItem>
              <SelectItem value="improvements">Improvements</SelectItem>
            </SelectContent>
          </Select>

          {/* My Tasks toggle — only shown for managers/admins who see all tasks by default */}
          {!permissions.isMember && (
            <Button
              size="sm"
              variant={showMyTasks ? "default" : "outline"}
              className={`h-8 text-xs gap-1.5 transition-colors ${
                showMyTasks
                  ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-500"
                  : "border-dashed"
              }`}
              onClick={() => setShowMyTasks(!showMyTasks)}
            >
              <User className="h-3.5 w-3.5" />
              {showMyTasks ? "Show All Tasks" : "My Tasks"}
            </Button>
          )}

          {/* Reset filters */}
          {(sourceFilter !== "all" || taskTypeFilter !== "all" || propertyFilter !== "all" || podFilter !== "all" || showMyTasks) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setSourceFilter("all");
                setTaskTypeFilter("all");
                setPropertyFilter("all");
                setPodFilter("all");
                setShowMyTasks(false);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        <TabsList className="grid w-full max-w-md grid-cols-4">
          {categories.map((cat) => (
            <TabsTrigger
              key={cat.value}
              value={cat.value}
              className="text-xs"
            >
              {cat.label} {cat.count}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Archive view */}
      {showArchive && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 rounded-lg border border-dashed">
            <Archive className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Archive</p>
              <p className="text-xs text-muted-foreground">
                Tasks moved to Done, Ignored, or Ideas for Later. Click restore to move back to In Queue.
              </p>
            </div>
          </div>

          {/* Archive tabs */}
          <Tabs value={archiveTab} onValueChange={setArchiveTab}>
            <TabsList className="grid w-full max-w-lg grid-cols-3">
              {ARCHIVE_TABS.map((tab) => {
                const Icon = tab.icon;
                const count = archiveTasksByTab[tab.value]?.length || 0;
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="text-xs gap-1.5"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label} ({count})
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {/* Archived task list */}
          <div className="space-y-2">
            {filteredTasks.length > 0 ? (
              filteredTasks.map((task) => (
                <div key={task.id} className="flex items-start gap-2">
                  <div className="flex-1">
                    <TaskCardInner
                      task={task}
                      teamMembers={teamMembers}
                      onPushToBreezeway={handlePushToBreezeway}
                      pushingTaskId={pushingTaskId}
                      onAssigneeChange={handleAssigneeChange}
                      onCardClick={handleCardClick}
                      isDuplicate={isDuplicateCandidate(task, filteredTasks)}
                    />
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 shrink-0"
                          onClick={() => handleRestoreTask(task.id)}
                        >
                          <Undo2 className="h-4 w-4 mr-1" />
                          Restore
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        Move back to In Queue
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No tasks in this category
              </p>
            )}
          </div>
        </div>
      )}

      {/* Board view with DnD — only when NOT in archive */}
      {!showArchive && viewMode === "board" && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Urgent lane — always visible at top of board */}
          <UrgentLane
            urgentTasks={filteredUrgentTasks}
            teamMembers={teamMembers}
            onPushToBreezeway={handlePushToBreezeway}
            pushingTaskId={pushingTaskId}
            onAssigneeChange={handleAssigneeChange}
            onCardClick={handleCardClick}
            allTasks={filteredTasks}
            onToggleUrgent={handleToggleUrgent}
          />

          {/* Four-column board */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pb-4">
            {tasksByStatus.map(({ status, tasks: colTasks }) => (
              <DroppableColumn
                key={status}
                status={status}
                columnTasks={colTasks}
                teamMembers={teamMembers}
                onPushToBreezeway={handlePushToBreezeway}
                pushingTaskId={pushingTaskId}
                onAssigneeChange={handleAssigneeChange}
                isLoading={isLoading}
                onCardClick={handleCardClick}
                allTasks={filteredTasks}
                onToggleUrgent={handleToggleUrgent}
              />
            ))}
          </div>

          {/* Dynamic bottom drop zones — FIXED to viewport bottom during drag */}
          {activeDragTask && (
            <div
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999 }}
              className="px-4 pb-3 pt-2 bg-background/90 backdrop-blur-sm border-t border-border shadow-2xl"
            >
              <p className="text-[10px] text-center text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                Drop here to archive
              </p>
              <div className="grid grid-cols-3 gap-3 max-w-2xl mx-auto">
                <BottomDropZone
                  status="completed"
                  label="Done"
                  icon={CheckCircle2}
                  color="border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400"
                  hoverColor="border-emerald-500 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300"
                />
                <BottomDropZone
                  status="ignored"
                  label="Ignored"
                  icon={XCircle}
                  color="border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-950/20 text-gray-600 dark:text-gray-400"
                  hoverColor="border-gray-500 bg-gray-100 dark:bg-gray-800/40 text-gray-800 dark:text-gray-300"
                />
                <BottomDropZone
                  status="ideas_for_later"
                  label="Ideas for Later"
                  icon={Lightbulb}
                  color="border-violet-300 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400"
                  hoverColor="border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300"
                />
              </div>
            </div>
          )}

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {activeDragTask ? (
              <div className="w-[280px]">
                <TaskCardInner
                  task={activeDragTask}
                  teamMembers={teamMembers}
                  onPushToBreezeway={handlePushToBreezeway}
                  pushingTaskId={pushingTaskId}
                  onAssigneeChange={handleAssigneeChange}
                  isOverlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* List view — only when NOT in archive */}
      {!showArchive && viewMode === "list" && (
        <div className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </>
          ) : filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <TaskCardInner
                key={task.id}
                task={task}
                teamMembers={teamMembers}
                onPushToBreezeway={handlePushToBreezeway}
                pushingTaskId={pushingTaskId}
                onAssigneeChange={handleAssigneeChange}
                onCardClick={handleCardClick}
                isDuplicate={isDuplicateCandidate(task, filteredTasks)}
                onToggleUrgent={handleToggleUrgent}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No tasks matching current filters
            </p>
          )}
        </div>
      )}

      {/* Task Detail Sheet */}
      <TaskDetailSheet
        task={detailTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />

      {/* New Task Dialog */}
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        listings={listingsData}
        teamMembers={teamMembers}
        onSuccess={() => {
          utils.tasks.list.invalidate();
        }}
      />
    </div>
  );
}
