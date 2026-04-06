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
  Send, CheckCircle2, AlertTriangle, ExternalLink, Trash2,
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

type PropertyGroup = {
  propertyName: string;
  propertyId: string;
  tasks: BreezewayTask[];
  quantity: number;
  unitPrice: string;
  amount: string;
};

const STEPS = ["Filter", "Review", "Line Items", "Send"];

// ── Component ───────────────────────────────────────────────────────────

export default function LeisrBilling() {
  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // first of current month
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
  const [propertyGroups, setPropertyGroups] = useState<PropertyGroup[]>([]);
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

  // Filter out already-billed tasks
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
      // Also store a fallback with just propertyId
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

  // ── Resolve property name ─────────────────────────────────────────────

  const propertyNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of propertiesQuery.data || []) {
      map.set(String(p.id), p.name || `Property ${p.id}`);
    }
    return map;
  }, [propertiesQuery.data]);

  // ── Build property groups from selected tasks ─────────────────────────

  const buildPropertyGroups = useCallback(() => {
    const tasks = availableTasks.filter((t) => selectedTaskIds.has(String(t.id)));
    const grouped = new Map<string, BreezewayTask[]>();

    for (const task of tasks) {
      const key = String(task.home_id);
      const existing = grouped.get(key) || [];
      existing.push(task);
      grouped.set(key, existing);
    }

    const groups: PropertyGroup[] = [];
    for (const [propertyId, propertyTasks] of grouped) {
      const rate = getRate(propertyId, "turnover-clean");
      const qty = propertyTasks.length;
      groups.push({
        propertyId,
        propertyName: propertyNameMap.get(propertyId) || `Property ${propertyId}`,
        tasks: propertyTasks,
        quantity: qty,
        unitPrice: rate,
        amount: (qty * parseFloat(rate || "0")).toFixed(2),
      });
    }

    groups.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
    setPropertyGroups(groups);
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

  const updateGroupField = (propertyId: string, field: "unitPrice" | "quantity", value: string) => {
    setPropertyGroups((prev) =>
      prev.map((g) => {
        if (g.propertyId !== propertyId) return g;
        const updated = { ...g, [field]: field === "quantity" ? parseInt(value) || 0 : value };
        updated.amount = (updated.quantity * parseFloat(updated.unitPrice || "0")).toFixed(2);
        return updated;
      })
    );
  };

  const removeGroup = (propertyId: string) => {
    setPropertyGroups((prev) => prev.filter((g) => g.propertyId !== propertyId));
  };

  const totalAmount = useMemo(
    () => propertyGroups.reduce((sum, g) => sum + parseFloat(g.amount || "0"), 0),
    [propertyGroups]
  );

  const handleSendInvoice = async () => {
    try {
      const res = await sendLeisrInvoiceMutation.mutateAsync({
        lineItems: propertyGroups.map((g) => ({
          propertyName: g.propertyName,
          quantity: g.quantity,
          unitPrice: g.unitPrice,
          amount: g.amount,
          taskIds: g.tasks.map((t) => String(t.id)),
          taskNames: g.tasks.map((t) => t.name),
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
                          {task.scheduled_date
                            ? new Date(task.scheduled_date).toLocaleDateString()
                            : task.created_at
                            ? new Date(task.created_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary" className="text-xs">
                            {task.type_task_status?.name || "Unknown"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {availableTasks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
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
                onClick={() => { buildPropertyGroups(); setStep(2); }}
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
              Leisr Invoice Preview
            </CardTitle>
            <CardDescription>
              Review line items before sending. Prices are from your rate card.
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

            <Separator />

            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-left">Property</th>
                    <th className="p-3 text-center w-20">Qty</th>
                    <th className="p-3 text-right w-28">Rate</th>
                    <th className="p-3 text-right w-28">Total</th>
                    <th className="p-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {propertyGroups.map((group) => (
                    <tr key={group.propertyId} className="border-t">
                      <td className="p-3">
                        <div className="font-medium">{group.propertyName}</div>
                        <div className="text-xs text-muted-foreground">
                          {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <Input
                          type="number"
                          min={1}
                          value={group.quantity}
                          onChange={(e) => updateGroupField(group.propertyId, "quantity", e.target.value)}
                          className="w-16 text-center mx-auto h-8"
                        />
                      </td>
                      <td className="p-3 text-right">
                        <Input
                          value={group.unitPrice}
                          onChange={(e) => updateGroupField(group.propertyId, "unitPrice", e.target.value)}
                          className="w-24 text-right ml-auto h-8"
                        />
                      </td>
                      <td className="p-3 text-right font-medium">
                        ${parseFloat(group.amount).toFixed(2)}
                      </td>
                      <td className="p-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-500"
                          onClick={() => removeGroup(group.propertyId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td colSpan={3} className="p-3 text-right font-semibold">
                      Total
                    </td>
                    <td className="p-3 text-right font-bold text-lg">
                      ${totalAmount.toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {propertyGroups.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No line items. Go back and select tasks.
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={handleSendInvoice}
                disabled={propertyGroups.length === 0 || totalAmount < 0.5 || sendLeisrInvoiceMutation.isPending}
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
