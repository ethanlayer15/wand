import { useState, useMemo, useCallback, useEffect } from "react";
import { loadBillingState, saveBillingState, clearBillingState, type BreezewayTaskCached } from "@/lib/billingStorage";
import { PropertyCombobox } from "@/components/PropertyCombobox";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import LeisrBilling from "@/pages/LeisrBilling";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  DollarSign,
  FileText,
  Send,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Plus,
  Trash2,
  Eye,
  Zap,
  ExternalLink,
} from "lucide-react";

// Types
type BreezewayTask = {
  id: number;
  name: string;
  home_id: number;
  type_department?: string;
  type_priority?: string;
  type_task_status?: { code: string; name: string; stage: string };
  scheduled_date?: string;
  created_at?: string;
  assignments?: Array<{ id: number; assignee_id: number; name: string; type_task_user_status: string }>;
  created_by?: { id: number; name: string };
};

type LineItem = {
  breezewayTaskId: string;
  breezewayTaskName: string;
  propertyId: string;
  propertyName: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  isCustom?: boolean;
};

type InvoiceGroup = {
  ownerId: string;
  ownerName: string;
  stripeCustomerId: string;
  hasPaymentMethod: boolean;
  lineItems: LineItem[];
  total: number;
};

const STEPS = ["Filter Tasks", "Review & Select", "Edit Line Items", "Preview Invoices", "Results"] as const;

export default function Billing() {
  // ── Restore state from localStorage on mount ────────────────────────────────
  const saved = useMemo(() => loadBillingState(), []);

  const [step, setStep] = useState<number>(saved?.step ?? 0);

  // Filters
  const [startDate, setStartDate] = useState<string>(saved?.startDate ?? "");
  const [endDate, setEndDate] = useState<string>(saved?.endDate ?? "");
  const [department, setDepartment] = useState<string>(saved?.department ?? "all");
  const [status, setStatus] = useState<string>(saved?.status ?? "all");
  const [propertyFilter, setPropertyFilter] = useState<string>(saved?.propertyFilter ?? "all");
  const [selectedTags, setSelectedTags] = useState<string[]>(saved?.selectedTags ?? []);
  // Whether the user has clicked "Review Tasks" at least once
  const [hasFetched, setHasFetched] = useState<boolean>(saved?.hasFetched ?? false);
  // Cached task rows — persisted so the table is fully restored when navigating back
  const [cachedTasks, setCachedTasks] = useState<BreezewayTaskCached[]>(saved?.cachedTasks ?? []);

  // Selected tasks and line items
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(
    new Set(saved?.selectedTaskIds ?? [])
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(saved?.lineItems ?? []);
  const [billingResults, setBillingResults] = useState<Array<{
    ownerId: string;
    ownerName: string;
    method: string;
    success: boolean;
    amount: string;
    error?: string;
    paymentIntentId?: string;
    invoiceId?: string;
    invoiceUrl?: string;
  }>>(saved?.billingResults ?? []);

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    group: InvoiceGroup | null;
    method: "card" | "invoice";
  }>({ open: false, group: null, method: "card" });

  // Fetch Breezeway taskss — only fires when hasFetched is true
  // Pass propertyTags to server so it only fetches tasks for matching properties
  // Use fetchedFilters snapshot so the query only re-fires when the user explicitly clicks Fetch Tasks
   const [fetchedFilters, setFetchedFilters] = useState<{
    status?: string;
    startDate?: string;
    endDate?: string;
    propertyTags?: string[];
  } | null>(saved?.fetchedFilters ?? null);

  // ── Persist state to localStorage whenever it changes ────────────────────────
  useEffect(() => {
    saveBillingState({
      step,
      startDate,
      endDate,
      department,
      status,
      propertyFilter,
      selectedTags,
      hasFetched,
      selectedTaskIds: Array.from(selectedTaskIds),
      cachedTasks,
      lineItems,
      billingResults,
      fetchedFilters,
    });
  }, [step, startDate, endDate, department, status, propertyFilter, selectedTags, hasFetched, selectedTaskIds, cachedTasks, lineItems, billingResults, fetchedFilters]);

  const tasksQuery = trpc.breezeway.tasks.listByProperty.useQuery(
    fetchedFilters ?? {
      status: undefined,
      startDate: undefined,
      endDate: undefined,
      propertyTags: undefined,
      limit: 200,
    },
    {
      enabled: hasFetched && fetchedFilters !== null && step <= 1,
    }
  );
  // ── Update cachedTasks when fresh query data arrives (must be after tasksQuery) ───────
  useEffect(() => {
    if (tasksQuery.data?.results && tasksQuery.data.results.length > 0) {
      setCachedTasks(tasksQuery.data.results as BreezewayTaskCached[]);
    }
  }, [tasksQuery.data]);
  // Fetch properties for filter dropdown (from DB, includes tags)
  const propertiesQuery = trpc.billing.breezewayProperties.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  // Fetch distinct property tags for the tag filter dropdown
  const propertyTagsQuery = trpc.billing.propertyTags.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  // Fetch rate cards
  const rateCardsQuery = trpc.billing.rateCards.list.useQuery();

  // Fetch customer mappings
  const customerMappingsQuery = trpc.billing.customerMappings.list.useQuery();

  // Fetch existing billing records to check for duplicates
  const taskIds = useMemo(() => {
    const tasks = (tasksQuery.data?.results?.length ? tasksQuery.data.results : cachedTasks) as BreezewayTask[];
    return tasks.map((t) => String(t.id));
  }, [tasksQuery.data, cachedTasks]);

  const billingRecordsQuery = trpc.billing.records.byTaskIds.useQuery(
    { taskIds },
    { enabled: taskIds.length > 0 }
  );

  const billedTaskIds = useMemo(() => {
    const records = billingRecordsQuery.data || [];
    return new Set(records.map((r) => r.breezewayTaskId));
  }, [billingRecordsQuery.data]);

  // Mutations
  const chargeCardMutation = trpc.billing.chargeCard.useMutation();
  const sendInvoiceMutation = trpc.billing.sendInvoice.useMutation();

  // Filter tasks — use live query data if available, fall back to cachedTasks when query is disabled (step > 1)
  const filteredTasks = useMemo(() => {
    const tasks = (tasksQuery.data?.results?.length ? tasksQuery.data.results : cachedTasks) as BreezewayTask[];
    return tasks.filter((t) => {
      if (department !== "all" && t.type_department !== department) return false;
      if (propertyFilter !== "all" && String(t.home_id) !== propertyFilter) return false;
      // Property tag filter: check if the task's property has ALL selected tags
      if (selectedTags.length > 0) {
        const prop = (propertiesQuery.data || []).find((p) => p.id === String(t.home_id));
        const propTags: string[] = prop?.tags ?? [];
        const hasAllTags = selectedTags.every((tag) => propTags.includes(tag));
        if (!hasAllTags) return false;
      }
      return true;
    });
  }, [tasksQuery.data, cachedTasks, department, propertyFilter, selectedTags, propertiesQuery.data]);

  // Get rate for a task
  const getRate = useCallback(
    (propertyId: string, taskType: string): string => {
      const rates = rateCardsQuery.data || [];
      const match = rates.find(
        (r) => r.propertyId === propertyId && r.taskType.toLowerCase() === taskType.toLowerCase()
      );
      return match ? match.amount : "";
    },
    [rateCardsQuery.data]
  );

  // Build line items from selected tasks
  const buildLineItems = useCallback(() => {
    const tasks = filteredTasks.filter((t) => selectedTaskIds.has(String(t.id)));
    const items: LineItem[] = tasks.map((t) => {
      const dept = t.type_department || "general";
      const rate = getRate(String(t.home_id), dept);
      const property = propertiesQuery.data?.find((p) => p.id === String(t.home_id));
      const unitPrice = rate || "0";
      return {
        breezewayTaskId: String(t.id),
        breezewayTaskName: t.name,
        propertyId: String(t.home_id),
        propertyName: property?.name || `Property #${t.home_id}`,
        description: `${dept} - ${t.name}`,
        quantity: 1,
        unitPrice,
        amount: unitPrice,
      };
    });
    setLineItems(items);
  }, [filteredTasks, selectedTaskIds, getRate, propertiesQuery.data]);

  // Group line items by owner for invoice preview
  const invoiceGroups = useMemo((): InvoiceGroup[] => {
    const mappings = customerMappingsQuery.data || [];
    const groups: Record<string, InvoiceGroup> = {};

    for (const item of lineItems) {
      // Find customer mapping for this property
      // For now, group by propertyId as owner proxy
      const mapping = mappings.find((m) => m.breezewayOwnerId === item.propertyId);
      const ownerId = mapping?.breezewayOwnerId || item.propertyId;
      const ownerName = mapping?.breezewayOwnerName || item.propertyName;
      const stripeCustomerId = mapping?.stripeCustomerId || "";

      if (!groups[ownerId]) {
        groups[ownerId] = {
          ownerId,
          ownerName,
          stripeCustomerId,
          hasPaymentMethod: false,
          lineItems: [],
          total: 0,
        };
      }

      groups[ownerId].lineItems.push(item);
      const amt = parseFloat(item.amount) || 0;
      groups[ownerId].total += amt;
    }

    return Object.values(groups);
  }, [lineItems, customerMappingsQuery.data]);

  // Handle select all / deselect all
  const toggleSelectAll = () => {
    if (selectedTaskIds.size === filteredTasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(filteredTasks.map((t) => String(t.id))));
    }
  };

  // Handle billing action
  const handleBillingAction = async (group: InvoiceGroup, method: "card" | "invoice") => {
    if (!group.stripeCustomerId) {
      toast.error(`No Stripe customer mapped for ${group.ownerName}. Go to Billing > Customer Mapping to set it up.`);
      return;
    }

    const validItems = group.lineItems.filter((i) => parseFloat(i.amount) > 0);
    if (validItems.length === 0) {
      toast.error("No line items with valid amounts.");
      return;
    }

    setConfirmDialog({ open: true, group, method });
  };

  const executeAction = async () => {
    const { group, method } = confirmDialog;
    if (!group) return;

    setConfirmDialog({ open: false, group: null, method: "card" });

    const validItems = group.lineItems.filter((i) => parseFloat(i.amount) > 0);

    try {
      if (method === "card") {
        const result = await chargeCardMutation.mutateAsync({
          stripeCustomerId: group.stripeCustomerId,
          lineItems: validItems,
        });
        setBillingResults((prev) => [
          ...prev,
          {
            ownerId: group.ownerId,
            ownerName: group.ownerName,
            method: "Card on File",
            success: true,
            amount: result.amount,
            paymentIntentId: result.paymentIntentId,
          },
        ]);
        toast.success(`Charged $${result.amount} to ${group.ownerName}'s card`);
      } else {
        const result = await sendInvoiceMutation.mutateAsync({
          stripeCustomerId: group.stripeCustomerId,
          lineItems: validItems,
        });
        setBillingResults((prev) => [
          ...prev,
          {
            ownerId: group.ownerId,
            ownerName: group.ownerName,
            method: "Invoice Sent",
            success: true,
            amount: result.amount,
            invoiceId: result.invoiceId,
            invoiceUrl: result.invoiceUrl || undefined,
          },
        ]);
        toast.success(`Invoice sent to ${group.ownerName} for $${result.amount}`);
      }
    } catch (err: any) {
      setBillingResults((prev) => [
        ...prev,
        {
          ownerId: group.ownerId,
          ownerName: group.ownerName,
          method: method === "card" ? "Card on File" : "Invoice",
          success: false,
          amount: group.total.toFixed(2),
          error: err.message || "Unknown error",
        },
      ]);
      toast.error(`Failed to bill ${group.ownerName}: ${err.message}`);
    }
  };

  // Add custom line item to the edit step
  const addCustomLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        breezewayTaskId: `custom_${Date.now()}`,
        breezewayTaskName: "Custom charge",
        propertyId: "",
        propertyName: "Custom",
        description: "",
        quantity: 1,
        unitPrice: "",
        amount: "0",
        isCustom: true,
      },
    ]);
  };

  const updateLineItem = (taskId: string, field: "description" | "quantity" | "unitPrice", value: string | number) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.breezewayTaskId !== taskId) return item;
        const updated = { ...item, [field]: value };
        // Recalculate amount when quantity or unitPrice changes
        if (field === "quantity" || field === "unitPrice") {
          const qty = field === "quantity" ? Number(value) : item.quantity;
          const price = field === "unitPrice" ? String(value) : item.unitPrice;
          updated.amount = (qty * (parseFloat(price) || 0)).toFixed(2);
        }
        return updated;
      })
    );
  };

  const removeLineItem = (taskId: string) => {
    setLineItems((prev) => prev.filter((item) => item.breezewayTaskId !== taskId));
  };

  // Workflow selector state
  const [workflow, setWorkflow] = useState<"per-property" | "leisr">("per-property");

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-emerald-500" />
            Billing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review Breezeway tasks and bill property owners via Stripe
          </p>
        </div>
      </div>

      {/* Workflow Selector */}
      <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setWorkflow("per-property")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            workflow === "per-property"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Per-Property Billing
          </span>
        </button>
        <button
          onClick={() => setWorkflow("leisr")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            workflow === "leisr"
              ? "bg-violet-500/10 text-violet-600 shadow-sm border border-violet-500/20"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Leisr Billing
          </span>
        </button>
      </div>

      {/* Leisr Billing Workflow */}
      {workflow === "leisr" && <LeisrBilling />}

      {/* Per-Property Billing Workflow */}
      {workflow === "per-property" && <>
      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              onClick={() => {
                if (i < step) setStep(i);
              }}
              disabled={i > step}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                i === step
                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
                  : i < step
                  ? "bg-muted text-foreground cursor-pointer hover:bg-muted/80"
                  : "bg-muted/50 text-muted-foreground cursor-not-allowed"
              }`}
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${
                i < step ? "bg-emerald-500 text-white" : i === step ? "bg-emerald-500 text-white" : "bg-muted-foreground/30 text-muted-foreground"
              }`}>
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 1: Filter Tasks */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filter Breezeway Tasks
            </CardTitle>
            <CardDescription>
              Select a date range and optional filters to find tasks for billing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    <SelectItem value="turnover-clean">Turnover Clean</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Property</Label>
                <PropertyCombobox
                  properties={(propertiesQuery.data || []).map((p) => ({
                    id: p.id,
                    name: p.name || `Property #${p.id}`,
                  }))}
                  value={propertyFilter}
                  onValueChange={setPropertyFilter}
                  allLabel="All Properties"
                  placeholder="Select property…"
                  className="w-full"
                />
              </div>
            </div>

            {/* Billing Presets — quick-select billing group tags */}
            {(propertyTagsQuery.data || []).some((t) =>
              ["Leisr Billing", "Weekly Billing WNC"].includes(t)
            ) && (
              <div className="space-y-2">
                <Label>Billing Presets</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Leisr Billing", tag: "Leisr Billing", color: "violet" },
                    { label: "Weekly Billing WNC", tag: "Weekly Billing WNC", color: "sky" },
                  ]
                    .filter(({ tag }) => (propertyTagsQuery.data || []).includes(tag))
                    .map(({ label, tag }) => {
                      const isActive =
                        selectedTags.length === 1 && selectedTags[0] === tag;
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            setSelectedTags(isActive ? [] : [tag])
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                            isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-foreground border-border hover:border-primary/60 hover:bg-primary/5"
                          }`}
                        >
                          <Zap className="h-3 w-3" />
                          {label}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Property Tag multi-select filter */}
            {(propertyTagsQuery.data || []).length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  Property Tags
                  {selectedTags.length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {selectedTags.length} selected
                    </Badge>
                  )}
                </Label>
                <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-muted/30 min-h-[44px]">
                  {(propertyTagsQuery.data || []).map((tag) => {
                    const isActive = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setSelectedTags((prev) =>
                            isActive ? prev.filter((t) => t !== tag) : [...prev, tag]
                          );
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          isActive
                            ? "bg-emerald-500 text-white border-emerald-500"
                            : "bg-background text-foreground border-border hover:border-emerald-400 hover:text-emerald-600"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                  {selectedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTags([])}
                      className="px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                {tasksQuery.isLoading
                  ? "Loading tasks..."
                  : hasFetched
                  ? `${filteredTasks.length} task${filteredTasks.length !== 1 ? "s" : ""} found`
                  : "Set filters and click \"Fetch Tasks\" to load"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    // Snapshot current filter values so the query fires with exact current params
                    setFetchedFilters({
                      status: status !== "all" ? status : undefined,
                      startDate: startDate || undefined,
                      endDate: endDate || undefined,
                      propertyTags: selectedTags.length > 0 ? selectedTags : undefined,
                    });
                    setHasFetched(true);
                  }}
                  disabled={tasksQuery.isLoading}
                >
                  {tasksQuery.isLoading ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Fetching...</>
                  ) : (
                    "Fetch Tasks"
                  )}
                </Button>
                <Button
                  onClick={() => {
                    setSelectedTaskIds(new Set());
                    setStep(1);
                  }}
                  disabled={filteredTasks.length === 0 || tasksQuery.isLoading || !hasFetched}
                >
                  Review Tasks ({filteredTasks.length})
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Review & Select */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Review & Select Tasks</CardTitle>
                <CardDescription>
                  {selectedTaskIds.size} of {filteredTasks.length} tasks selected
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                  {selectedTaskIds.size === filteredTasks.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left">
                    <th className="p-2 w-10"></th>
                    <th className="p-2">Task</th>
                    <th className="p-2">Property</th>
                    <th className="p-2">Department</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Date</th>
                    <th className="p-2 text-right">Rate</th>
                    <th className="p-2 w-16">Billed</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task) => {
                    const taskId = String(task.id);
                    const isBilled = billedTaskIds.has(taskId);
                    const isSelected = selectedTaskIds.has(taskId);
                    const property = propertiesQuery.data?.find((p) => p.id === String(task.home_id));
                    const dept = task.type_department || "general";
                    const rate = getRate(String(task.home_id), dept);

                    return (
                      <tr
                        key={task.id}
                        className={`border-b hover:bg-muted/50 transition-colors ${
                          isBilled ? "opacity-50" : ""
                        }`}
                      >
                        <td className="p-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => {
                              const next = new Set(selectedTaskIds);
                              if (checked) next.add(taskId);
                              else next.delete(taskId);
                              setSelectedTaskIds(next);
                            }}
                            disabled={isBilled}
                          />
                        </td>
                        <td className="p-2 font-medium">{task.name}</td>
                        <td className="p-2 text-muted-foreground">
                          {property?.name || `#${task.home_id}`}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-xs capitalize">
                            {dept}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={
                              task.type_task_status?.stage === "completed"
                                ? "default"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {task.type_task_status?.name || "—"}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {task.scheduled_date
                            ? new Date(task.scheduled_date).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {rate ? `$${rate}` : <span className="text-amber-500">—</span>}
                        </td>
                        <td className="p-2 text-center">
                          {isBilled && (
                            <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600">
                              Billed
                            </Badge>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <a
                            href={`https://app.breezeway.io/task/${task.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Open in Breezeway"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>

            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Filters
              </Button>
              <Button
                onClick={() => {
                  buildLineItems();
                  setStep(2);
                }}
                disabled={selectedTaskIds.size === 0}
              >
                Edit Line Items ({selectedTaskIds.size} tasks)
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Edit Line Items */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Edit Line Items</CardTitle>
                <CardDescription>
                  Review and adjust line items before creating invoices
                </CardDescription>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold font-mono">
                  ${lineItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {lineItems.length} line items
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScrollArea className="h-[400px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left">
                    <th className="p-2">Description</th>
                    <th className="p-2 w-20 text-center">Qty</th>
                    <th className="p-2 w-32 text-right">Unit Price</th>
                    <th className="p-2 w-32 text-right">Total</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => (
                    <tr key={item.breezewayTaskId} className="border-b hover:bg-muted/50">
                      <td className="p-2">
                        <Input
                          value={item.description}
                          onChange={(e) => updateLineItem(item.breezewayTaskId, "description", e.target.value)}
                          placeholder="Description"
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(item.breezewayTaskId, "quantity", parseInt(e.target.value) || 1)}
                          min="1"
                          className="h-8 text-center font-mono"
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-muted-foreground">$</span>
                          <Input
                            value={item.unitPrice}
                            onChange={(e) => updateLineItem(item.breezewayTaskId, "unitPrice", e.target.value)}
                            placeholder="0.00"
                            className="h-8 w-24 text-right font-mono"
                            type="number"
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </td>
                      <td className="p-2 text-right font-mono">
                        ${parseFloat(item.amount).toFixed(2)}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeLineItem(item.breezewayTaskId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            <Button
              variant="outline"
              size="sm"
              onClick={addCustomLineItem}
              className="text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Custom Line Item
            </Button>

            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Selection
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={lineItems.length === 0 || lineItems.every((i) => parseFloat(i.amount) === 0)}
              >
                Preview Invoices
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Invoice Preview */}
      {step === 3 && (
        <div className="space-y-4">
          {invoiceGroups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No line items to preview. Go back and select tasks.
              </CardContent>
            </Card>
          ) : (
            invoiceGroups.map((group) => (
              <Card key={group.ownerId}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{group.ownerName}</CardTitle>
                      <CardDescription>
                        {group.stripeCustomerId ? (
                          <span className="text-emerald-600">
                            Stripe: {group.stripeCustomerId}
                          </span>
                        ) : (
                          <span className="text-amber-500 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            No Stripe customer mapped
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold font-mono">
                        ${group.total.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.lineItems.length} line items
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-2">Description</th>
                        <th className="p-2 w-20 text-center">Qty</th>
                        <th className="p-2 w-32 text-right">Unit Price</th>
                        <th className="p-2 w-32 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.lineItems.map((item) => (
                        <tr key={item.breezewayTaskId} className="border-b">
                          <td className="p-2 text-muted-foreground truncate max-w-[300px]">
                            {item.description}
                          </td>
                          <td className="p-2 text-center font-mono">{item.quantity}</td>
                          <td className="p-2 text-right font-mono">${parseFloat(item.unitPrice).toFixed(2)}</td>
                          <td className="p-2 text-right font-mono">${parseFloat(item.amount).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <Separator />

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleBillingAction(group, "card")}
                      disabled={!group.stripeCustomerId || chargeCardMutation.isPending}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Charge Card on File
                    </Button>
                    <Button
                      onClick={() => handleBillingAction(group, "invoice")}
                      disabled={!group.stripeCustomerId || sendInvoiceMutation.isPending}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send Invoice
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to Line Items
            </Button>
            {billingResults.length > 0 && (
              <Button onClick={() => setStep(4)}>
                View Results
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Step 5: Results */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Billing Results
            </CardTitle>
            <CardDescription>
              Summary of billing actions taken
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {billingResults.map((result, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    result.success
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {result.success ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    )}
                    <div>
                      <p className="font-medium">{result.ownerName}</p>
                      <p className="text-sm text-muted-foreground">
                        {result.method} — ${result.amount}
                      </p>
                      {result.error && (
                        <p className="text-sm text-destructive mt-1">{result.error}</p>
                      )}
                      {result.invoiceUrl && (
                        <a
                          href={result.invoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-500 hover:underline mt-1 inline-block"
                        >
                          View Invoice →
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={result.success ? "default" : "destructive"}>
                      {result.success ? "Success" : "Failed"}
                    </Badge>
                    {result.paymentIntentId && (
                      <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {result.paymentIntentId}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 mt-4 border-t">
              <Button variant="outline" onClick={() => {
                clearBillingState();
                setBillingResults([]);
                setSelectedTaskIds(new Set());
                setLineItems([]);
                setHasFetched(false);
                setFetchedFilters(null);
                setStartDate("");
                setEndDate("");
                setDepartment("all");
                setStatus("all");
                setPropertyFilter("all");
                setSelectedTags([]);
                setStep(0);
              }}>
                Start New Billing Run
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      </>}

      {/* Confirmation Dialog (per-property) */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog({ open: false, group: null, method: "card" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmDialog.method === "card" ? (
                <>
                  <CreditCard className="h-5 w-5" />
                  Confirm Card Charge
                </>
              ) : (
                <>
                  <Send className="h-5 w-5" />
                  Confirm Send Invoice
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              Please review the details below before proceeding.
            </DialogDescription>
          </DialogHeader>

          {confirmDialog.group && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Owner:</span>
                <span className="font-medium">{confirmDialog.group.ownerName}</span>
                <span className="text-muted-foreground">Stripe Customer:</span>
                <span className="font-mono text-xs">{confirmDialog.group.stripeCustomerId}</span>
                <span className="text-muted-foreground">Method:</span>
                <span>{confirmDialog.method === "card" ? "Charge Card on File" : "Send Invoice (Net 30)"}</span>
                <span className="text-muted-foreground">Line Items:</span>
                <span>{confirmDialog.group.lineItems.filter((i) => parseFloat(i.amount) > 0).length}</span>
              </div>

              <Separator />

              <div className="space-y-1">
                {confirmDialog.group.lineItems
                  .filter((i) => parseFloat(i.amount) > 0)
                  .map((item) => (
                    <div key={item.breezewayTaskId} className="flex justify-between text-sm">
                      <span className="text-muted-foreground truncate max-w-[300px]">
                        {item.description}
                      </span>
                      <span className="font-mono">${parseFloat(item.amount).toFixed(2)}</span>
                    </div>
                  ))}
              </div>

              <Separator />

              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="font-mono">
                  $
                  {confirmDialog.group.lineItems
                    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
                    .toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog({ open: false, group: null, method: "card" })}
            >
              Cancel
            </Button>
            <Button
              onClick={executeAction}
              disabled={chargeCardMutation.isPending || sendInvoiceMutation.isPending}
            >
              {(chargeCardMutation.isPending || sendInvoiceMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {confirmDialog.method === "card" ? "Charge Now" : "Send Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
