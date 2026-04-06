import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2, Receipt, ChevronRight, ChevronLeft, Filter,
  Send, CheckCircle2, AlertTriangle, ExternalLink, Trash2, Eye,
  ChevronDown, ChevronUp,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────

type BreezewayTask = {
  id: number;
  name: string;
  home_id: number;
  type_department?: string;
  type_task_status?: { code: string; name: string; stage: string };
  scheduled_date?: string;
  created_at?: string;
};

type Flag = {
  type: "duplicate" | "incomplete";
  message: string;
  taskId?: string;
};

/** A line item — either a grouped set of turnover cleans or an individual task */
type LineItem = {
  key: string;
  isGroupedClean: boolean;
  propertyId: string;
  propertyName: string;
  label: string;
  quantity: number;
  unitPrice: string;
  included: boolean;
  taskIds: string[];
  taskNames: string[];
  dates: string[];
  flags: Flag[];
  // For grouped cleans: individual task details for expandable view
  tasks?: {
    taskId: string;
    taskName: string;
    date: string;
    statusName: string;
    flagged: boolean;
    flagReason?: string;
  }[];
};

const STEPS = ["Filter", "Review", "Line Items", "Send"];

/** Check if a task name represents a turnover clean */
function isTurnoverClean(taskName: string): boolean {
  const lower = taskName.toLowerCase();
  return lower.includes("turnover");
}

/** Format a date string to locale display */
function fmtDate(d?: string): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

// ── Component ───────────────────────────────────────────────────────────

export default function LeisrBilling() {
  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [invoiceDescription, setInvoiceDescription] = useState(() => {
    const now = new Date();
    const month = now.toLocaleString("default", { month: "long" });
    return `${month} ${now.getFullYear()} 5STR Invoice`;
  });
  const [hasFetched, setHasFetched] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{
    success: boolean;
    invoiceId?: string;
    invoiceUrl?: string;
    amount?: string;
    error?: string;
  } | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────

  const [fetchedFilters, setFetchedFilters] = useState<{
    startDate?: string;
    endDate?: string;
    propertyTags?: string[];
  } | null>(null);

  const tasksQuery = trpc.breezeway.tasks.listByProperty.useQuery(
    {
      startDate: fetchedFilters?.startDate,
      endDate: fetchedFilters?.endDate,
      propertyTags: ["Leisr Billing"],
      status: "completed",
    },
    { enabled: hasFetched && fetchedFilters !== null }
  );

  const propertiesQuery = trpc.billing.breezewayProperties.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const rateCardsQuery = trpc.billing.rateCards.list.useQuery();

  // Check for already-billed tasks
  const allTaskIds = useMemo(() => {
    const tasks = (tasksQuery.data?.results || []) as BreezewayTask[];
    return tasks.map((t) => String(t.id));
  }, [tasksQuery.data]);

  const billingRecordsQuery = trpc.billing.records.byTaskIds.useQuery(
    { taskIds: allTaskIds },
    { enabled: allTaskIds.length > 0 }
  );

  const billedTaskIds = useMemo(() => {
    const records = billingRecordsQuery.data || [];
    return new Set(records.map((r: any) => r.breezewayTaskId));
  }, [billingRecordsQuery.data]);

  const availableTasks = useMemo(() => {
    const tasks = (tasksQuery.data?.results || []) as BreezewayTask[];
    return tasks.filter((t) => !billedTaskIds.has(String(t.id)));
  }, [tasksQuery.data, billedTaskIds]);

  const sendLeisrInvoiceMutation = trpc.billing.sendLeisrInvoice.useMutation();

  // ── Rate card lookup ──────────────────────────────────────────────────

  const rateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const rc of rateCardsQuery.data || []) {
      map.set(`${rc.propertyId}:${rc.taskType}`, rc.amount);
      if (!map.has(rc.propertyId)) map.set(rc.propertyId, rc.amount);
    }
    return map;
  }, [rateCardsQuery.data]);

  const getRate = useCallback(
    (propertyId: string, taskType?: string) => {
      if (taskType) {
        const specific = rateMap.get(`${propertyId}:${taskType}`);
        if (specific) return specific;
      }
      return rateMap.get(propertyId) || "0.00";
    },
    [rateMap]
  );

  // ── Property name lookup ──────────────────────────────────────────────

  const propertyNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of propertiesQuery.data || []) {
      map.set(String(p.id), p.name || `Property ${p.id}`);
    }
    return map;
  }, [propertiesQuery.data]);

  // ── Build line items: grouped turnover cleans + individual others ────

  const buildLineItems = useCallback(() => {
    const tasks = availableTasks.filter((t) => selectedTaskIds.has(String(t.id)));

    // Separate turnover cleans from everything else
    const turnoverTasks: BreezewayTask[] = [];
    const otherTasks: BreezewayTask[] = [];
    for (const t of tasks) {
      if (isTurnoverClean(t.name)) {
        turnoverTasks.push(t);
      } else {
        otherTasks.push(t);
      }
    }

    const items: LineItem[] = [];

    // ── Group turnover cleans by property ──
    const byProperty = new Map<number, BreezewayTask[]>();
    for (const t of turnoverTasks) {
      const arr = byProperty.get(t.home_id) || [];
      arr.push(t);
      byProperty.set(t.home_id, arr);
    }

    for (const [propId, propTasks] of byProperty) {
      const propIdStr = String(propId);
      const propName = propertyNameMap.get(propIdStr) || `Property ${propId}`;
      const unitPrice = getRate(propIdStr, "turnover-clean");

      // Detect flags
      const flags: Flag[] = [];
      const taskDetails: LineItem["tasks"] = [];

      // Check for duplicates on same day
      const dateMap = new Map<string, BreezewayTask[]>();
      for (const t of propTasks) {
        const dateKey = (t.scheduled_date || t.created_at || "").split("T")[0];
        const arr = dateMap.get(dateKey) || [];
        arr.push(t);
        dateMap.set(dateKey, arr);
      }

      for (const [dateKey, dateTasks] of dateMap) {
        const isDuplicate = dateTasks.length > 1;
        if (isDuplicate) {
          flags.push({
            type: "duplicate",
            message: `${dateTasks.length} turnover cleans on ${fmtDate(dateKey)} — possible duplicate`,
          });
        }
        for (const t of dateTasks) {
          const statusName = t.type_task_status?.name || "Unknown";
          const stage = t.type_task_status?.stage || "";
          const isIncomplete =
            stage !== "finished" ||
            /cancel|skip|void/i.test(statusName);

          if (isIncomplete) {
            flags.push({
              type: "incomplete",
              message: `"${t.name}" status: ${statusName} — may not have been completed`,
              taskId: String(t.id),
            });
          }

          taskDetails.push({
            taskId: String(t.id),
            taskName: t.name,
            date: fmtDate(t.scheduled_date || t.created_at),
            statusName,
            flagged: isDuplicate || isIncomplete,
            flagReason: isDuplicate
              ? "Duplicate on same day"
              : isIncomplete
              ? `Status: ${statusName}`
              : undefined,
          });
        }
      }

      // Sort task details by date
      taskDetails.sort((a, b) => a.date.localeCompare(b.date));

      const qty = propTasks.length;
      const total = (parseFloat(unitPrice) * qty).toFixed(2);

      items.push({
        key: `clean:${propIdStr}`,
        isGroupedClean: true,
        propertyId: propIdStr,
        propertyName: propName,
        label: "Turnover Cleans",
        quantity: qty,
        unitPrice,
        included: true,
        taskIds: propTasks.map((t) => String(t.id)),
        taskNames: propTasks.map((t) => t.name),
        dates: propTasks.map((t) => fmtDate(t.scheduled_date || t.created_at)),
        flags,
        tasks: taskDetails,
      });
    }

    // ── Individual non-turnover tasks ──
    for (const task of otherTasks) {
      const propIdStr = String(task.home_id);
      const propName = propertyNameMap.get(propIdStr) || `Property ${task.home_id}`;
      const statusName = task.type_task_status?.name || "Unknown";
      const stage = task.type_task_status?.stage || "";
      const flags: Flag[] = [];

      const isIncomplete =
        stage !== "finished" ||
        /cancel|skip|void/i.test(statusName);

      if (isIncomplete) {
        flags.push({
          type: "incomplete",
          message: `Status: ${statusName} — may not have been completed`,
          taskId: String(task.id),
        });
      }

      items.push({
        key: `task:${task.id}`,
        isGroupedClean: false,
        propertyId: propIdStr,
        propertyName: propName,
        label: task.name,
        quantity: 1,
        unitPrice: "0.00",
        included: false, // non-turnover excluded by default
        taskIds: [String(task.id)],
        taskNames: [task.name],
        dates: [fmtDate(task.scheduled_date || task.created_at)],
        flags,
      });
    }

    // Sort: grouped cleans first (by property), then individual tasks by property
    items.sort((a, b) => {
      if (a.isGroupedClean !== b.isGroupedClean) return a.isGroupedClean ? -1 : 1;
      return a.propertyName.localeCompare(b.propertyName) || a.label.localeCompare(b.label);
    });

    setLineItems(items);
    setExpandedGroups(new Set());
  }, [availableTasks, selectedTaskIds, getRate, propertyNameMap]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleFetch = () => {
    setFetchedFilters({ startDate, endDate, propertyTags: ["Leisr Billing"] });
    setHasFetched(true);
  };

  const toggleAll = () => {
    if (selectedTaskIds.size === availableTasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(availableTasks.map((t) => String(t.id))));
    }
  };

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateLineItem = (key: string, field: keyof LineItem, value: any) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        if (field === "unitPrice") {
          const newTotal = (parseFloat(value as string || "0") * item.quantity).toFixed(2);
          return { ...item, unitPrice: value as string };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const removeLineItem = (key: string) => {
    setLineItems((prev) => prev.filter((item) => item.key !== key));
  };

  /** Remove a single task from a grouped clean (reduces quantity) */
  const removeTaskFromGroup = (groupKey: string, taskId: string) => {
    setLineItems((prev) =>
      prev.flatMap((item) => {
        if (item.key !== groupKey) return [item];
        const idx = item.taskIds.indexOf(taskId);
        if (idx === -1) return [item];
        // If only 1 task left, remove the whole group
        if (item.taskIds.length <= 1) return [];
        const newTaskIds = item.taskIds.filter((_, i) => i !== idx);
        const newTaskNames = item.taskNames.filter((_, i) => i !== idx);
        const newDates = item.dates.filter((_, i) => i !== idx);
        const newTasks = item.tasks?.filter((t) => t.taskId !== taskId);
        const newQty = newTaskIds.length;
        // Recalculate flags
        const newFlags = item.flags.filter((f) => f.taskId !== taskId);
        return [{
          ...item,
          taskIds: newTaskIds,
          taskNames: newTaskNames,
          dates: newDates,
          tasks: newTasks,
          quantity: newQty,
          flags: newFlags,
        }];
      })
    );
  };

  const includedItems = useMemo(() => lineItems.filter((i) => i.included), [lineItems]);
  const excludedItems = useMemo(() => lineItems.filter((i) => !i.included), [lineItems]);

  const totalAmount = useMemo(
    () =>
      includedItems.reduce(
        (sum, i) => sum + (parseFloat(i.unitPrice) || 0) * i.quantity,
        0
      ),
    [includedItems]
  );

  const flagCount = useMemo(
    () => lineItems.reduce((sum, i) => sum + i.flags.length, 0),
    [lineItems]
  );

  const handleSendInvoice = async () => {
    const billableItems = includedItems.filter(
      (i) => parseFloat(i.unitPrice) > 0
    );
    if (billableItems.length === 0) {
      toast.error("No billable items with a price > $0");
      return;
    }

    try {
      const res = await sendLeisrInvoiceMutation.mutateAsync({
        lineItems: billableItems.map((item) => ({
          propertyName: item.propertyName,
          description: item.isGroupedClean
            ? `${item.propertyName} × ${item.quantity} cleans`
            : `${item.propertyName} — ${item.label}`,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: (parseFloat(item.unitPrice) * item.quantity).toFixed(2),
          taskIds: item.taskIds,
          taskNames: item.taskNames,
        })),
        invoiceDescription,
      });
      setResult({
        success: true,
        invoiceId: res.invoiceId,
        invoiceUrl: res.invoiceUrl || undefined,
        amount: res.amount,
      });
      setStep(3);
      toast.success(`Invoice sent to ${res.customerName}!`);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
      setStep(3);
      toast.error(`Failed: ${err.message}`);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              onClick={() => { if (i < step) setStep(i); }}
              disabled={i > step}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                i === step
                  ? "bg-violet-500/10 text-violet-600 border border-violet-500/30"
                  : i < step
                  ? "bg-muted text-foreground cursor-pointer hover:bg-muted/80"
                  : "bg-muted/50 text-muted-foreground cursor-not-allowed"
              }`}
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${
                i < step ? "bg-violet-500 text-white" : i === step ? "bg-violet-500 text-white" : "bg-muted-foreground/30 text-muted-foreground"
              }`}>
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Filter ──────────────────────────────────────────────── */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Leisr Task Filter
            </CardTitle>
            <CardDescription>
              Select a date range to find completed Leisr-tagged tasks for billing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Invoice Description</Label>
                <Input
                  value={invoiceDescription}
                  onChange={(e) => setInvoiceDescription(e.target.value)}
                  placeholder="e.g. April 2026 5STR Invoice"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                {tasksQuery.isLoading
                  ? "Loading tasks..."
                  : hasFetched
                  ? `${availableTasks.length} billable tasks found${billedTaskIds.size > 0 ? ` (${billedTaskIds.size} already billed)` : ""}`
                  : "Set date range and click Fetch Tasks"}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleFetch} disabled={tasksQuery.isLoading}>
                  {tasksQuery.isLoading ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Fetching...</>
                  ) : (
                    "Fetch Tasks"
                  )}
                </Button>
                <Button
                  onClick={() => { toggleAll(); setStep(1); }}
                  disabled={availableTasks.length === 0 || tasksQuery.isLoading}
                >
                  Review Tasks ({availableTasks.length})
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Review & Select ────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Review & Select Tasks</CardTitle>
                <CardDescription>
                  {selectedTaskIds.size} of {availableTasks.length} tasks selected
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {selectedTaskIds.size === availableTasks.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-left w-10">
                      <Checkbox
                        checked={selectedTaskIds.size === availableTasks.length && availableTasks.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="p-3 text-left">Task</th>
                    <th className="p-3 text-left">Property</th>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {availableTasks.map((task) => {
                    const selected = selectedTaskIds.has(String(task.id));
                    return (
                      <tr
                        key={task.id}
                        className={`border-t cursor-pointer hover:bg-muted/30 ${selected ? "bg-violet-50/50" : ""}`}
                        onClick={() => toggleTask(String(task.id))}
                      >
                        <td className="p-3">
                          <Checkbox checked={selected} onCheckedChange={() => toggleTask(String(task.id))} />
                        </td>
                        <td className="p-3 font-medium">{task.name}</td>
                        <td className="p-3 text-muted-foreground">
                          {propertyNameMap.get(String(task.home_id)) || `#${task.home_id}`}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {fmtDate(task.scheduled_date || task.created_at)}
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary" className="text-xs">
                            {task.type_task_status?.name || "Unknown"}
                          </Badge>
                        </td>
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <a
                            href={`https://app.breezeway.io/task/${task.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-violet-600 transition-colors"
                            title="View in Breezeway"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                  {availableTasks.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        No tasks available for billing in this date range
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={() => { buildLineItems(); setStep(2); }}
                disabled={selectedTaskIds.size === 0}
              >
                Build Line Items ({selectedTaskIds.size} tasks)
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Line Items ─────────────────────────────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Leisr Invoice Line Items
            </CardTitle>
            <CardDescription>
              Turnover cleans are grouped per property and auto-priced. Other tasks are individual line items — set a price to include them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Invoice Description</Label>
              <Input
                value={invoiceDescription}
                onChange={(e) => setInvoiceDescription(e.target.value)}
              />
            </div>

            {/* Flag banner */}
            {flagCount > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">{flagCount} item{flagCount > 1 ? "s" : ""} flagged for review</span>
                  <span className="text-amber-600 ml-1">— check for duplicates or incomplete tasks before sending</span>
                </div>
              </div>
            )}

            <Separator />

            {/* ── Included line items ── */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-foreground">
                Included ({includedItems.length})
              </h3>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-3 text-left">Item</th>
                      <th className="p-3 text-left">Property</th>
                      <th className="p-3 text-center w-16">Qty</th>
                      <th className="p-3 text-right w-28">Unit Price</th>
                      <th className="p-3 text-right w-24">Total</th>
                      <th className="p-3 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {includedItems.map((item) => {
                      const isExpanded = expandedGroups.has(item.key);
                      const lineTotal = (parseFloat(item.unitPrice) || 0) * item.quantity;
                      return (
                        <>
                          <tr key={item.key} className="border-t">
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                {item.isGroupedClean && item.tasks && item.tasks.length > 0 && (
                                  <button
                                    onClick={() => toggleExpanded(item.key)}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  </button>
                                )}
                                <span className="font-medium">{item.label}</span>
                                {item.isGroupedClean && (
                                  <Badge className="bg-violet-100 text-violet-700 text-[10px] px-1.5 py-0">Grouped</Badge>
                                )}
                                {item.flags.length > 0 && (
                                  <Badge className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0 gap-0.5">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    {item.flags.length}
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-muted-foreground">{item.propertyName}</td>
                            <td className="p-3 text-center font-medium">{item.quantity}</td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-muted-foreground text-xs">$</span>
                                <Input
                                  value={item.unitPrice}
                                  onChange={(e) => updateLineItem(item.key, "unitPrice", e.target.value)}
                                  className="w-20 text-right h-7 text-sm"
                                />
                              </div>
                            </td>
                            <td className="p-3 text-right font-medium">${lineTotal.toFixed(2)}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-amber-600"
                                  title="Exclude from invoice"
                                  onClick={() => updateLineItem(item.key, "included", false)}
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-red-500"
                                  title="Remove entirely"
                                  onClick={() => removeLineItem(item.key)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded task details for grouped cleans */}
                          {isExpanded && item.tasks && item.tasks.map((t) => (
                            <tr key={`${item.key}:${t.taskId}`} className="border-t bg-muted/20">
                              <td className="p-2 pl-12" colSpan={2}>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={t.flagged ? "text-amber-700 font-medium" : "text-muted-foreground"}>
                                    {t.taskName}
                                  </span>
                                  {t.flagged && t.flagReason && (
                                    <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1 py-0">
                                      {t.flagReason}
                                    </Badge>
                                  )}
                                  <a
                                    href={`https://app.breezeway.io/task/${t.taskId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-violet-600 transition-colors shrink-0"
                                  >
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                </div>
                              </td>
                              <td className="p-2 text-center text-xs text-muted-foreground">{t.date}</td>
                              <td className="p-2 text-right text-xs text-muted-foreground">{t.statusName}</td>
                              <td className="p-2" />
                              <td className="p-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-muted-foreground hover:text-red-500"
                                  title="Remove this task from group"
                                  onClick={() => removeTaskFromGroup(item.key, t.taskId)}
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}

                          {/* Show flag details inline when not expanded */}
                          {!isExpanded && item.flags.length > 0 && (
                            <tr key={`${item.key}:flags`} className="bg-amber-50/50">
                              <td colSpan={6} className="px-3 py-1.5">
                                <div className="flex flex-wrap gap-2">
                                  {item.flags.map((f, fi) => (
                                    <span key={fi} className="text-[11px] text-amber-700 flex items-center gap-1">
                                      <AlertTriangle className="h-2.5 w-2.5" />
                                      {f.message}
                                      {f.taskId && (
                                        <a
                                          href={`https://app.breezeway.io/task/${f.taskId}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:text-violet-600"
                                        >
                                          <ExternalLink className="h-2.5 w-2.5" />
                                        </a>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    {includedItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-muted-foreground">
                          No included items. Include tasks from the excluded list below.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30">
                      <td colSpan={4} className="p-3 text-right font-semibold">Total</td>
                      <td className="p-3 text-right font-bold text-lg">${totalAmount.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ── Excluded line items ── */}
            {excludedItems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
                  Excluded ({excludedItems.length})
                </h3>
                <div className="border rounded-md overflow-hidden border-dashed">
                  <table className="w-full text-sm">
                    <tbody>
                      {excludedItems.map((item) => (
                        <tr key={item.key} className="border-t first:border-t-0">
                          <td className="p-2.5 pl-3">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span>{item.label}</span>
                              {item.flags.length > 0 && (
                                <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1 py-0">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                </Badge>
                              )}
                              {item.taskIds.length === 1 && (
                                <a
                                  href={`https://app.breezeway.io/task/${item.taskIds[0]}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-violet-600 transition-colors shrink-0"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5 text-muted-foreground text-xs">{item.propertyName}</td>
                          <td className="p-2.5 text-muted-foreground text-xs">{item.dates[0]}</td>
                          <td className="p-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-muted-foreground text-xs">$</span>
                              <Input
                                value={item.unitPrice}
                                onChange={(e) => updateLineItem(item.key, "unitPrice", e.target.value)}
                                className="w-20 text-right h-7 text-sm"
                                placeholder="0.00"
                              />
                            </div>
                          </td>
                          <td className="p-2.5 w-16">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => updateLineItem(item.key, "included", true)}
                            >
                              Include
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={handleSendInvoice}
                disabled={includedItems.length === 0 || totalAmount < 0.5 || sendLeisrInvoiceMutation.isPending}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {sendLeisrInvoiceMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending...</>
                ) : (
                  <><Send className="h-4 w-4 mr-1" /> Send Invoice (${totalAmount.toFixed(2)})</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Result ─────────────────────────────────────────────── */}
      {step === 3 && result && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4 py-8">
              {result.success ? (
                <>
                  <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                  <div>
                    <h3 className="text-lg font-semibold">Invoice Sent!</h3>
                    <p className="text-muted-foreground mt-1">
                      ${result.amount} invoice sent to Leisr Stays
                    </p>
                  </div>
                  {result.invoiceUrl && (
                    <a
                      href={result.invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View Invoice in Stripe
                    </a>
                  )}
                  <Badge variant="secondary" className="text-xs font-mono">
                    {result.invoiceId}
                  </Badge>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-12 w-12 text-red-500" />
                  <div>
                    <h3 className="text-lg font-semibold text-red-600">Invoice Failed</h3>
                    <p className="text-muted-foreground mt-1">{result.error}</p>
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={() => { setResult(null); setStep(0); }}>
                  New Invoice
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
