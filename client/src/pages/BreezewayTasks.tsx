import { trpc } from "@/lib/trpc";
import { PropertyCombobox } from "@/components/PropertyCombobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  RefreshCw,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type TaskAction = "close" | "approve" | "reopen" | "comment";

interface BreezewayTask {
  id: number;
  name: string;
  home_id: number;
  type_department?: string;
  type_priority?: string;
  type_task_status?: {
    code: string;
    name: string;
    stage: string;
  };
  scheduled_date?: string;
  created_at?: string;
  assignments?: Array<{
    id: number;
    assignee_id: number;
    name: string;
    type_task_user_status: string;
  }>;
  created_by?: { id: number; name: string };
}

function statusBadgeClass(stage?: string) {
  switch (stage) {
    case "new":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    case "active":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "done":
      return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function priorityBadgeClass(priority?: string) {
  switch (priority) {
    case "high":
      return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
    case "normal":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300";
    case "low":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export default function BreezewayTasks() {
  const { data: properties } = trpc.breezeway.properties.list.useQuery();
  const { data: team } = trpc.breezeway.team.list.useQuery();

  // Filters
  const [filterHomeId, setFilterHomeId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterAssigneeId, setFilterAssigneeId] = useState<string>("all");
  const [filterStartDate, setFilterStartDate] = useState<string>("");
  const [filterEndDate, setFilterEndDate] = useState<string>("");

  // Find the selected property's Breezeway ID for API calls
  const selectedProperty = properties?.find(
    (p) => String(p.id) === filterHomeId
  );

  const { data: taskData, isLoading, refetch } =
    trpc.breezeway.tasks.listByProperty.useQuery(
      {
        homeId: selectedProperty
          ? parseInt(selectedProperty.breezewayId)
          : undefined,
        status: filterStatus !== "all" ? filterStatus : undefined,
        startDate: filterStartDate || undefined,
        endDate: filterEndDate || undefined,
        assigneeId:
          filterAssigneeId !== "all" ? parseInt(filterAssigneeId) : undefined,
        limit: 50,
      },
      {
        // Only fetch if we have a property selected (API requires home_id)
        enabled: filterHomeId !== "all",
      }
    );

  const tasks: BreezewayTask[] = taskData?.results || [];

  // Mutations
  const createTaskMutation = trpc.breezeway.tasks.create.useMutation({
    onSuccess: () => {
      toast.success("Task created successfully in Breezeway");
      setShowCreateModal(false);
      setShowConfirmCreate(false);
      resetCreateForm();
      refetch();
    },
    onError: (err) => {
      toast.error(`Failed to create task: ${err.message}`);
    },
  });

  const closeTaskMutation = trpc.breezeway.tasks.close.useMutation({
    onSuccess: () => {
      toast.success("Task closed successfully");
      setSelectedTaskAction(null);
      refetch();
    },
    onError: (err) => toast.error(`Failed to close task: ${err.message}`),
  });

  const approveTaskMutation = trpc.breezeway.tasks.approve.useMutation({
    onSuccess: () => {
      toast.success("Task approved successfully");
      setSelectedTaskAction(null);
      refetch();
    },
    onError: (err) => toast.error(`Failed to approve task: ${err.message}`),
  });

  const reopenTaskMutation = trpc.breezeway.tasks.reopen.useMutation({
    onSuccess: () => {
      toast.success("Task reopened successfully");
      setSelectedTaskAction(null);
      refetch();
    },
    onError: (err) => toast.error(`Failed to reopen task: ${err.message}`),
  });

  const addCommentMutation = trpc.breezeway.tasks.addComment.useMutation({
    onSuccess: () => {
      toast.success("Comment added successfully");
      setSelectedTaskAction(null);
      setCommentText("");
      refetch();
    },
    onError: (err) => toast.error(`Failed to add comment: ${err.message}`),
  });

  // Create task form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showConfirmCreate, setShowConfirmCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    homeId: "",
    name: "",
    notes: "",
    typePriority: "normal" as "normal" | "high" | "low",
    typeDepartment: "housekeeping" as
      | "housekeeping"
      | "maintenance"
      | "inspection",
    scheduledDate: "",
  });

  const resetCreateForm = () => {
    setCreateForm({
      homeId: "",
      name: "",
      notes: "",
      typePriority: "normal",
      typeDepartment: "housekeeping",
      scheduledDate: "",
    });
  };

  // Task action state
  const [selectedTaskAction, setSelectedTaskAction] = useState<{
    task: BreezewayTask;
    action: TaskAction;
  } | null>(null);
  const [commentText, setCommentText] = useState("");

  const handleCreateTask = () => {
    if (!createForm.homeId || !createForm.name) {
      toast.error("Please fill in property and task name");
      return;
    }
    setShowConfirmCreate(true);
  };

  const confirmCreateTask = () => {
    const selectedProp = properties?.find(
      (p) => String(p.id) === createForm.homeId
    );
    if (!selectedProp) return;

    createTaskMutation.mutate({
      homeId: parseInt(selectedProp.breezewayId),
      name: createForm.name,
      notes: createForm.notes || undefined,
      typePriority: createForm.typePriority,
      typeDepartment: createForm.typeDepartment,
      scheduledDate: createForm.scheduledDate || undefined,
    });
  };

  const handleTaskAction = (task: BreezewayTask, action: TaskAction) => {
    setSelectedTaskAction({ task, action });
  };

  const confirmTaskAction = () => {
    if (!selectedTaskAction) return;
    const { task, action } = selectedTaskAction;

    if (action === "comment") {
      if (!commentText.trim()) {
        toast.error("Please enter a comment");
        return;
      }
      addCommentMutation.mutate({ taskId: task.id, comment: commentText });
    } else if (action === "close") {
      closeTaskMutation.mutate({ taskId: task.id });
    } else if (action === "approve") {
      approveTaskMutation.mutate({ taskId: task.id });
    } else if (action === "reopen") {
      reopenTaskMutation.mutate({ taskId: task.id });
    }
  };

  const isActionLoading =
    closeTaskMutation.isPending ||
    approveTaskMutation.isPending ||
    reopenTaskMutation.isPending ||
    addCommentMutation.isPending;

  return (
    <div className="space-y-6 p-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="wand-page-title">Breezeway Tasks & Cleans</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {filterHomeId === "all"
                ? "Select a property to view tasks"
                : `${taskData?.totalResults ?? 0} total tasks`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isLoading || filterHomeId === "all"}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Property
            </label>
            <PropertyCombobox
              properties={(properties || []).map((p) => ({
                id: p.id,
                name: p.name,
              }))}
              value={filterHomeId}
              onValueChange={setFilterHomeId}
              allLabel="All Properties"
              placeholder="Select property…"
              className="w-52"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Status
            </label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="committed">Committed</SelectItem>
                <SelectItem value="started">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Assignee
            </label>
            <Select value={filterAssigneeId} onValueChange={setFilterAssigneeId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                {team?.map((member) => (
                  <SelectItem
                    key={member.id}
                    value={member.breezewayId}
                  >
                    {member.firstName} {member.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Start Date
            </label>
            <Input
              type="date"
              className="w-40"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              End Date
            </label>
            <Input
              type="date"
              className="w-40"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tasks list */}
      <div className="space-y-3">
        {filterHomeId === "all" ? (
          <div className="text-center py-16 border border-dashed rounded-lg">
            <p className="text-muted-foreground font-medium">
              Select a property above to view its tasks
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              The Breezeway API requires a property to be selected
            </p>
          </div>
        ) : isLoading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : tasks.length > 0 ? (
          tasks.map((task) => (
            <Card
              key={task.id}
              className="p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {task.type_priority && (
                      <span
                        className={`text-xs font-medium uppercase px-2 py-0.5 rounded ${priorityBadgeClass(task.type_priority)}`}
                      >
                        {task.type_priority}
                      </span>
                    )}
                    {task.type_task_status && (
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${statusBadgeClass(task.type_task_status.stage)}`}
                      >
                        {task.type_task_status.name}
                      </span>
                    )}
                    {task.type_department && (
                      <Badge variant="outline" className="text-xs capitalize">
                        {task.type_department}
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-semibold text-sm">{task.name}</h3>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                    {task.assignments && task.assignments.length > 0 && (
                      <span>
                        Assigned to:{" "}
                        {task.assignments.map((a) => a.name).join(", ")}
                      </span>
                    )}
                    {task.scheduled_date && (
                      <span>
                        Scheduled:{" "}
                        {new Date(task.scheduled_date).toLocaleDateString()}
                      </span>
                    )}
                    {task.created_by && (
                      <span>Created by: {task.created_by.name}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  {task.type_task_status?.stage !== "done" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTaskAction(task, "close")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Close
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTaskAction(task, "approve")}
                      >
                        <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                        Approve
                      </Button>
                    </>
                  )}
                  {task.type_task_status?.stage === "done" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTaskAction(task, "reopen")}
                    >
                      <AlertCircle className="h-3.5 w-3.5 mr-1" />
                      Reopen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTaskAction(task, "comment")}
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />
                    Comment
                  </Button>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <div className="text-center py-12 border border-dashed rounded-lg">
            <p className="text-muted-foreground">
              No tasks found for this property
            </p>
          </div>
        )}
      </div>

      {/* Create Task Modal — Step 1: Form */}
      <Dialog open={showCreateModal && !showConfirmCreate} onOpenChange={(open) => {
        if (!open) { setShowCreateModal(false); resetCreateForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
            <DialogDescription>
              Fill in the details. You will review before submitting to Breezeway.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Property *</label>
              <PropertyCombobox
                properties={(properties || []).map((p) => ({
                  id: p.id,
                  name: p.name,
                }))}
                value={createForm.homeId || "all"}
                onValueChange={(v) =>
                  setCreateForm({ ...createForm, homeId: v === "all" ? "" : v })
                }
                allLabel={undefined}
                placeholder="Select property…"
                className="w-full"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Task Name *</label>
              <Input
                placeholder="e.g. Deep clean after checkout"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm({ ...createForm, name: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Department</label>
                <Select
                  value={createForm.typeDepartment}
                  onValueChange={(value) =>
                    setCreateForm({
                      ...createForm,
                      typeDepartment: value as
                        | "housekeeping"
                        | "maintenance"
                        | "inspection",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="turnover-clean">Turnover Clean</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={createForm.typePriority}
                  onValueChange={(value) =>
                    setCreateForm({
                      ...createForm,
                      typePriority: value as "normal" | "high" | "low",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Scheduled Date</label>
              <Input
                type="date"
                value={createForm.scheduledDate}
                onChange={(e) =>
                  setCreateForm({ ...createForm, scheduledDate: e.target.value })
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                placeholder="Additional notes (optional)"
                value={createForm.notes}
                onChange={(e) =>
                  setCreateForm({ ...createForm, notes: e.target.value })
                }
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setShowCreateModal(false); resetCreateForm(); }}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleCreateTask}>
                Review & Create →
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Task Modal — Step 2: Confirmation */}
      <Dialog open={showConfirmCreate} onOpenChange={setShowConfirmCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Task Creation</DialogTitle>
            <DialogDescription>
              Review the details below before submitting to Breezeway.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 bg-muted/50 rounded-lg p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Property</span>
              <span className="font-medium">
                {properties?.find((p) => String(p.id) === createForm.homeId)
                  ?.name ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Task Name</span>
              <span className="font-medium">{createForm.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Department</span>
              <span className="font-medium capitalize">
                {createForm.typeDepartment}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Priority</span>
              <span className="font-medium capitalize">
                {createForm.typePriority}
              </span>
            </div>
            {createForm.scheduledDate && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Scheduled Date</span>
                <span className="font-medium">{createForm.scheduledDate}</span>
              </div>
            )}
            {createForm.notes && (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Notes</span>
                <span className="font-medium">{createForm.notes}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowConfirmCreate(false)}
            >
              ← Back
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={confirmCreateTask}
              disabled={createTaskMutation.isPending}
            >
              {createTaskMutation.isPending ? "Creating..." : "Confirm & Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Task Action Confirmation Modal */}
      <Dialog
        open={!!selectedTaskAction}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTaskAction(null);
            setCommentText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedTaskAction?.action === "comment"
                ? "Add Comment to Task"
                : selectedTaskAction?.action === "close"
                  ? "Close Task"
                  : selectedTaskAction?.action === "approve"
                    ? "Approve Task"
                    : "Reopen Task"}
            </DialogTitle>
            <DialogDescription>
              {selectedTaskAction?.action === "comment"
                ? "Enter your comment. This will be sent to Breezeway."
                : "Please confirm this action. It will be sent to Breezeway immediately."}
            </DialogDescription>
          </DialogHeader>

          {/* Task preview */}
          {selectedTaskAction && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="font-medium">{selectedTaskAction.task.name}</p>
              <p className="text-muted-foreground text-xs mt-1">
                Task ID: {selectedTaskAction.task.id} ·{" "}
                {selectedTaskAction.task.type_task_status?.name ?? "Unknown status"}
              </p>
            </div>
          )}

          {selectedTaskAction?.action === "comment" && (
            <Textarea
              placeholder="Enter your comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="min-h-[100px]"
            />
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setSelectedTaskAction(null);
                setCommentText("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={confirmTaskAction}
              disabled={isActionLoading}
            >
              {isActionLoading
                ? "Processing..."
                : selectedTaskAction?.action === "comment"
                  ? "Add Comment"
                  : selectedTaskAction?.action === "close"
                    ? "Close Task"
                    : selectedTaskAction?.action === "approve"
                      ? "Approve Task"
                      : "Reopen Task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
