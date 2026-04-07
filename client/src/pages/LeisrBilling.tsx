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
  Send, CheckCircle2, AlertTriangle, ExternalLink, Trash2, Eye, EyeOff,
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

function isTurnoverClean(taskName: string): boolean {
  return taskName.toLowerCase().includes("turnover");
}

function fmtDate(d?: string): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

// ── Component ───────────────────────────────────────────────────────────

export default function LeisrBilling() {
  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [invoiceDescription, setInvoiceDescription] = useState(() => {
    const now = new Date();
    return `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()} 5STR Invoice`;
  });
  const [hasFetched, setHasFetched] = useState(false);
  const [hideAlreadyBilled, setHideAlreadyBilled] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  // Ignored keys — hidden from excluded list
  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{
    success: boolean; invoiceId?: string; invoiceUrl?: string; dashboardUrl?: string;
    amount?: string; error?: string; isDraft?: boolean;
  } | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────

  const [fetchedFilters, setFetchedFilters] = useState<{
    startDate?: string; endDate?: string; propertyTags?: string[];
  } | null>(null);

  const tasksQuery = trpc.breezeway.tasks.listByProperty.useQuery(
    { startDate: fetchedFilters?.startDate, endDate: fetchedFilters?.endDate, propertyTags: ["Leisr Billing"] },
    { enabled: hasFetched && fetchedFilters !== null }
  );

  const propertiesQuery = trpc.billing.breezewayProperties.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const rateCardsQuery = trpc.billing.rateCards.list.useQuery();

  const allTaskIds = useMemo(() => {
    return ((tasksQuery.data?.results || []) as BreezewayTask[]).map((t) => String(t.id));
  }, [tasksQuery.data]);

  const billingRecordsQuery = trpc.billing.records.byTaskIds.useQuery(
    { taskIds: allTaskIds }, { enabled: allTaskIds.length > 0 }
  );

  const billedTaskIds = useMemo(() => {
    return new Set((billingRecordsQuery.data || []).map((r: any) => r.breezewayTaskId));
  }, [billingRecordsQuery.data]);

  const availableTasks = useMemo(() => {
    const all = (tasksQuery.data?.results || []) as BreezewayTask[];
    if (hideAlreadyBilled) return all.filter((t) => !billedTaskIds.has(String(t.id)));
    return all;
  }, [tasksQuery.data, billedTaskIds, hideAlreadyBilled]);

  const sendLeisrInvoiceMutation = trpc.billing.sendLeisrInvoice.useMutation();
  const previewLeisrInvoiceMutation = trpc.billing.previewLeisrInvoice.useMutation();
  const bulkUpsertRatesMutation = trpc.billing.rateCards.bulkUpsert.useMutation();

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
      if (taskType) { const s = rateMap.get(`${propertyId}:${taskType}`); if (s) return s; }
      return rateMap.get(propertyId) || "0.00";
    },
    [rateMap]
  );

  const propertyNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of propertiesQuery.data || []) map.set(String(p.id), p.name || `Property ${p.id}`);
    return map;
  }, [propertiesQuery.data]);

  // ── Build line items ──────────────────────────────────────────────────

  const buildLineItems = useCallback(() => {
    const tasks = availableTasks.filter((t) => selectedTaskIds.has(String(t.id)));
    const turnoverTasks: BreezewayTask[] = [];
    const otherTasks: BreezewayTask[] = [];
    for (const t of tasks) {
      (isTurnoverClean(t.name) ? turnoverTasks : otherTasks).push(t);
    }

    const items: LineItem[] = [];

    // Group turnover cleans by property
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

      // Separate completed vs incomplete turnover cleans
      const completedTasks: BreezewayTask[] = [];
      const incompleteTasks: BreezewayTask[] = [];
      for (const t of propTasks) {
        const stage = t.type_task_status?.stage || "";
        const statusName = t.type_task_status?.name || "Unknown";
        const isIncomplete = stage !== "finished" || /cancel|skip|void/i.test(statusName);
        (isIncomplete ? incompleteTasks : completedTasks).push(t);
      }

      // Group completed turnover cleans as before
      if (completedTasks.length > 0) {
        const flags: Flag[] = [];
        const taskDetails: LineItem["tasks"] = [];

        // Detect same-day duplicates among completed tasks
        const dateMap = new Map<string, BreezewayTask[]>();
        for (const t of completedTasks) {
          const dk = (t.scheduled_date || t.created_at || "").split("T")[0];
          const arr = dateMap.get(dk) || [];
          arr.push(t);
          dateMap.set(dk, arr);
        }

        for (const [dateKey, dateTasks] of dateMap) {
          const isDup = dateTasks.length > 1;
          if (isDup) {
            flags.push({ type: "duplicate", message: `${dateTasks.length} cleans on ${fmtDate(dateKey)} — possible duplicate` });
          }
          for (const t of dateTasks) {
            const statusName = t.type_task_status?.name || "Unknown";
            taskDetails.push({
              taskId: String(t.id), taskName: t.name, date: fmtDate(t.scheduled_date || t.created_at),
              statusName, flagged: isDup,
              flagReason: isDup ? "Duplicate on same day" : undefined,
            });
          }
        }

        taskDetails.sort((a, b) => a.date.localeCompare(b.date));

        items.push({
          key: `clean:${propIdStr}`, isGroupedClean: true, propertyId: propIdStr, propertyName: propName,
          label: "Turnover Cleans", quantity: completedTasks.length, unitPrice, included: true,
          taskIds: completedTasks.map((t) => String(t.id)), taskNames: completedTasks.map((t) => t.name),
          dates: completedTasks.map((t) => fmtDate(t.scheduled_date || t.created_at)),
          flags, tasks: taskDetails,
        });
      }

      // Incomplete turnover cleans become individual EXCLUDED line items for review
      for (const t of incompleteTasks) {
        const statusName = t.type_task_status?.name || "Unknown";
        items.push({
          key: `task:${t.id}`, isGroupedClean: false, propertyId: propIdStr,
          propertyName: propName,
          label: `${t.name} ⚠ ${statusName}`, quantity: 1, unitPrice, included: false,
          taskIds: [String(t.id)], taskNames: [t.name],
          dates: [fmtDate(t.scheduled_date || t.created_at)],
          flags: [{ type: "incomplete", message: `Status: ${statusName}`, taskId: String(t.id) }],
        });
      }
    }

    // Individual non-turnover tasks
    for (const task of otherTasks) {
      const propIdStr = String(task.home_id);
      const statusName = task.type_task_status?.name || "Unknown";
      const stage = task.type_task_status?.stage || "";
      const flags: Flag[] = [];
      if (stage !== "finished" || /cancel|skip|void/i.test(statusName)) {
        flags.push({ type: "incomplete", message: `Status: ${statusName}`, taskId: String(task.id) });
      }
      items.push({
        key: `task:${task.id}`, isGroupedClean: false, propertyId: propIdStr,
        propertyName: propertyNameMap.get(propIdStr) || `Property ${task.home_id}`,
        label: task.name, quantity: 1, unitPrice: "0.00", included: false,
        taskIds: [String(task.id)], taskNames: [task.name],
        dates: [fmtDate(task.scheduled_date || task.created_at)], flags,
      });
    }

    items.sort((a, b) => {
      if (a.isGroupedClean !== b.isGroupedClean) return a.isGroupedClean ? -1 : 1;
      return a.propertyName.localeCompare(b.propertyName) || a.label.localeCompare(b.label);
    });

    setLineItems(items);
    setExpandedGroups(new Set());
    setCheckedKeys(new Set());
  }, [availableTasks, selectedTaskIds, getRate, propertyNameMap]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleFetch = () => {
    setFetchedFilters({ startDate, endDate, propertyTags: ["Leisr Billing"] });
    setHasFetched(true);
  };

  const toggleAll = () => {
    setSelectedTaskIds((prev) =>
      prev.size === availableTasks.length ? new Set() : new Set(availableTasks.map((t) => String(t.id)))
    );
  };

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── Multi-select for bulk actions ──

  const toggleChecked = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleCheckAll = (keys: string[]) => {
    setCheckedKeys((prev) => {
      const allChecked = keys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (allChecked) { keys.forEach((k) => next.delete(k)); }
      else { keys.forEach((k) => next.add(k)); }
      return next;
    });
  };

  const bulkExclude = () => {
    if (checkedKeys.size === 0) return;
    setLineItems((prev) => prev.map((item) =>
      checkedKeys.has(item.key) ? { ...item, included: false } : item
    ));
    setCheckedKeys(new Set());
  };

  const bulkInclude = () => {
    if (checkedKeys.size === 0) return;
    setLineItems((prev) => prev.map((item) =>
      checkedKeys.has(item.key) ? { ...item, included: true } : item
    ));
    setCheckedKeys(new Set());
  };

  const bulkIgnore = () => {
    if (checkedKeys.size === 0) return;
    // Only ignore excluded items
    const keysToIgnore = excludedItems.filter((i) => checkedKeys.has(i.key)).map((i) => i.key);
    if (keysToIgnore.length === 0) return;
    setIgnoredKeys((prev) => {
      const next = new Set(prev);
      keysToIgnore.forEach((k) => next.add(k));
      return next;
    });
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      keysToIgnore.forEach((k) => next.delete(k));
      return next;
    });
  };

  const unignoreAll = () => {
    setIgnoredKeys(new Set());
  };

  const updateLineItem = (key: string, field: keyof LineItem, value: any) => {
    setLineItems((prev) => prev.map((item) => {
      if (item.key !== key) return item;
      return { ...item, [field]: value };
    }));
  };

  const removeLineItem = (key: string) => {
    setLineItems((prev) => prev.filter((item) => item.key !== key));
    setCheckedKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
  };

  const removeTaskFromGroup = (groupKey: string, taskId: string) => {
    setLineItems((prev) => prev.flatMap((item) => {
      if (item.key !== groupKey) return [item];
      const idx = item.taskIds.indexOf(taskId);
      if (idx === -1) return [item];
      if (item.taskIds.length <= 1) return [];
      return [{
        ...item,
        taskIds: item.taskIds.filter((_, i) => i !== idx),
        taskNames: item.taskNames.filter((_, i) => i !== idx),
        dates: item.dates.filter((_, i) => i !== idx),
        tasks: item.tasks?.filter((t) => t.taskId !== taskId),
        quantity: item.taskIds.length - 1,
        flags: item.flags.filter((f) => f.taskId !== taskId),
      }];
    }));
  };

  // ── Derived data ──────────────────────────────────────────────────────

  const includedItems = useMemo(() => lineItems.filter((i) => i.included), [lineItems]);
  const excludedItems = useMemo(() => lineItems.filter((i) => !i.included && !ignoredKeys.has(i.key)), [lineItems, ignoredKeys]);
  const ignoredCount = useMemo(() => lineItems.filter((i) => !i.included && ignoredKeys.has(i.key)).length, [lineItems, ignoredKeys]);

  const flaggedItems = useMemo(
    () => lineItems.filter((i) => i.flags.length > 0),
    [lineItems]
  );

  const totalAmount = useMemo(
    () => includedItems.reduce((sum, i) => sum + (parseFloat(i.unitPrice) || 0) * i.quantity, 0),
    [includedItems]
  );

  // How many checked keys are in included vs excluded
  const checkedIncludedCount = useMemo(
    () => includedItems.filter((i) => checkedKeys.has(i.key)).length,
    [includedItems, checkedKeys]
  );
  const checkedExcludedCount = useMemo(
    () => excludedItems.filter((i) => checkedKeys.has(i.key)).length,
    [excludedItems, checkedKeys]
  );

  const buildInvoicePayload = () => {
    const billableItems = includedItems.filter((i) => parseFloat(i.unitPrice) > 0);
    if (billableItems.length === 0) return null;
    return {
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
    };
  };

  const handlePreviewInvoice = async () => {
    const payload = buildInvoicePayload();
    if (!payload) { toast.error("No billable items with a price > $0"); return; }

    try {
      const res = await previewLeisrInvoiceMutation.mutateAsync(payload);
      setResult({ success: true, invoiceId: res.invoiceId, dashboardUrl: res.dashboardUrl, amount: res.amount, isDraft: true });
      setStep(3);
      toast.success("Draft invoice created — preview it in Stripe");
    } catch (err: any) {
      setResult({ success: false, error: err.message });
      setStep(3);
      toast.error(`Failed: ${err.message}`);
    }
  };

  const handleSendInvoice = async () => {
    const payload = buildInvoicePayload();
    if (!payload) { toast.error("No billable items with a price > $0"); return; }

    try {
      const res = await sendLeisrInvoiceMutation.mutateAsync(payload);
      setResult({ success: true, invoiceId: res.invoiceId, invoiceUrl: res.invoiceUrl || undefined, amount: res.amount });
      setStep(3);
      toast.success(`Invoice sent to ${res.customerName}!`);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
      setStep(3);
      toast.error(`Failed: ${err.message}`);
    }
  };

  const isMutating = sendLeisrInvoiceMutation.isPending || previewLeisrInvoiceMutation.isPending;

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
                i === step ? "bg-violet-500/10 text-violet-600 border border-violet-500/30"
                : i < step ? "bg-muted text-foreground cursor-pointer hover:bg-muted/80"
                : "bg-muted/50 text-muted-foreground cursor-not-allowed"
              }`}
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${
                i <= step ? "bg-violet-500 text-white" : "bg-muted-foreground/30 text-muted-foreground"
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
            <CardTitle className="flex items-center gap-2"><Filter className="h-5 w-5" /> Leisr Task Filter</CardTitle>
            <CardDescription>Select a date range to find completed Leisr-tagged tasks for billing</CardDescription>
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
                <Input value={invoiceDescription} onChange={(e) => setInvoiceDescription(e.target.value)} placeholder="e.g. April 2026 5STR Invoice" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-4 border-t">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox checked={hideAlreadyBilled} onCheckedChange={(v) => setHideAlreadyBilled(!!v)} />
                  <span className="text-muted-foreground">Hide already billed tasks</span>
                </label>
                {hasFetched && billedTaskIds.size > 0 && !hideAlreadyBilled && (
                  <span className="text-xs text-amber-600">{billedTaskIds.size} previously billed included</span>
                )}
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7"
                disabled={bulkUpsertRatesMutation.isPending}
                onClick={async () => {
                  try {
                    const res = await bulkUpsertRatesMutation.mutateAsync({
                      entries: [
                        { propertySearch: "wyndsong", taskType: "turnover-clean", amount: "195.00" },
                        { propertySearch: "redwing", taskType: "turnover-clean", amount: "165.00" },
                        { propertySearch: "quaint cottage", taskType: "turnover-clean", amount: "140.00" },
                        { propertySearch: "mountain view 534", taskType: "turnover-clean", amount: "150.00" },
                        { propertySearch: "golden jewel/madison", taskType: "turnover-clean", amount: "430.00" },
                        { propertySearch: "golden jewel", taskType: "turnover-clean", amount: "225.00" },
                        { propertySearch: "madison", taskType: "turnover-clean", amount: "205.00" },
                        { propertySearch: "commerce loft", taskType: "turnover-clean", amount: "150.00" },
                        { propertySearch: "bass cove", taskType: "turnover-clean", amount: "435.00" },
                      ],
                    });
                    const summary = res.results.map((r: any) =>
                      r.errors.length > 0 ? `❌ ${r.search}: ${r.errors[0]}` : `✅ ${r.search}: ${r.matched.join(", ")} (${r.created} created, ${r.updated} updated)`
                    ).join("\n");
                    toast.success("Rate cards updated!", { description: summary, duration: 10000 });
                    rateCardsQuery.refetch();
                  } catch (err: any) {
                    toast.error(`Failed: ${err.message}`);
                  }
                }}
              >
                {bulkUpsertRatesMutation.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Updating...</> : "Seed Missing Rate Cards"}
              </Button>
            </div>
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                {tasksQuery.isLoading ? "Loading tasks..."
                  : hasFetched ? `${availableTasks.length} tasks found${hideAlreadyBilled && billedTaskIds.size > 0 ? ` (${billedTaskIds.size} already billed hidden)` : ""}`
                  : "Set date range and click Fetch Tasks"}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleFetch} disabled={tasksQuery.isLoading}>
                  {tasksQuery.isLoading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Fetching...</> : "Fetch Tasks"}
                </Button>
                <Button onClick={() => { toggleAll(); setStep(1); }} disabled={availableTasks.length === 0 || tasksQuery.isLoading}>
                  Review Tasks ({availableTasks.length}) <ChevronRight className="h-4 w-4 ml-1" />
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
                <CardDescription>{selectedTaskIds.size} of {availableTasks.length} tasks selected</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {selectedTaskIds.size === availableTasks.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-left w-10">
                      <Checkbox checked={selectedTaskIds.size === availableTasks.length && availableTasks.length > 0} onCheckedChange={toggleAll} />
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
                    const alreadyBilled = billedTaskIds.has(String(task.id));
                    const taskStage = task.type_task_status?.stage || "";
                    const taskStatusName = task.type_task_status?.name || "Unknown";
                    const isNotCompleted = taskStage !== "finished" || /cancel|skip|void/i.test(taskStatusName);
                    return (
                      <tr key={task.id} className={`border-t cursor-pointer hover:bg-muted/30 ${selected ? "bg-violet-50/50" : ""} ${isNotCompleted ? "bg-red-50/40" : ""}`} onClick={() => toggleTask(String(task.id))}>
                        <td className="p-3"><Checkbox checked={selected} onCheckedChange={() => toggleTask(String(task.id))} /></td>
                        <td className="p-3 font-medium">
                          <span className="flex items-center gap-2">
                            {task.name}
                            {alreadyBilled && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">Billed</Badge>}
                            {isNotCompleted && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-600 border-red-300 gap-0.5"><AlertTriangle className="h-2.5 w-2.5" /> Not Completed</Badge>}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground">{propertyNameMap.get(String(task.home_id)) || `#${task.home_id}`}</td>
                        <td className="p-3 text-muted-foreground">{fmtDate(task.scheduled_date || task.created_at)}</td>
                        <td className="p-3"><Badge variant="secondary" className={`text-xs ${isNotCompleted ? "bg-red-100 text-red-700" : ""}`}>{taskStatusName}</Badge></td>
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <a href={`https://app.breezeway.io/task/${task.id}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-violet-600 transition-colors">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                  {availableTasks.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No tasks available for billing in this date range</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(0)}><ChevronLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button onClick={() => { buildLineItems(); setStep(2); }} disabled={selectedTaskIds.size === 0}>
                Build Line Items ({selectedTaskIds.size} tasks) <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Line Items ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Invoice description */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> Leisr Invoice</CardTitle>
              <CardDescription>Turnover cleans grouped per property. Other tasks as individual items.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>Invoice Description</Label>
                <Input value={invoiceDescription} onChange={(e) => setInvoiceDescription(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {/* ── Flagged Items — Needs Review ── */}
          {flaggedItems.length > 0 && (
            <Card className="border-amber-300 bg-amber-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-amber-800 text-base">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Needs Review ({flaggedItems.length})
                </CardTitle>
                <CardDescription className="text-amber-700">
                  These items have potential issues — duplicates on the same day or tasks that may not have been completed. Review before sending.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {flaggedItems.map((item) => (
                    <div key={`flag:${item.key}`} className="rounded-lg border border-amber-200 bg-white p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{item.propertyName}</span>
                          <span className="text-muted-foreground text-xs">—</span>
                          <span className="text-sm text-muted-foreground">{item.label}{item.isGroupedClean ? ` × ${item.quantity}` : ""}</span>
                          {item.included ? (
                            <Badge className="bg-violet-100 text-violet-700 text-[10px] px-1.5 py-0">Included</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">Excluded</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {item.included ? (
                            <Button variant="outline" size="sm" className="h-6 text-xs px-2 border-amber-300 text-amber-700 hover:bg-amber-100"
                              onClick={() => updateLineItem(item.key, "included", false)}>
                              <EyeOff className="h-3 w-3 mr-1" /> Exclude
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="h-6 text-xs px-2"
                              onClick={() => updateLineItem(item.key, "included", true)}>
                              <Eye className="h-3 w-3 mr-1" /> Include
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {item.flags.map((f, fi) => (
                          <div key={fi} className="flex items-center gap-2 text-xs">
                            <Badge className={`text-[9px] px-1 py-0 ${
                              f.type === "duplicate" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"
                            }`}>
                              {f.type === "duplicate" ? "DUPLICATE?" : "INCOMPLETE?"}
                            </Badge>
                            <span className="text-amber-800">{f.message}</span>
                            {f.taskId && (
                              <a href={`https://app.breezeway.io/task/${f.taskId}`} target="_blank" rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-violet-600 transition-colors">
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* Show individual tasks if grouped */}
                      {item.isGroupedClean && item.tasks && item.tasks.some((t) => t.flagged) && (
                        <div className="mt-2 pt-2 border-t border-amber-100 space-y-1">
                          {item.tasks.filter((t) => t.flagged).map((t) => (
                            <div key={t.taskId} className="flex items-center justify-between text-xs text-amber-800">
                              <div className="flex items-center gap-2">
                                <span>{t.taskName}</span>
                                <span className="text-amber-500">{t.date}</span>
                                {t.flagReason && <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1 py-0">{t.flagReason}</Badge>}
                              </div>
                              <div className="flex items-center gap-1">
                                <a href={`https://app.breezeway.io/task/${t.taskId}`} target="_blank" rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-violet-600">
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-red-500"
                                  title="Remove this task from group" onClick={() => removeTaskFromGroup(item.key, t.taskId)}>
                                  <Trash2 className="h-2.5 w-2.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Included Items ── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Included ({includedItems.length})</CardTitle>
                {checkedIncludedCount > 0 && (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={bulkExclude}>
                    <EyeOff className="h-3 w-3" /> Exclude Selected ({checkedIncludedCount})
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-3 w-10">
                        <Checkbox
                          checked={includedItems.length > 0 && includedItems.every((i) => checkedKeys.has(i.key))}
                          onCheckedChange={() => toggleCheckAll(includedItems.map((i) => i.key))}
                        />
                      </th>
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
                      const hasFlagsOnItem = item.flags.length > 0;
                      return (
                        <>
                          <tr key={item.key} className={`border-t ${hasFlagsOnItem ? "bg-amber-50/40" : ""}`}>
                            <td className="p-3">
                              <Checkbox checked={checkedKeys.has(item.key)} onCheckedChange={() => toggleChecked(item.key)} />
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                {item.isGroupedClean && item.tasks && item.tasks.length > 0 && (
                                  <button onClick={() => toggleExpanded(item.key)} className="text-muted-foreground hover:text-foreground transition-colors">
                                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  </button>
                                )}
                                <span className="font-medium">{item.label}</span>
                                {item.isGroupedClean && (
                                  <Badge className="bg-violet-100 text-violet-700 text-[10px] px-1.5 py-0">Grouped</Badge>
                                )}
                                {hasFlagsOnItem && (
                                  <Badge className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0 gap-0.5">
                                    <AlertTriangle className="h-2.5 w-2.5" /> {item.flags.length}
                                  </Badge>
                                )}
                                {!item.isGroupedClean && (
                                  <a href={`https://app.breezeway.io/task/${item.taskIds[0]}`} target="_blank" rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-violet-600 transition-colors shrink-0">
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-muted-foreground">{item.propertyName}</td>
                            <td className="p-3 text-center font-medium">{item.quantity}</td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-muted-foreground text-xs">$</span>
                                <Input value={item.unitPrice} onChange={(e) => updateLineItem(item.key, "unitPrice", e.target.value)}
                                  className="w-20 text-right h-7 text-sm" />
                              </div>
                            </td>
                            <td className="p-3 text-right font-medium">${lineTotal.toFixed(2)}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-amber-600"
                                  title="Exclude" onClick={() => updateLineItem(item.key, "included", false)}>
                                  <EyeOff className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-500"
                                  title="Remove entirely" onClick={() => removeLineItem(item.key)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded task details for grouped cleans */}
                          {isExpanded && item.tasks && item.tasks.map((t) => (
                            <tr key={`${item.key}:${t.taskId}`} className={`border-t ${t.flagged ? "bg-amber-50/60" : "bg-muted/20"}`}>
                              <td className="p-2" />
                              <td className="p-2 pl-12" colSpan={2}>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={t.flagged ? "text-amber-700 font-medium" : "text-muted-foreground"}>{t.taskName}</span>
                                  {t.flagged && t.flagReason && (
                                    <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1 py-0">{t.flagReason}</Badge>
                                  )}
                                  <a href={`https://app.breezeway.io/task/${t.taskId}`} target="_blank" rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-violet-600 transition-colors shrink-0">
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                </div>
                              </td>
                              <td className="p-2 text-center text-xs text-muted-foreground">{t.date}</td>
                              <td className="p-2 text-right text-xs text-muted-foreground">{t.statusName}</td>
                              <td className="p-2" />
                              <td className="p-2">
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-red-500"
                                  title="Remove this task" onClick={() => removeTaskFromGroup(item.key, t.taskId)}>
                                  <Trash2 className="h-2.5 w-2.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </>
                      );
                    })}
                    {includedItems.length === 0 && (
                      <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No included items.</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30">
                      <td colSpan={5} className="p-3 text-right font-semibold">Total</td>
                      <td className="p-3 text-right font-bold text-lg">${totalAmount.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── Excluded Items ── */}
          {(excludedItems.length > 0 || ignoredCount > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base text-muted-foreground">Excluded ({excludedItems.length})</CardTitle>
                    {ignoredCount > 0 && (
                      <button onClick={unignoreAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors underline">
                        {ignoredCount} ignored — show all
                      </button>
                    )}
                  </div>
                  {checkedExcludedCount > 0 && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={bulkIgnore}>
                        <EyeOff className="h-3 w-3" /> Ignore Selected ({checkedExcludedCount})
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={bulkInclude}>
                        <Eye className="h-3 w-3" /> Include Selected ({checkedExcludedCount})
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              {excludedItems.length > 0 && (
                <CardContent>
                  <div className="border rounded-md overflow-hidden border-dashed">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="p-2.5 w-10">
                            <Checkbox
                              checked={excludedItems.length > 0 && excludedItems.every((i) => checkedKeys.has(i.key))}
                              onCheckedChange={() => toggleCheckAll(excludedItems.map((i) => i.key))}
                            />
                          </th>
                          <th className="p-2.5 text-left text-xs text-muted-foreground font-medium">Task</th>
                          <th className="p-2.5 text-left text-xs text-muted-foreground font-medium">Property</th>
                          <th className="p-2.5 text-left text-xs text-muted-foreground font-medium">Date</th>
                          <th className="p-2.5 text-right text-xs text-muted-foreground font-medium w-28">Price</th>
                          <th className="p-2.5 w-16" />
                        </tr>
                      </thead>
                      <tbody>
                        {excludedItems.map((item) => (
                          <tr key={item.key} className="border-t first:border-t-0">
                            <td className="p-2.5">
                              <Checkbox checked={checkedKeys.has(item.key)} onCheckedChange={() => toggleChecked(item.key)} />
                            </td>
                            <td className="p-2.5">
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <span>{item.label}</span>
                                {item.flags.length > 0 && (
                                  <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1 py-0"><AlertTriangle className="h-2.5 w-2.5" /></Badge>
                                )}
                                {item.taskIds.length === 1 && (
                                  <a href={`https://app.breezeway.io/task/${item.taskIds[0]}`} target="_blank" rel="noopener noreferrer"
                                    className="hover:text-violet-600 transition-colors shrink-0">
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
                                <Input value={item.unitPrice} onChange={(e) => updateLineItem(item.key, "unitPrice", e.target.value)}
                                  className="w-20 text-right h-7 text-sm" placeholder="0.00" />
                              </div>
                            </td>
                            <td className="p-2.5">
                              <Button variant="outline" size="sm" className="h-6 text-xs px-2"
                                onClick={() => updateLineItem(item.key, "included", true)}>
                                Include
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* ── Bottom actions ── */}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="h-4 w-4 mr-1" /> Back</Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handlePreviewInvoice}
                disabled={includedItems.length === 0 || totalAmount < 0.5 || isMutating}>
                {previewLeisrInvoiceMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating Draft...</>
                  : <><ExternalLink className="h-4 w-4 mr-1" /> Preview in Stripe</>}
              </Button>
              <Button onClick={handleSendInvoice}
                disabled={includedItems.length === 0 || totalAmount < 0.5 || isMutating}
                className="bg-violet-600 hover:bg-violet-700 text-white">
                {sendLeisrInvoiceMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending...</>
                  : <><Send className="h-4 w-4 mr-1" /> Send Invoice (${totalAmount.toFixed(2)})</>}
              </Button>
            </div>
          </div>
        </div>
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
                    <h3 className="text-lg font-semibold">
                      {result.isDraft ? "Draft Invoice Created" : "Invoice Sent!"}
                    </h3>
                    <p className="text-muted-foreground mt-1">
                      {result.isDraft
                        ? `$${result.amount} draft created — review and send from Stripe`
                        : `$${result.amount} invoice sent to Leisr Stays`}
                    </p>
                  </div>
                  {result.dashboardUrl && (
                    <a href={result.dashboardUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline font-medium">
                      <ExternalLink className="h-3.5 w-3.5" /> Open in Stripe Dashboard
                    </a>
                  )}
                  {result.invoiceUrl && (
                    <a href={result.invoiceUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> View Invoice in Stripe
                    </a>
                  )}
                  <Badge variant="secondary" className="text-xs font-mono">{result.invoiceId}</Badge>
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
                <Button variant="outline" onClick={() => { setResult(null); setStep(0); }}>New Invoice</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
