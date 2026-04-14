import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Users,
  Calculator,
  Upload,
  RefreshCw,
  Search,
  Edit2,
  Save,
  X,
  Star,
  ArrowUpRight,
  TrendingUp,
  DollarSign,
  Fuel,
  Plus,
  Check,
  Hexagon,
  Mail,
  Link2,
  Copy,
  ExternalLink,
  Send,
  Trash2,
  ClipboardList,
  Phone,
  Wrench,
  Calendar,
  Home,
  MessageSquare,
  ChevronRight,
  Receipt,
  Download,
  FileCheck2,
} from "lucide-react";
import { useState, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ── Types ─────────────────────────────────────────────────────────────

const BEDROOM_TIER_LABELS: Record<number, string> = {
  1: "1 BR / Studio",
  2: "2 Bedrooms",
  3: "3 Bedrooms",
  4: "4 Bedrooms",
  5: "5+ Bedrooms",
};

// ── Main Component ──────────────────────────────────────────────────

export default function Compensation() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Compensation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage property tiers, cleaner scores, and the tiered hybrid pay model.
        </p>
      </div>

      <Tabs defaultValue="properties" className="space-y-4">
        <TabsList>
          <TabsTrigger value="properties" className="text-xs">
            <Building2 className="h-3.5 w-3.5 mr-1" />
            Properties
          </TabsTrigger>
          <TabsTrigger value="cleaners" className="text-xs">
            <Users className="h-3.5 w-3.5 mr-1" />
            Cleaners
          </TabsTrigger>
          <TabsTrigger value="cleans" className="text-xs">
            <ClipboardList className="h-3.5 w-3.5 mr-1" />
            Cleans
          </TabsTrigger>
          <TabsTrigger value="calculator" className="text-xs">
            <Calculator className="h-3.5 w-3.5 mr-1" />
            Pay Calculator
          </TabsTrigger>
          <TabsTrigger value="payroll" className="text-xs">
            <Receipt className="h-3.5 w-3.5 mr-1" />
            Payroll
          </TabsTrigger>
        </TabsList>

        <TabsContent value="properties">
          <PropertiesTab />
        </TabsContent>
        <TabsContent value="cleaners">
          <CleanersManagementTab />
        </TabsContent>
        <TabsContent value="cleans">
          <CleansHistoryTab />
        </TabsContent>
        <TabsContent value="calculator">
          <PayCalculatorTab />
        </TabsContent>
        <TabsContent value="payroll">
          <PayrollTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Properties Tab ──────────────────────────────────────────────────

function PropertiesTab() {
  const { data: properties, isLoading, refetch } = trpc.compensation.properties.list.useQuery();
  const { data: podList } = trpc.pods.list.useQuery();
  const updateMutation = trpc.compensation.properties.update.useMutation({
    onSuccess: () => {
      toast.success("Property updated");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const bulkUpdateMutation = trpc.compensation.properties.bulkUpdate.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.updated} properties updated`);
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} errors during bulk update`);
      }
      refetch();
      setShowBulkImport(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const [search, setSearch] = useState("");
  const [podFilter, setPodFilter] = useState<string>("all");
  const [showAutoAssign, setShowAutoAssign] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{
    bedroomTier: number | null;
    distanceFromStorage: string;
    cleaningFeeCharge: string;
  }>({ bedroomTier: null, distanceFromStorage: "", cleaningFeeCharge: "" });
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkData, setBulkData] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!properties) return [];
    const q = search.toLowerCase();
    return properties.filter((p) => {
      const matchesSearch =
        (p.internalName || p.name).toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.city?.toLowerCase().includes(q) ||
        p.state?.toLowerCase().includes(q);
      const matchesPod =
        podFilter === "all" ? true :
        podFilter === "unassigned" ? !p.podId :
        p.podId === parseInt(podFilter);
      return matchesSearch && matchesPod;
    });
  }, [properties, search, podFilter]);

  const startEdit = (p: typeof filtered[0]) => {
    setEditingId(p.id);
    setEditValues({
      bedroomTier: p.bedroomTier,
      distanceFromStorage: p.distanceFromStorage ?? "",
      cleaningFeeCharge: p.cleaningFeeCharge ?? "",
    });
  };

  const saveEdit = () => {
    if (editingId === null) return;
    updateMutation.mutate({
      listingId: editingId,
      bedroomTier: editValues.bedroomTier,
      distanceFromStorage: editValues.distanceFromStorage || null,
      cleaningFeeCharge: editValues.cleaningFeeCharge || null,
    });
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  // Bulk import parsing: expects CSV or tab-separated
  // Format: PropertyName, BedroomTier, DistanceFromStorage, CleaningFeeCharge
  const parseBulkData = useCallback(() => {
    if (!properties) return [];
    const lines = bulkData.trim().split("\n").filter((l) => l.trim());
    const updates: Array<{
      listingId: number;
      propertyName: string;
      bedroomTier: number | null;
      distanceFromStorage: string | null;
      cleaningFeeCharge: string | null;
      matched: boolean;
    }> = [];

    for (const line of lines) {
      // Support CSV or tab-separated
      const parts = line.includes("\t") ? line.split("\t") : line.split(",");
      if (parts.length < 2) continue;

      const name = parts[0].trim();
      const tier = parseInt(parts[1]?.trim() ?? "");
      const distance = parts[2]?.trim() ?? "";
      const fee = parts[3]?.trim() ?? "";

      // Try to match by name (fuzzy)
      const match = properties.find(
        (p) =>
          (p.internalName || p.name).toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes((p.internalName || p.name).toLowerCase())
      );

      updates.push({
        listingId: match?.id ?? 0,
        propertyName: name,
        bedroomTier: isNaN(tier) ? null : Math.min(5, Math.max(1, tier)),
        distanceFromStorage: distance || null,
        cleaningFeeCharge: fee || null,
        matched: !!match,
      });
    }

    return updates;
  }, [bulkData, properties]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setBulkData(text);
    };
    reader.readAsText(file);
  };

  const executeBulkImport = () => {
    const parsed = parseBulkData();
    const matched = parsed.filter((p) => p.matched && p.listingId > 0);
    if (matched.length === 0) {
      toast.error("No properties matched. Check the property names in your data.");
      return;
    }
    bulkUpdateMutation.mutate({
      updates: matched.map((p) => ({
        listingId: p.listingId,
        bedroomTier: p.bedroomTier,
        distanceFromStorage: p.distanceFromStorage,
        cleaningFeeCharge: p.cleaningFeeCharge,
      })),
    });
  };

  // Stats
  const configured = properties?.filter((p) => p.bedroomTier !== null).length ?? 0;
  const total = properties?.length ?? 0;

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Properties</p>
          <p className="text-2xl font-bold">{total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Configured</p>
          <p className="text-2xl font-bold text-emerald-600">{configured}</p>
          <p className="text-xs text-muted-foreground">{total > 0 ? Math.round((configured / total) * 100) : 0}% complete</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Needs Setup</p>
          <p className="text-2xl font-bold text-amber-600">{total - configured}</p>
        </Card>
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search properties..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {/* POD filter */}
        <Select value={podFilter} onValueChange={setPodFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All PODs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All PODs</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {(podList ?? []).map((pod) => (
              <SelectItem key={pod.id} value={pod.id.toString()}>
                {pod.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Auto-assign button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAutoAssign(true)}
        >
          <Hexagon className="h-4 w-4 mr-1" />
          Auto-Assign PODs
        </Button>
        <Dialog open={showBulkImport} onOpenChange={setShowBulkImport}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4 mr-1" />
              Bulk Import
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk Import Property Data</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Paste CSV or tab-separated data. Format: <code>Property Name, Bedroom Tier (1-5), Distance (miles), Cleaning Fee ($)</code>
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />
                  Upload CSV
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
              <textarea
                className="w-full h-48 p-3 text-sm font-mono border rounded-md bg-muted/30"
                placeholder={`Mountain Cabin, 3, 12.5, 250\nBeach House, 4, 8.2, 350\nStudio Apt, 1, 2.0, 125`}
                value={bulkData}
                onChange={(e) => setBulkData(e.target.value)}
              />
              {bulkData && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Preview ({parseBulkData().length} rows):</p>
                  <div className="max-h-48 overflow-auto border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Property</TableHead>
                          <TableHead className="text-xs">Tier</TableHead>
                          <TableHead className="text-xs">Distance</TableHead>
                          <TableHead className="text-xs">Fee</TableHead>
                          <TableHead className="text-xs">Match</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parseBulkData().map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{row.propertyName}</TableCell>
                            <TableCell className="text-xs">{row.bedroomTier ?? "—"}</TableCell>
                            <TableCell className="text-xs">{row.distanceFromStorage ?? "—"}</TableCell>
                            <TableCell className="text-xs">{row.cleaningFeeCharge ? `$${row.cleaningFeeCharge}` : "—"}</TableCell>
                            <TableCell className="text-xs">
                              {row.matched ? (
                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-[10px]">
                                  <Check className="h-3 w-3 mr-0.5" /> Matched
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-red-50 text-red-700 text-[10px]">
                                  <X className="h-3 w-3 mr-0.5" /> No match
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={executeBulkImport}
                disabled={bulkUpdateMutation.isPending || !bulkData}
              >
                {bulkUpdateMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-1" />
                )}
                Import {parseBulkData().filter((p) => p.matched).length} Properties
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Properties table */}
      <Card>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Property</TableHead>
                <TableHead className="text-xs">Location</TableHead>
                <TableHead className="text-xs">POD</TableHead>
                <TableHead className="text-xs text-center">Bedroom Tier</TableHead>
                <TableHead className="text-xs text-center">Distance (mi)</TableHead>
                <TableHead className="text-xs text-center">Cleaning Fee</TableHead>
                <TableHead className="text-xs text-center w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium max-w-[250px] truncate">
                    {p.internalName || p.name}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    {p.podId ? (
                      <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                        {(podList ?? []).find(pod => pod.id === p.podId)?.name ?? `Pod ${p.podId}`}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {editingId === p.id ? (
                      <Select
                        value={editValues.bedroomTier?.toString() ?? "none"}
                        onValueChange={(v) =>
                          setEditValues((prev) => ({
                            ...prev,
                            bedroomTier: v === "none" ? null : parseInt(v),
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs w-28 mx-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not set</SelectItem>
                          {[1, 2, 3, 4, 5].map((t) => (
                            <SelectItem key={t} value={t.toString()}>
                              {BEDROOM_TIER_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs">
                        {p.bedroomTier ? (
                          <Badge variant="outline" className="text-[10px]">
                            {BEDROOM_TIER_LABELS[p.bedroomTier] ?? `Tier ${p.bedroomTier}`}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {editingId === p.id ? (
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        className="h-8 text-xs w-20 mx-auto text-center"
                        value={editValues.distanceFromStorage}
                        onChange={(e) =>
                          setEditValues((prev) => ({
                            ...prev,
                            distanceFromStorage: e.target.value,
                          }))
                        }
                        placeholder="0.0"
                      />
                    ) : (
                      <span className="text-xs">
                        {p.distanceFromStorage ? `${p.distanceFromStorage} mi` : <span className="text-muted-foreground">—</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {editingId === p.id ? (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-8 text-xs w-24 mx-auto text-center"
                        value={editValues.cleaningFeeCharge}
                        onChange={(e) =>
                          setEditValues((prev) => ({
                            ...prev,
                            cleaningFeeCharge: e.target.value,
                          }))
                        }
                        placeholder="0.00"
                      />
                    ) : (
                      <span className="text-xs">
                        {p.cleaningFeeCharge ? `$${Number(p.cleaningFeeCharge).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {editingId === p.id ? (
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEdit}>
                          <Save className="h-3.5 w-3.5 text-emerald-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(p)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                    {search || podFilter !== "all" ? "No properties match your filters." : "No properties found. Sync from Hostaway first."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Auto-Assign PODs Dialog */}
      <AutoAssignPodsDialog
        open={showAutoAssign}
        onClose={() => setShowAutoAssign(false)}
        onAssigned={() => { refetch(); setShowAutoAssign(false); }}
        podList={podList ?? []}
      />
    </div>
  );
}

// ── Cleaners Management Tab ─────────────────────────────────────────

function CleanersManagementTab() {
  const { data: allCleaners, isLoading, refetch } = trpc.compensation.cleaners.list.useQuery();
  const { data: podList } = trpc.pods.list.useQuery();
  const createMutation = trpc.compensation.cleaners.create.useMutation({
    onSuccess: () => {
      toast.success("Cleaner added");
      refetch();
      setShowAdd(false);
      setNewCleaner({ name: "", email: "", quickbooksEmployeeId: "" });
    },
    onError: (err) => toast.error(err.message),
  });
  const updateMutation = trpc.compensation.cleaners.update.useMutation({
    onSuccess: () => {
      toast.success("Cleaner updated");
      refetch();
      setEditingId(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const setCleanerPodsMutation = trpc.compensation.cleanerPods.set.useMutation({
    onError: (err) => toast.error(`POD assignment failed: ${err.message}`),
  });
  const { data: allCleanerPodAssignments, refetch: refetchPodAssignments } = trpc.compensation.cleanerPods.getAll.useQuery();
  const recalcMutation = trpc.compensation.cleaners.recalculateScores.useMutation({
    onSuccess: (result) => {
      toast.success(`Recalculated: ${result.updated}/${result.processed} cleaners`);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const scoreDiagnosticQuery = trpc.compensation.cleaners.scoreDiagnostic.useQuery(undefined, {
    enabled: false, // fetch only on demand
  });
  const runDiagnostic = async () => {
    const { data, error } = await scoreDiagnosticQuery.refetch();
    if (error) {
      toast.error(`Diagnostic failed: ${error.message}`);
      return;
    }
    if (!data) return;
    // Build a readable summary
    const bw = data.breezewaySync;
    const lcs = data.lastCleanSync;
    const running = (data as any).cleanSyncInProgress;
    const lines = [
      `🩺 ${data.diagnosis}`,
      ``,
      `Breezeway sync: enabled=${bw.enabled} · lastPollAt (task poller)=${bw.lastPollAt ?? "never"}`,
      `  Properties: ${bw.totalProperties} total (${bw.propsWithReferenceId} w/ refId, ${bw.propsHomeIdOnly} home_id-only)`,
      `  breezewayTeam rows: ${bw.breezewayTeamRows} · cleansSync cutoff: ${bw.cleansSyncCutoff}`,
      ``,
      running
        ? `⏳ CleanSync is CURRENTLY RUNNING in the background — re-run diagnostic in 30-60s.`
        : lcs
        ? `Last CleanSync run: ${lcs.finishedAt ?? "in-progress"} · queried ${lcs.propertiesQueried ?? "?"} props`
        : `Last CleanSync run: never since boot (click Sync Cleans or wait for cron)`,
      lcs
        ? `  total fetched: ${lcs.total} · created: ${lcs.created} · skipped: ${lcs.skipped} · errors: ${lcs.errors}`
        : ``,
      lcs
        ? `  skip breakdown: dupe=${lcs.skippedDupe ?? 0} · no-cleaner=${lcs.skippedNoCleaner ?? 0} · no-listing=${(lcs as any).skippedNoListing ?? 0} · old-date=${lcs.skippedOldDate ?? 0}`
        : ``,
      ``,
      `Cleaners: ${data.cleaners.total} active · ${data.cleaners.withBreezewayTeamId} linked to breezewayTeam · ${data.cleaners.withNonNullScore} w/ score · ${data.cleaners.withScoreCalculated} calculated`,
      `Completed cleans (45d): ${data.completedCleans.last45Days} total · ${data.completedCleans.withCleanerId} w/ cleanerId · ${data.completedCleans.withListingId} w/ listingId · ${data.completedCleans.fullyMatched} fully matched`,
      `Latest clean: ${data.completedCleans.latestCleanDate ?? "none"}${data.completedCleans.daysSinceLatest != null ? ` (${data.completedCleans.daysSinceLatest}d ago)` : ""}`,
      `Reviews (30d): ${data.reviews.last30Days} total · Airbnb w/ cleanliness sub-score: ${data.reviews.airbnbWithCleanlinessSubScore} · AI-analyzed: ${data.reviews.analyzedByAI}`,
      `  By source: airbnb=${data.reviews.bySource.airbnb} vrbo=${data.reviews.bySource.vrbo} booking=${data.reviews.bySource.booking} direct=${data.reviews.bySource.direct}`,
      ``,
      `Top cleaners by clean count:`,
      ...data.perCleaner.slice(0, 8).map((c) => `  ${c.name}: ${c.cleansLast45Days} cleans · ${c.matchableReviewsLast30Days} matchable reviews · score=${c.currentScore ?? "null"}`),
    ].filter((l) => l !== "");
    const summary = lines.join("\n");
    // Log the full payload to console for deeper inspection
    console.log("[ScoreDiagnostic]", data);
    toast.message("Cleaner Score Diagnostic", {
      description: summary,
      duration: 60000,
    });
  };
  const sendReportsMutation = trpc.compensation.sendWeeklyReports.useMutation({
    onSuccess: (result) => {
      toast.success(`Sent ${result.sent} reports (${result.skipped} skipped, ${result.failed} failed)`);
    },
    onError: (err) => toast.error(err.message),
  });
  const generateTokensMutation = trpc.cleanerDashboard.generateTokens.useMutation({
    onSuccess: (result) => {
      toast.success(`Generated ${result.generated} dashboard links`);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const logCleanMutation = trpc.compensation.logClean.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.isPaired
          ? `Paired clean logged (50/50 split) for week of ${result.weekOf}`
          : `Clean logged for week of ${result.weekOf}`
      );
      setShowLogClean(false);
      setLogCleanForm(defaultLogCleanForm);
    },
    onError: (err) => toast.error(err.message),
  });

  const syncCleansMutation = trpc.compensation.syncCleans.useMutation({
    onSuccess: (result: any) => {
      console.log("[SyncCleans] started", result);
      const lines = [
        result.alreadyRunning
          ? "⏳ Already running in the background"
          : "🚀 Started in the background",
        result.message ?? "",
        "",
        "Click Diagnose Scores in 30-60 seconds to see the result.",
      ]
        .filter(Boolean)
        .join("\n");
      toast.message("Sync Cleans", {
        description: lines,
        duration: 30000,
      });
    },
    onError: (err) => toast.error(`Sync failed: ${err.message}`, { duration: 30000 }),
  });

  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: allReceipts } = trpc.cleanerDashboard.listReceipts.useQuery({ month: currentMonth });

  const defaultLogCleanForm = {
    cleanerId: "",
    pairedCleanerId: "",
    propertyName: "",
    cleaningFee: "",
    distanceMiles: "",
    scheduledDate: new Date().toISOString().slice(0, 10),
  };

  const [showAdd, setShowAdd] = useState(false);
  const [showLogClean, setShowLogClean] = useState(false);
  const [logCleanForm, setLogCleanForm] = useState(defaultLogCleanForm);
  const [newCleaner, setNewCleaner] = useState({ name: "", email: "", quickbooksEmployeeId: "" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ name: "", email: "", quickbooksEmployeeId: "", podId: null as number | null, podIds: [] as number[] });
  const [podFilter, setPodFilter] = useState<number | null>(null);
  const [selectedCleanerId, setSelectedCleanerId] = useState<number | null>(null);
  const [detailDaysBack, setDetailDaysBack] = useState(30);

  const startEdit = (c: NonNullable<typeof allCleaners>[0]) => {
    setEditingId(c.id);
    const assignedPodIds = allCleanerPodAssignments ? (allCleanerPodAssignments[String(c.id)] ?? []) : [];
    setEditValues({
      name: c.name,
      email: c.email ?? "",
      quickbooksEmployeeId: c.quickbooksEmployeeId ?? "",
      podId: c.podId ?? null,
      podIds: assignedPodIds,
    });
  };

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage cleaners, view rolling scores, and trigger recalculations.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendReportsMutation.mutate()}
            disabled={sendReportsMutation.isPending}
          >
            {sendReportsMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1" />
            )}
            Send Reports
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateTokensMutation.mutate()}
            disabled={generateTokensMutation.isPending}
          >
            {generateTokensMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 mr-1" />
            )}
            Generate Links
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
          >
            {recalcMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Recalculate All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runDiagnostic}
            disabled={scoreDiagnosticQuery.isFetching}
          >
            {scoreDiagnosticQuery.isFetching ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Diagnose Scores
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncCleansMutation.mutate()}
            disabled={syncCleansMutation.isPending}
          >
            {syncCleansMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Sync Cleans
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowLogClean(true)}>
            <ClipboardList className="h-4 w-4 mr-1" />
            Log Clean
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Cleaner
          </Button>
        </div>
      </div>

      {/* Add cleaner dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Cleaner</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Name *</label>
              <Input
                value={newCleaner.name}
                onChange={(e) => setNewCleaner((p) => ({ ...p, name: e.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Email</label>
              <Input
                type="email"
                value={newCleaner.email}
                onChange={(e) => setNewCleaner((p) => ({ ...p, email: e.target.value }))}
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-medium">QuickBooks Employee ID</label>
              <Input
                value={newCleaner.quickbooksEmployeeId}
                onChange={(e) => setNewCleaner((p) => ({ ...p, quickbooksEmployeeId: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => createMutation.mutate({
                name: newCleaner.name,
                email: newCleaner.email || undefined,
                quickbooksEmployeeId: newCleaner.quickbooksEmployeeId || undefined,
              })}
              disabled={!newCleaner.name || createMutation.isPending}
            >
              Add Cleaner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Clean dialog */}
      <Dialog open={showLogClean} onOpenChange={setShowLogClean}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Completed Clean</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Primary Cleaner *</label>
              <Select
                value={logCleanForm.cleanerId}
                onValueChange={(v) => setLogCleanForm((p) => ({ ...p, cleanerId: v }))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select cleaner..." />
                </SelectTrigger>
                <SelectContent>
                  {allCleaners?.filter((c) => c.active).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Paired Cleaner (optional — splits 50/50)</label>
              <Select
                value={logCleanForm.pairedCleanerId || "none"}
                onValueChange={(v) => setLogCleanForm((p) => ({ ...p, pairedCleanerId: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Solo clean (no partner)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Solo clean (no partner)</SelectItem>
                  {allCleaners?.filter((c) => c.active && String(c.id) !== logCleanForm.cleanerId).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {logCleanForm.pairedCleanerId && (
                <p className="text-[10px] text-amber-600 mt-1">
                  Paired: base pay, volume credit, and quality score split 50/50 between both cleaners. Mileage paid to each independently.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium">Property Name *</label>
              <Input
                value={logCleanForm.propertyName}
                onChange={(e) => setLogCleanForm((p) => ({ ...p, propertyName: e.target.value }))}
                placeholder="e.g. 123 Ocean Drive"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Cleaning Fee ($) *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={logCleanForm.cleaningFee}
                  onChange={(e) => setLogCleanForm((p) => ({ ...p, cleaningFee: e.target.value }))}
                  placeholder="0.00"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Distance (one-way mi)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={logCleanForm.distanceMiles}
                  onChange={(e) => setLogCleanForm((p) => ({ ...p, distanceMiles: e.target.value }))}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Scheduled Date</label>
              <Input
                type="date"
                value={logCleanForm.scheduledDate}
                onChange={(e) => setLogCleanForm((p) => ({ ...p, scheduledDate: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                if (!logCleanForm.cleanerId || !logCleanForm.propertyName || !logCleanForm.cleaningFee) {
                  toast.error("Please fill in required fields");
                  return;
                }
                logCleanMutation.mutate({
                  cleanerId: Number(logCleanForm.cleanerId),
                  pairedCleanerId: logCleanForm.pairedCleanerId ? Number(logCleanForm.pairedCleanerId) : null,
                  propertyName: logCleanForm.propertyName,
                  cleaningFee: Number(logCleanForm.cleaningFee),
                  distanceMiles: Number(logCleanForm.distanceMiles) || 0,
                  scheduledDate: logCleanForm.scheduledDate || undefined,
                });
              }}
              disabled={logCleanMutation.isPending}
            >
              {logCleanMutation.isPending ? "Logging..." : "Log Clean"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* POD filter */}
      {podList && podList.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Filter by POD:</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setPodFilter(null)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                podFilter === null
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-muted-foreground border-border hover:border-indigo-400"
              }`}
            >
              All
            </button>
            {podList.map((pod) => (
              <button
                key={pod.id}
                onClick={() => setPodFilter(podFilter === pod.id ? null : pod.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  podFilter === pod.id
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-muted-foreground border-border hover:border-indigo-400"
                }`}
              >
                {pod.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cleaners grid */}
      {(!allCleaners || allCleaners.length === 0) ? (
        <Card className="p-12 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">
            No cleaners added yet. Add cleaners to start tracking compensation scores.
          </p>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add First Cleaner
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allCleaners.filter((c) => {
            if (podFilter === null) return true;
            const assignedPodIds = allCleanerPodAssignments?.[String(c.id)] ?? (c.podId ? [c.podId] : []);
            return assignedPodIds.includes(podFilter);
          }).map((c) => {
            const score = c.currentRollingScore ? Number(c.currentRollingScore) : null;
            const mult = c.currentMultiplier ? Number(c.currentMultiplier) : 1.0;

            return (
              <Card
                key={c.id}
                className="p-5 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => { if (editingId !== c.id) setSelectedCleanerId(c.id); }}
              >
                {editingId === c.id ? (
                  <div className="space-y-3">
                    <Input
                      value={editValues.name}
                      onChange={(e) => setEditValues((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Name"
                    />
                    <Input
                      type="email"
                      value={editValues.email}
                      onChange={(e) => setEditValues((p) => ({ ...p, email: e.target.value }))}
                      placeholder="Email"
                    />
                    <Input
                      value={editValues.quickbooksEmployeeId}
                      onChange={(e) => setEditValues((p) => ({ ...p, quickbooksEmployeeId: e.target.value }))}
                      placeholder="QB Employee ID"
                    />
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">PODs (multi-select)</label>
                      <div className="flex flex-col gap-1 rounded border p-2 bg-muted/30">
                        {podList?.length === 0 && <span className="text-xs text-muted-foreground">No PODs available</span>}
                        {podList?.map((pod) => (
                          <label key={pod.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                            <input
                              type="checkbox"
                              className="accent-indigo-600"
                              checked={editValues.podIds.includes(pod.id)}
                              onChange={(e) => {
                                setEditValues((p) => ({
                                  ...p,
                                  podIds: e.target.checked
                                    ? [...p.podIds, pod.id]
                                    : p.podIds.filter((id) => id !== pod.id),
                                }));
                              }}
                            />
                            {pod.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          await updateMutation.mutateAsync({
                            id: c.id,
                            name: editValues.name,
                            email: editValues.email || null,
                            quickbooksEmployeeId: editValues.quickbooksEmployeeId || null,
                            podId: editValues.podIds[0] ?? null,
                          });
                          await setCleanerPodsMutation.mutateAsync({ cleanerId: c.id, podIds: editValues.podIds });
                          refetchPodAssignments();
                        }}
                        disabled={updateMutation.isPending || setCleanerPodsMutation.isPending}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        Save
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold">{c.name}</h3>
                        {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                        {c.quickbooksEmployeeId && (
                          <p className="text-[10px] text-muted-foreground">QB: {c.quickbooksEmployeeId}</p>
                        )}
                        {(() => {
                          const assignedPodIds = allCleanerPodAssignments?.[String(c.id)] ?? (c.podId ? [c.podId] : []);
                          if (assignedPodIds.length === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {assignedPodIds.map((pid) => (
                                <span key={pid} className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5">
                                  <Hexagon className="h-2.5 w-2.5" />
                                  {podList?.find((p) => p.id === pid)?.name ?? `Pod #${pid}`}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); startEdit(c); }}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Score section */}
                    <div className="rounded-lg border bg-gradient-to-r from-slate-50 to-white p-3 mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                          30-Day Score
                        </span>
                        <MultiplierBadge multiplier={mult} hasScore={score !== null} />
                      </div>
                      {score !== null ? (
                        <>
                          <p className="text-2xl font-bold tabular-nums">
                            {score.toFixed(2)}
                            <Star className="inline h-4 w-4 ml-0.5 text-amber-500 fill-amber-500" />
                          </p>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1 mb-1">
                            <div
                              className={`h-full rounded-full ${
                                score >= 4.93
                                  ? "bg-emerald-500"
                                  : score >= 4.85
                                  ? "bg-blue-500"
                                  : "bg-amber-500"
                              }`}
                              style={{ width: `${Math.min((score / 5) * 100, 100)}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No score yet</p>
                      )}
                      {c.nextTier && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          <ArrowUpRight className="inline h-3 w-3" /> {c.nextTier.label}
                        </p>
                      )}
                    </div>

                    {/* Receipt status for current month */}
                    {(() => {
                      const cleanerReceipts = allReceipts?.filter((r) => r.cleanerId === c.id) ?? [];
                      const hasPhone = cleanerReceipts.some((r) => r.type === "cell_phone");
                      const hasVehicle = cleanerReceipts.some((r) => r.type === "vehicle_maintenance");
                      if (hasPhone || hasVehicle) {
                        return (
                          <div className="flex items-center gap-1.5 mt-2 mb-1">
                            <span className="text-[10px] text-muted-foreground">Receipts:</span>
                            {hasPhone && (
                              <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                <Phone className="h-2.5 w-2.5 mr-0.5" /> Phone
                              </Badge>
                            )}
                            {hasVehicle && (
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                                <Wrench className="h-2.5 w-2.5 mr-0.5" /> Vehicle
                              </Badge>
                            )}
                          </div>
                        );
                      }
                      return (
                        <p className="text-[10px] text-orange-500 mt-2 mb-1">No receipts submitted this month</p>
                      );
                    })()}

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {c.active ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-[10px]">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-500 text-[10px]">Inactive</Badge>
                        )}
                        {c.scoreLastCalculatedAt && (
                          <span>Updated {new Date(c.scoreLastCalculatedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                      {(c as any).dashboardToken && (
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/cleaner/${(c as any).dashboardToken}`;
                            navigator.clipboard.writeText(url);
                            toast.success("Dashboard link copied!");
                          }}
                          className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 transition-colors"
                          title="Copy cleaner dashboard link"
                        >
                          <Copy className="h-3 w-3" />
                          Copy Link
                        </button>
                      )}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Score Detail Sheet */}
      <CleanerScoreDetail
        cleanerId={selectedCleanerId}
        daysBack={detailDaysBack}
        onDaysBackChange={setDetailDaysBack}
        onClose={() => setSelectedCleanerId(null)}
      />
    </div>
  );
}

// ── Cleaner Score Detail Sheet ──────────────────────────────────────

function CleanerScoreDetail({
  cleanerId,
  daysBack,
  onDaysBackChange,
  onClose,
}: {
  cleanerId: number | null;
  daysBack: number;
  onDaysBackChange: (d: number) => void;
  onClose: () => void;
}) {
  const { data, isLoading } = trpc.compensation.cleaners.scoreDetail.useQuery(
    { cleanerId: cleanerId!, daysBack },
    { enabled: !!cleanerId }
  );

  const SOURCE_COLORS: Record<string, string> = {
    airbnb: "bg-rose-50 text-rose-700 border-rose-200",
    vrbo: "bg-blue-50 text-blue-700 border-blue-200",
    booking: "bg-indigo-50 text-indigo-700 border-indigo-200",
    direct: "bg-gray-50 text-gray-700 border-gray-200",
  };

  const SCORE_COLORS = (s: number) =>
    s >= 5 ? "text-emerald-700 bg-emerald-50" :
    s >= 4 ? "text-blue-700 bg-blue-50" :
    s >= 3 ? "text-amber-700 bg-amber-50" :
    "text-red-700 bg-red-50";

  return (
    <Sheet open={!!cleanerId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {data?.cleaner.name ?? "Cleaner Detail"}
          </SheetTitle>
          {data?.cleaner.email && (
            <p className="text-sm text-muted-foreground">{data.cleaner.email}</p>
          )}
        </SheetHeader>

        {/* Date range filter */}
        <div className="flex items-center gap-2 mt-4 mb-4">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Date range:</span>
          <div className="flex gap-1">
            {[30, 60, 90, 180, 365].map((d) => (
              <Button
                key={d}
                variant={daysBack === d ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => onDaysBackChange(d)}
              >
                {d <= 90 ? `${d}d` : d === 180 ? "6mo" : "1yr"}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3 mt-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-40" />
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground mt-4">No data available</p>
        ) : (
          <div className="space-y-4 mt-2">
            {/* Score summary */}
            <div className="rounded-lg border bg-gradient-to-r from-slate-50 to-white p-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">
                    {data.avgScore !== null ? (
                      <>
                        {data.avgScore.toFixed(2)}
                        <Star className="inline h-4 w-4 ml-0.5 text-amber-500 fill-amber-500" />
                      </>
                    ) : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase">Avg Score</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.reviewCount}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Reviews</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{data.scorableCleans}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Scorable Cleans</p>
                </div>
              </div>
            </div>

            {/* Per-property breakdown */}
            {data.byProperty.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  By Property
                </h4>
                <div className="space-y-1">
                  {data.byProperty.map((p) => (
                    <div key={p.name} className="flex items-center justify-between text-sm rounded-md px-3 py-1.5 bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Home className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate max-w-[240px]">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{p.count} review{p.count !== 1 ? "s" : ""}</span>
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${SCORE_COLORS(p.avg)}`}>
                          {p.avg.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Individual reviews */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Reviews ({data.reviews.length})
              </h4>
              {data.reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No reviews matched to cleans in this period</p>
              ) : (
                <div className="space-y-2">
                  {data.reviews.map((r) => (
                    <div key={r.reviewId} className="rounded-lg border p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-[10px] ${SOURCE_COLORS[r.source] || SOURCE_COLORS.direct}`}>
                            {r.source}
                          </Badge>
                          <span className="text-xs text-muted-foreground truncate max-w-[160px]">{r.listingName}</span>
                        </div>
                        <span className={`text-sm font-bold px-2 py-0.5 rounded ${SCORE_COLORS(r.scoreUsed)}`}>
                          {r.scoreUsed.toFixed(1)}
                        </span>
                      </div>

                      {/* Ratings row */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {r.cleanlinessRating !== null && (
                          <span>Cleanliness: <strong>{r.cleanlinessRating}</strong>/5</span>
                        )}
                        {r.rating !== null && (
                          <span>Overall: <strong>{r.rating}</strong></span>
                        )}
                        <span className="text-[10px] italic">{r.scoreReason}</span>
                      </div>

                      {/* Dates */}
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        {r.arrivalDate && <span>Guest arrival: {r.arrivalDate}</span>}
                        {r.submittedAt && <span>Reviewed: {r.submittedAt}</span>}
                        {r.matchedCleanDate && (
                          <span className="text-indigo-600">
                            Matched clean: {r.matchedCleanDate}
                          </span>
                        )}
                      </div>

                      {/* Public review */}
                      {r.publicReview && (
                        <div className="mt-1.5 rounded-md bg-slate-50 p-2.5">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Public Review</p>
                          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
                            <HighlightCleaning text={r.publicReview} />
                          </p>
                        </div>
                      )}

                      {/* Private feedback */}
                      {r.privateFeedback && (
                        <div className="mt-1.5 rounded-md bg-amber-50/50 border border-amber-100 p-2.5">
                          <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide mb-1">Private Feedback</p>
                          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
                            <HighlightCleaning text={r.privateFeedback} />
                          </p>
                        </div>
                      )}

                      {r.guestName && (
                        <p className="text-[10px] text-muted-foreground mt-1">— {r.guestName}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Highlight Cleaning Keywords ─────────────────────────────────────

const CLEANING_KEYWORDS = /\b(clean|cleaning|cleanliness|spotless|dirty|dust|dusty|stain|stains|stained|mop|mopped|sweep|swept|vacuum|vacuumed|scrub|scrubbed|sanitize|sanitized|hygiene|hygienic|tidy|untidy|messy|immaculate|pristine|filthy|grime|grimy|wipe|wiped|disinfect|sparkling|housekeeping|housekeeper|towel|towels|linen|linens|sheet|sheets|bathroom|bathrooms|kitchen|floor|floors|hair|hairs|trash|garbage|mold|mildew|cobweb|cobwebs|smudge|smudges|streak|streaks)\b/gi;

function HighlightCleaning({ text }: { text: string }) {
  const parts = text.split(CLEANING_KEYWORDS);
  return (
    <>
      {parts.map((part, i) =>
        CLEANING_KEYWORDS.test(part) ? (
          <strong key={i} className="text-gray-900 font-semibold">{part}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── Multiplier Badge ────────────────────────────────────────────────

function MultiplierBadge({ multiplier, hasScore }: { multiplier: number; hasScore: boolean }) {
  let color = "bg-gray-100 text-gray-700 border-gray-200";
  let label = `${multiplier}x`;
  if (!hasScore) {
    color = "bg-gray-100 text-gray-500 border-gray-200";
    label = "Pending";
  } else if (multiplier >= 1.5) {
    color = "bg-emerald-50 text-emerald-700 border-emerald-200";
    label = "1.5x Platinum";
  } else if (multiplier >= 1.2) {
    color = "bg-blue-50 text-blue-700 border-blue-200";
    label = "1.2x Gold";
  } else {
    color = "bg-amber-50 text-amber-700 border-amber-200";
    label = "0.8x Below";
  }
  return (
    <Badge variant="outline" className={`${color} text-[10px] font-semibold px-2 py-0.5`}>
      {label}
    </Badge>
  );
}

// ── Pay Calculator Tab ──────────────────────────────────────────────

function PayCalculatorTab() {
  const { data: tiers } = trpc.compensation.tiers.useQuery();
  const [bedroomTier, setBedroomTier] = useState(3);
  const [multiplier, setMultiplier] = useState("1.2");
  const [distance, setDistance] = useState(10);
  const [isThirdHouse, setIsThirdHouse] = useState(false);

  const multNum = parseFloat(multiplier);
  const { data: estimate } = trpc.compensation.estimateClean.useQuery(
    { bedroomTier, multiplier: multNum, distanceFromStorage: distance, isThirdHouseOrMore: isThirdHouse },
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Estimate cleaner compensation for a single clean based on the tiered hybrid pay model.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <Card className="p-5 space-y-4">
          <h3 className="font-semibold">Clean Parameters</h3>
          <div>
            <label className="text-xs font-medium">Bedroom Tier</label>
            <Select value={bedroomTier.toString()} onValueChange={(v) => setBedroomTier(parseInt(v))}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((t) => (
                  <SelectItem key={t} value={t.toString()}>
                    {BEDROOM_TIER_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Score Multiplier</label>
            <Select value={multiplier} onValueChange={setMultiplier}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1.5">1.5x — Max Reward (5.0 score)</SelectItem>
                <SelectItem value="1.2">1.2x — Standard (4.85+ score)</SelectItem>
                <SelectItem value="0.8">0.8x — Below Target (below 4.85)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Distance from Storage (one-way miles)</label>
            <Input
              type="number"
              step="0.5"
              min="0"
              value={distance}
              onChange={(e) => setDistance(parseFloat(e.target.value) || 0)}
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="thirdHouse"
              checked={isThirdHouse}
              onChange={(e) => setIsThirdHouse(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="thirdHouse" className="text-xs">3rd+ house of the day (flat $5 mileage)</label>
          </div>
        </Card>

        {/* Estimate result */}
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Estimated Compensation</h3>
          {estimate ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm text-muted-foreground">Base Hourly Pay</span>
                <span className="text-sm font-medium">
                  ${estimate.baseHourly.toFixed(2)}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({estimate.breakdown.expectedHours}h × ${estimate.breakdown.hourlyRate}/h)
                  </span>
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm text-muted-foreground">Quality Bonus</span>
                <span className="text-sm font-medium">
                  ${estimate.adjustedBonus.toFixed(2)}
                  <span className="text-xs text-muted-foreground ml-1">
                    (${estimate.baseBonus} × {estimate.breakdown.multiplier}x)
                  </span>
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  <Fuel className="inline h-3.5 w-3.5 mr-1" />
                  Mileage
                </span>
                <span className="text-sm font-medium">
                  ${estimate.mileage.toFixed(2)}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({isThirdHouse ? "flat $5" : `${distance * 2} mi \u00d7 $0.725`})
                  </span>
                </span>
              </div>
              {estimate.dockPenalty > 0 && (
                <div className="flex justify-between items-center py-2 border-b text-red-600">
                  <span className="text-sm">Docking Penalty</span>
                  <span className="text-sm font-medium">-${estimate.dockPenalty.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-3 bg-muted/50 rounded-lg px-3 mt-2">
                <span className="font-semibold">Total Estimate</span>
                <span className="text-xl font-bold text-emerald-600">
                  ${estimate.totalEstimate.toFixed(2)}
                </span>
              </div>
            </div>
          ) : (
            <Skeleton className="h-48" />
          )}
        </Card>
      </div>

      {/* Tier reference table */}
      {tiers && (
        <Card className="p-5">
          <h3 className="font-semibold mb-3">Bedroom Tier Reference</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Tier</TableHead>
                <TableHead className="text-xs">Expected Hours</TableHead>
                <TableHead className="text-xs">Base Hourly Pay</TableHead>
                <TableHead className="text-xs">Base Bonus</TableHead>
                <TableHead className="text-xs">Max Bonus (1.5x)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((t) => (
                <TableRow key={t.tier}>
                  <TableCell className="text-sm font-medium">{t.label}</TableCell>
                  <TableCell className="text-sm">{t.expectedHours}h</TableCell>
                  <TableCell className="text-sm">${t.baseHourlyPay.toFixed(2)}</TableCell>
                  <TableCell className="text-sm">${t.baseBonus}</TableCell>
                  <TableCell className="text-sm font-medium text-emerald-600">
                    ${(t.baseBonus * 1.5).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Multiplier reference + Scenario Controls */}
      <ScenarioControls />
    </div>
  );
}

// ── Scenario Controls (configurable multiplier tiers) ───────────────

function ScenarioControls() {
  // Quality multiplier tiers
  const [tiers, setTiers] = useState([
    { minScore: 4.93, multiplier: 1.5, label: "Platinum" },
    { minScore: 4.85, multiplier: 1.2, label: "Gold" },
    { minScore: 0, multiplier: 0.8, label: "Below Target" },
  ]);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(tiers);

  // Volume multiplier tiers
  const [volumeTiers, setVolumeTiers] = useState([
    { minRevenue: 3000, multiplier: 1.2, label: "Gold", qualityGate: 4.85 },
    { minRevenue: 2200, multiplier: 1.1, label: "Silver", qualityGate: 4.85 },
    { minRevenue: 0, multiplier: 1.0, label: "Standard", qualityGate: 0 },
  ]);
  const [isEditingVolume, setIsEditingVolume] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState(volumeTiers);

  const tierColors = [
    "bg-emerald-50 border-emerald-200 text-emerald-700",
    "bg-blue-50 border-blue-200 text-blue-700",
    "bg-amber-50 border-amber-200 text-amber-700",
  ];

  function handleSave() {
    setTiers(draft);
    setIsEditing(false);
  }

  function handleReset() {
    const defaults = [
      { minScore: 4.93, multiplier: 1.5, label: "Platinum" },
      { minScore: 4.85, multiplier: 1.2, label: "Gold" },
      { minScore: 0, multiplier: 0.8, label: "Below Target" },
    ];
    setDraft(defaults);
    setTiers(defaults);
    setIsEditing(false);
  }

  function handleVolumeSave() {
    setVolumeTiers(volumeDraft);
    setIsEditingVolume(false);
  }

  function handleVolumeReset() {
    const defaults = [
      { minRevenue: 3000, multiplier: 1.2, label: "Gold", qualityGate: 4.85 },
      { minRevenue: 2200, multiplier: 1.1, label: "Silver", qualityGate: 4.85 },
      { minRevenue: 0, multiplier: 1.0, label: "Standard", qualityGate: 0 },
    ];
    setVolumeDraft(defaults);
    setVolumeTiers(defaults);
    setIsEditingVolume(false);
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">Score Multiplier Brackets</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Based on trailing 30-day average cleaning rating. Edit to run scenarios.
          </p>
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border"
              >
                Reset defaults
              </button>
              <button
                onClick={handleSave}
                className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded font-medium"
              >
                Save scenario
              </button>
            </>
          ) : (
            <button
              onClick={() => { setDraft(tiers); setIsEditing(true); }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border flex items-center gap-1"
            >
              <Edit2 className="h-3 w-3" /> Edit thresholds
            </button>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground italic">
            Changes are local only — use this to model scenarios before updating the real config.
          </p>
          {draft.map((tier, i) => (
            <div key={i} className={`rounded-lg border p-3 ${tierColors[i]}`}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium w-24">{tier.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Min score:</span>
                  {i === draft.length - 1 ? (
                    <span className="text-xs font-mono px-2 py-0.5 bg-white/60 rounded border">any</span>
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="5"
                      value={draft[i].minScore}
                      onChange={(e) => {
                        const updated = [...draft];
                        updated[i] = { ...updated[i], minScore: parseFloat(e.target.value) || 0 };
                        setDraft(updated);
                      }}
                      className="w-16 text-xs font-mono px-2 py-0.5 bg-white/80 rounded border text-center"
                    />
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Multiplier:</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="3"
                    value={draft[i].multiplier}
                    onChange={(e) => {
                      const updated = [...draft];
                      updated[i] = { ...updated[i], multiplier: parseFloat(e.target.value) || 0 };
                      setDraft(updated);
                    }}
                    className="w-16 text-xs font-mono px-2 py-0.5 bg-white/80 rounded border text-center"
                  />
                  <span className="text-xs font-bold">x</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {tiers.map((tier, i) => (
            <div key={i} className={`rounded-lg border p-3 text-center ${tierColors[i]}`}>
              <p className="text-lg font-bold">{tier.multiplier}x</p>
              <p className="text-xs font-medium">{tier.label}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {i === tiers.length - 1
                  ? `Below ${tiers[i - 1].minScore.toFixed(2)}`
                  : i === 0
                  ? `Score \u2265 ${tier.minScore.toFixed(2)}`
                  : `Score \u2265 ${tier.minScore.toFixed(2)}`}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="border-t my-5" />

      {/* Volume Multiplier Brackets */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">Volume Multiplier Brackets</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Based on weekly cleaning fee revenue. Requires quality gate. Dollar amounts hidden from cleaners.
          </p>
        </div>
        <div className="flex gap-2">
          {isEditingVolume ? (
            <>
              <button
                onClick={handleVolumeReset}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border"
              >
                Reset defaults
              </button>
              <button
                onClick={handleVolumeSave}
                className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded font-medium"
              >
                Save scenario
              </button>
            </>
          ) : (
            <button
              onClick={() => { setVolumeDraft(volumeTiers); setIsEditingVolume(true); }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border flex items-center gap-1"
            >
              <Edit2 className="h-3 w-3" /> Edit thresholds
            </button>
          )}
        </div>
      </div>

      {isEditingVolume ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground italic">
            Changes are local only \u2014 use this to model scenarios before updating the real config.
          </p>
          {volumeDraft.map((tier, i) => (
            <div key={i} className={`rounded-lg border p-3 ${tierColors[i]}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-medium w-20">{tier.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Min revenue:</span>
                  {i === volumeDraft.length - 1 ? (
                    <span className="text-xs font-mono px-2 py-0.5 bg-white/60 rounded border">any</span>
                  ) : (
                    <div className="flex items-center">
                      <span className="text-xs mr-0.5">$</span>
                      <input
                        type="number"
                        step="100"
                        min="0"
                        value={volumeDraft[i].minRevenue}
                        onChange={(e) => {
                          const updated = [...volumeDraft];
                          updated[i] = { ...updated[i], minRevenue: parseInt(e.target.value) || 0 };
                          setVolumeDraft(updated);
                        }}
                        className="w-20 text-xs font-mono px-2 py-0.5 bg-white/80 rounded border text-center"
                      />
                      <span className="text-xs text-muted-foreground ml-1">/wk</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Multiplier:</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="3"
                    value={volumeDraft[i].multiplier}
                    onChange={(e) => {
                      const updated = [...volumeDraft];
                      updated[i] = { ...updated[i], multiplier: parseFloat(e.target.value) || 0 };
                      setVolumeDraft(updated);
                    }}
                    className="w-16 text-xs font-mono px-2 py-0.5 bg-white/80 rounded border text-center"
                  />
                  <span className="text-xs font-bold">x</span>
                </div>
                {i < volumeDraft.length - 1 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Quality gate:</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="5"
                      value={volumeDraft[i].qualityGate}
                      onChange={(e) => {
                        const updated = [...volumeDraft];
                        updated[i] = { ...updated[i], qualityGate: parseFloat(e.target.value) || 0 };
                        setVolumeDraft(updated);
                      }}
                      className="w-16 text-xs font-mono px-2 py-0.5 bg-white/80 rounded border text-center"
                    />
                    <span className="text-xs text-muted-foreground">min score</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {volumeTiers.map((tier, i) => (
            <div key={i} className={`rounded-lg border p-3 text-center ${tierColors[i]}`}>
              <p className="text-lg font-bold">{tier.multiplier}x</p>
              <p className="text-xs font-medium">{tier.label}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {i === volumeTiers.length - 1
                  ? "Under threshold"
                  : `$${tier.minRevenue.toLocaleString()}+/wk`}
              </p>
              {tier.qualityGate > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  + score \u2265 {tier.qualityGate.toFixed(2)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Auto-Assign PODs Dialog ──────────────────────────────────────────

type PodItem = { id: number; name: string; propertyCount?: number };

function AutoAssignPodsDialog({
  open,
  onClose,
  onAssigned,
  podList,
}: {
  open: boolean;
  onClose: () => void;
  onAssigned: () => void;
  podList: PodItem[];
}) {
  const { data: preview, isLoading } = trpc.pods.previewAutoAssign.useQuery(undefined, {
    enabled: open,
  });
  const executeAutoAssign = trpc.pods.executeAutoAssign.useMutation({
    onSuccess: (result) => {
      toast.success(`Assigned ${result.assigned} properties to PODs`);
      if (result.unresolved.length > 0) {
        toast.error(`${result.unresolved.length} unresolved assignments`);
      }
      onAssigned();
    },
    onError: (err) => toast.error(err.message),
  });

  // Local overrides: listingId → podName
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  const suggestions = preview?.suggestions ?? [];
  const unassigned = suggestions.filter((s) => s.currentPodId === null);
  const highConf = unassigned.filter((s) => s.confidence === "high");
  const lowConf = unassigned.filter((s) => s.confidence === "low");
  const random = unassigned.filter((s) => s.confidence === "random");

  function getEffectivePodName(s: typeof suggestions[0]): string {
    return overrides[s.listingId] ?? s.suggestedPodName;
  }

  function handleApply() {
    const toAssign = unassigned.map((s) => ({
      listingId: s.listingId,
      podName: getEffectivePodName(s),
    }));
    executeAutoAssign.mutate({ assignments: toAssign });
  }

  const confidenceColor = {
    high: "text-emerald-600",
    low: "text-amber-600",
    random: "text-gray-500",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Auto-Assign Properties to PODs</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-lg border bg-slate-50 p-3 text-center">
                <p className="text-xl font-bold">{unassigned.length}</p>
                <p className="text-xs text-muted-foreground">To assign</p>
              </div>
              <div className="rounded-lg border bg-emerald-50 p-3 text-center">
                <p className="text-xl font-bold text-emerald-700">{highConf.length}</p>
                <p className="text-xs text-emerald-600">High confidence</p>
              </div>
              <div className="rounded-lg border bg-amber-50 p-3 text-center">
                <p className="text-xl font-bold text-amber-700">{lowConf.length}</p>
                <p className="text-xs text-amber-600">Review needed</p>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3 text-center">
                <p className="text-xl font-bold text-gray-500">{random.length}</p>
                <p className="text-xs text-gray-500">→ Random</p>
              </div>
            </div>

            {unassigned.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                All properties are already assigned to PODs.
              </p>
            ) : (
              <>
                {/* Low confidence — needs review */}
                {lowConf.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-amber-700">
                      ⚠ Review Needed ({lowConf.length})
                    </h4>
                    <div className="space-y-2">
                      {lowConf.map((s) => (
                        <div key={s.listingId} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{s.propertyName}</p>
                            <p className="text-[10px] text-muted-foreground">{[s.city, s.state].filter(Boolean).join(", ")} — {s.reason}</p>
                          </div>
                          <Select
                            value={getEffectivePodName(s)}
                            onValueChange={(v) => setOverrides((prev) => ({ ...prev, [s.listingId]: v }))}
                          >
                            <SelectTrigger className="w-[160px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {podList.map((pod) => (
                                <SelectItem key={pod.id} value={pod.name}>{pod.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* High confidence — just show a summary list */}
                {highConf.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-emerald-700">
                      ✓ High Confidence ({highConf.length})
                    </h4>
                    <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                      {highConf.map((s) => (
                        <div key={s.listingId} className="flex items-center justify-between px-3 py-1.5">
                          <span className="text-xs truncate flex-1">{s.propertyName}</span>
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 ml-2 shrink-0">
                            {getEffectivePodName(s)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Random */}
                {random.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-gray-500">
                      → Assigned to Random ({random.length})
                    </h4>
                    <div className="rounded-lg border divide-y max-h-32 overflow-y-auto">
                      {random.map((s) => (
                        <div key={s.listingId} className="flex items-center justify-between px-3 py-1.5">
                          <span className="text-xs truncate flex-1">{s.propertyName}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">{[s.city, s.state].filter(Boolean).join(", ")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </DialogClose>
          {unassigned.length > 0 && (
            <Button
              onClick={handleApply}
              disabled={executeAutoAssign.isPending}
            >
              {executeAutoAssign.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Assign {unassigned.length} Properties
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Cleans History Tab ──────────────────────────────────────────────────

function CleansHistoryTab() {
  const [weekInput, setWeekInput] = useState(""); // HTML week input: YYYY-Www
  const [cleanerIdFilter, setCleanerIdFilter] = useState<number | null>(null);
  const [fetchInput, setFetchInput] = useState<{
    weekOf?: string;
    cleanerId?: number;
  } | null>(null);

  const cleanersQuery = trpc.compensation.cleaners.list.useQuery();
  const cleaners = cleanersQuery.data ?? [];

  const cleansQuery = trpc.compensation.listCleans.useQuery(
    fetchInput ?? {},
    { enabled: fetchInput !== null }
  );
  const cleans = cleansQuery.data ?? [];

  const deleteCleanMutation = trpc.compensation.deleteClean.useMutation({
    onSuccess: () => {
      cleansQuery.refetch();
      toast.success("Clean record deleted");
    },
    onError: (e) => toast.error(`Delete failed: ${e.message}`),
  });

  // Convert YYYY-Www → YYYY-MM-DD (Monday of that ISO week)
  function weekInputToMonday(value: string): string | undefined {
    if (!value) return undefined;
    const [yearStr, weekStr] = value.split("-W");
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    if (isNaN(year) || isNaN(week)) return undefined;
    // Jan 4 is always in week 1
    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7; // make Sunday = 7
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - (jan4Day - 1) + (week - 1) * 7);
    return monday.toISOString().slice(0, 10);
  }

  function handleFetch() {
    const weekOf = weekInputToMonday(weekInput);
    setFetchInput({
      weekOf,
      cleanerId: cleanerIdFilter ?? undefined,
    });
  }

  const cleanerMap = new Map(cleaners.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4 mt-2">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Week</label>
          <input
            type="week"
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={weekInput}
            onChange={(e) => setWeekInput(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Cleaner</label>
          <Select
            value={cleanerIdFilter ? String(cleanerIdFilter) : "all"}
            onValueChange={(v) => setCleanerIdFilter(v === "all" ? null : Number(v))}
          >
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue placeholder="All cleaners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cleaners</SelectItem>
              {cleaners.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={handleFetch} disabled={cleansQuery.isFetching}>
          {cleansQuery.isFetching ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5 mr-1" />
          )}
          Fetch Cleans
        </Button>
      </div>

      {/* Results */}
      {fetchInput === null ? (
        <p className="text-sm text-muted-foreground">
          Select filters and click "Fetch Cleans" to view completed cleans.
        </p>
      ) : cleansQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : cleans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cleans found for the selected filters.
        </p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Property</TableHead>
                <TableHead className="text-xs">Cleaner</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Week Of</TableHead>
                <TableHead className="text-xs text-right">Fee</TableHead>
                <TableHead className="text-xs text-right">Distance</TableHead>
                <TableHead className="text-xs">Split</TableHead>
                <TableHead className="text-xs w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cleans.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs font-medium">
                    {c.propertyName ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {cleanerMap.get(c.cleanerId ?? 0) ?? `Cleaner #${c.cleanerId}`}
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.scheduledDate
                      ? new Date(c.scheduledDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.weekOf ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    ${(c.cleaningFee as number).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {(c.distanceMiles as number).toFixed(1)} mi
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.isPaired ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Paired 50%
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">Solo</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      disabled={deleteCleanMutation.isPending}
                      onClick={() => {
                        if (confirm("Delete this clean record?")) {
                          deleteCleanMutation.mutate({ id: c.id });
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {cleans.length} record{cleans.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Payroll Tab — QBO Payroll Elite weekly run management
// ─────────────────────────────────────────────────────────────────────

function PayrollTab() {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const runsQuery = trpc.payroll.list.useQuery({ limit: 20 });
  const runs = runsQuery.data ?? [];

  const utils = trpc.useUtils();

  const generateMutation = trpc.payroll.generate.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Payroll ${res.status === "replaced_draft" ? "regenerated" : "generated"}: ` +
          `${res.cleanerCount} cleaners, $${res.totalGrossPay.toFixed(2)} gross`
      );
      runsQuery.refetch();
      setSelectedRunId(res.runId);
    },
    onError: (e) => toast.error(`Generate failed: ${e.message}`),
  });

  const statusBadge = (status: string) => {
    if (status === "approved")
      return (
        <Badge variant="secondary" className="text-[10px]">
          Approved
        </Badge>
      );
    if (status === "submitted")
      return (
        <Badge className="text-[10px] bg-green-600 hover:bg-green-600">
          Submitted
        </Badge>
      );
    return (
      <Badge variant="outline" className="text-[10px]">
        Draft
      </Badge>
    );
  };

  return (
    <div className="space-y-4 mt-2">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Payroll Runs</h2>
          <p className="text-xs text-muted-foreground">
            Weekly runs auto-generate Wed 9 AM ET covering the prior Mon–Sun.
            Review, approve, and export the CSV for QuickBooks Payroll Elite.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5 mr-1" />
          )}
          Generate this week
        </Button>
      </div>

      {/* Runs list */}
      {runsQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : runs.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            No payroll runs yet. Click "Generate this week" to create the first
            draft.
          </p>
        </Card>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Week Of</TableHead>
                <TableHead className="text-xs">Generated</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Cleaners</TableHead>
                <TableHead className="text-xs text-right">Gross</TableHead>
                <TableHead className="text-xs text-right">Mileage</TableHead>
                <TableHead className="text-xs text-right">Reimb.</TableHead>
                <TableHead className="text-xs">Flags</TableHead>
                <TableHead className="text-xs w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedRunId(r.id)}
                >
                  <TableCell className="text-xs font-medium">{r.weekOf}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.generatedAt
                      ? new Date(r.generatedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-xs text-right">
                    {r.cleanerCount}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    ${Number(r.totalGrossPay).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">
                    ${Number(r.totalMileage).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">
                    ${Number(r.totalReimbursements).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {r.includesMonthlyReceipts && (
                      <Badge variant="outline" className="text-[10px]">
                        +Receipts
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail sheet */}
      <PayrollRunDetailSheet
        runId={selectedRunId}
        open={selectedRunId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedRunId(null);
        }}
        onAnyMutation={() => {
          runsQuery.refetch();
          if (selectedRunId)
            utils.payroll.get.invalidate({ runId: selectedRunId });
        }}
      />
    </div>
  );
}

function PayrollRunDetailSheet({
  runId,
  open,
  onOpenChange,
  onAnyMutation,
}: {
  runId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnyMutation: () => void;
}) {
  const detailQuery = trpc.payroll.get.useQuery(
    { runId: runId ?? 0 },
    { enabled: runId !== null }
  );

  const approveMutation = trpc.payroll.approve.useMutation({
    onSuccess: () => {
      toast.success("Payroll run approved");
      onAnyMutation();
    },
    onError: (e) => toast.error(`Approve failed: ${e.message}`),
  });

  const submittedMutation = trpc.payroll.markSubmitted.useMutation({
    onSuccess: () => {
      toast.success("Marked as submitted");
      onAnyMutation();
    },
    onError: (e) => toast.error(`Mark submitted failed: ${e.message}`),
  });

  const utils = trpc.useUtils();
  const [downloading, setDownloading] = useState(false);

  async function downloadCsv() {
    if (!runId) return;
    setDownloading(true);
    try {
      const { csv } = await utils.payroll.exportCsv.fetch({ runId });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_${detailQuery.data?.run.weekOf ?? runId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch (e: any) {
      toast.error(`Download failed: ${e.message}`);
    } finally {
      setDownloading(false);
    }
  }

  const run = detailQuery.data?.run;
  const lines = detailQuery.data?.lines ?? [];
  const missingQbCount = lines.filter((l) => l.missingQbId).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            Payroll Run {run ? `— Week of ${run.weekOf}` : ""}
          </SheetTitle>
        </SheetHeader>

        {detailQuery.isLoading || !run ? (
          <Skeleton className="h-40 w-full mt-4" />
        ) : (
          <div className="space-y-4 mt-4">
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="p-3">
                <p className="text-[10px] text-muted-foreground">Cleaners</p>
                <p className="text-lg font-semibold">{run.cleanerCount}</p>
              </Card>
              <Card className="p-3">
                <p className="text-[10px] text-muted-foreground">Gross Commission</p>
                <p className="text-lg font-semibold">
                  ${Number(run.totalGrossPay).toFixed(2)}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[10px] text-muted-foreground">Mileage</p>
                <p className="text-lg font-semibold">
                  ${Number(run.totalMileage).toFixed(2)}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[10px] text-muted-foreground">Reimbursements</p>
                <p className="text-lg font-semibold">
                  ${Number(run.totalReimbursements).toFixed(2)}
                </p>
              </Card>
            </div>

            {run.includesMonthlyReceipts && (
              <div className="text-xs rounded-md border bg-muted/50 px-3 py-2">
                <Receipt className="inline h-3 w-3 mr-1" />
                Last run of the month — monthly cell phone + vehicle
                reimbursements are included for cleaners with approved receipts.
              </div>
            )}

            {missingQbCount > 0 && (
              <div className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">
                ⚠ {missingQbCount} cleaner{missingQbCount > 1 ? "s" : ""} missing
                a QuickBooks Employee ID. Add it on the Cleaners tab before
                importing into QB.
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {run.status === "draft" && (
                <Button
                  size="sm"
                  onClick={() => {
                    if (confirm("Approve this payroll run? This locks the numbers."))
                      approveMutation.mutate({ runId: run.id });
                  }}
                  disabled={approveMutation.isPending}
                >
                  <FileCheck2 className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
              )}
              {run.status === "approved" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (confirm("Mark this run as submitted to QuickBooks?"))
                      submittedMutation.mutate({ runId: run.id });
                  }}
                  disabled={submittedMutation.isPending}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Mark Submitted
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={downloadCsv}
                disabled={downloading}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                Download CSV
              </Button>
            </div>

            {/* Lines table */}
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Cleaner</TableHead>
                    <TableHead className="text-xs">QB ID</TableHead>
                    <TableHead className="text-xs text-right">VA</TableHead>
                    <TableHead className="text-xs text-right">NC</TableHead>
                    <TableHead className="text-xs text-right">Other</TableHead>
                    <TableHead className="text-xs text-right">Mileage</TableHead>
                    <TableHead className="text-xs text-right">Reimb.</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const reimb =
                      Number(l.cellPhoneReimbursement) +
                      Number(l.vehicleReimbursement);
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs font-medium">
                          {l.cleanerName}
                        </TableCell>
                        <TableCell className="text-xs">
                          {l.quickbooksEmployeeId ?? (
                            <span className="text-amber-700">— missing</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          ${Number(l.commissionVA).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          ${Number(l.commissionNC).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          ${Number(l.commissionOther).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono text-muted-foreground">
                          ${Number(l.mileageReimbursement).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono text-muted-foreground">
                          ${reimb.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono font-semibold">
                          ${Number(l.totalPay).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {run.approvedAt && (
              <p className="text-xs text-muted-foreground">
                Approved {new Date(run.approvedAt).toLocaleString()}
              </p>
            )}
            {run.submittedAt && (
              <p className="text-xs text-muted-foreground">
                Submitted {new Date(run.submittedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
