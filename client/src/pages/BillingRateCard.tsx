import { useState, useMemo } from "react";
import { PropertyCombobox } from "@/components/PropertyCombobox";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Receipt,
  Plus,
  Trash2,
  Loader2,
  Pencil,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Search,
  Filter,
} from "lucide-react";

type RateCardEntry = {
  id: number;
  propertyId: string;
  propertyName: string | null;
  csvName: string | null;
  matchConfidence: string | null;
  matchScore: number | null;
  taskType: string;
  amount: string;
  createdAt: Date;
  updatedAt: Date;
};

type BreezewayProperty = {
  id: number;
  name: string;
};

const CONFIDENCE_LABELS: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  high: { label: "High Match", color: "text-green-600 bg-green-50 border-green-200", icon: CheckCircle2 },
  confirmed: { label: "Confirmed", color: "text-green-700 bg-green-100 border-green-300", icon: CheckCircle2 },
  manual: { label: "Manual", color: "text-blue-600 bg-blue-50 border-blue-200", icon: CheckCircle2 },
  possible: { label: "Needs Review", color: "text-amber-600 bg-amber-50 border-amber-200", icon: AlertTriangle },
  unmatched: { label: "Unmatched", color: "text-red-600 bg-red-50 border-red-200", icon: HelpCircle },
};

const FILTER_OPTIONS = [
  { value: "all", label: "All Entries" },
  { value: "needs-review", label: "Needs Review" },
  { value: "unmatched", label: "Unmatched" },
  { value: "confirmed", label: "Confirmed / High / Manual" },
];

export default function BillingRateCard() {
  const [addDialog, setAddDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [editingCard, setEditingCard] = useState<RateCardEntry | null>(null);
  const [formPropertyId, setFormPropertyId] = useState("");
  const [formTaskType, setFormTaskType] = useState("turnover-clean");
  const [formAmount, setFormAmount] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [reassignDialog, setReassignDialog] = useState(false);
  const [reassignCard, setReassignCard] = useState<RateCardEntry | null>(null);
  const [reassignPropertyId, setReassignPropertyId] = useState("");
  // propertySearch removed — now handled inside PropertyCombobox

  const utils = trpc.useUtils();
  const rateCardsQuery = trpc.billing.rateCards.list.useQuery();
  const propertiesQuery = trpc.breezeway.properties.fetchLive.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const upsertMutation = trpc.billing.rateCards.upsert.useMutation({
    onSuccess: () => {
      utils.billing.rateCards.list.invalidate();
      setAddDialog(false);
      setEditDialog(false);
      setEditingCard(null);
      setReassignDialog(false);
      setReassignCard(null);
      resetForm();
      toast.success("Rate card saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.billing.rateCards.delete.useMutation({
    onSuccess: () => {
      utils.billing.rateCards.list.invalidate();
      toast.success("Rate card removed");
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => {
    setFormPropertyId("");
    setFormTaskType("turnover-clean");
    setFormAmount("");
    setReassignPropertyId("");
  };

  const handleAdd = () => {
    if (!formPropertyId) return toast.error("Property is required");
    if (!formAmount || parseFloat(formAmount) <= 0) return toast.error("Amount must be > 0");
    const property = properties.find((p) => String(p.id) === formPropertyId);
    upsertMutation.mutate({
      propertyId: formPropertyId,
      propertyName: property?.name,
      taskType: formTaskType,
      amount: formAmount,
      matchConfidence: "manual",
    });
  };

  const handleEdit = () => {
    if (!editingCard) return;
    if (!formAmount || parseFloat(formAmount) <= 0) return toast.error("Amount must be > 0");
    upsertMutation.mutate({
      id: editingCard.id,
      propertyId: editingCard.propertyId,
      propertyName: editingCard.propertyName ?? undefined,
      csvName: editingCard.csvName ?? undefined,
      matchConfidence: editingCard.matchConfidence ?? undefined,
      taskType: editingCard.taskType,
      amount: formAmount,
    });
  };

  const handleReassign = () => {
    if (!reassignCard || !reassignPropertyId) return toast.error("Select a property");
    const property = properties.find((p) => String(p.id) === reassignPropertyId);
    upsertMutation.mutate({
      id: reassignCard.id,
      propertyId: reassignPropertyId,
      propertyName: property?.name ?? reassignCard.propertyName ?? undefined,
      csvName: reassignCard.csvName ?? undefined,
      matchConfidence: "confirmed",
      matchScore: 100,
      taskType: reassignCard.taskType,
      amount: reassignCard.amount,
    });
  };

  const handleConfirmMatch = (card: RateCardEntry) => {
    upsertMutation.mutate({
      id: card.id,
      propertyId: card.propertyId,
      propertyName: card.propertyName ?? undefined,
      csvName: card.csvName ?? undefined,
      matchConfidence: "confirmed",
      matchScore: 100,
      taskType: card.taskType,
      amount: card.amount,
    });
  };

  const rates = (rateCardsQuery.data || []) as RateCardEntry[];
  const properties = (propertiesQuery.data || []) as BreezewayProperty[];

  // Build a property name lookup
  const propertyNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of properties) map[String(p.id)] = p.name;
    return map;
  }, [properties]);

  // Filter and search
  const filteredRates = useMemo(() => {
    let result = rates;

    // Filter by confidence
    if (filterMode === "needs-review") {
      result = result.filter((r) => r.matchConfidence === "possible");
    } else if (filterMode === "unmatched") {
      result = result.filter((r) => r.matchConfidence === "unmatched");
    } else if (filterMode === "confirmed") {
      result = result.filter((r) =>
        r.matchConfidence === "confirmed" || r.matchConfidence === "high" || r.matchConfidence === "manual"
      );
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          (r.propertyName || "").toLowerCase().includes(q) ||
          (r.csvName || "").toLowerCase().includes(q) ||
          (propertyNameMap[r.propertyId] || "").toLowerCase().includes(q)
      );
    }

    // Sort: unmatched first, then possible, then the rest
    const order: Record<string, number> = { unmatched: 0, possible: 1, high: 2, manual: 3, confirmed: 4 };
    result.sort((a, b) => {
      const oa = order[a.matchConfidence || "manual"] ?? 3;
      const ob = order[b.matchConfidence || "manual"] ?? 3;
      if (oa !== ob) return oa - ob;
      return (a.propertyName || "").localeCompare(b.propertyName || "");
    });

    return result;
  }, [rates, filterMode, searchQuery, propertyNameMap]);

  // Stats
  const stats = useMemo(() => {
    const s = { total: rates.length, unmatched: 0, needsReview: 0, confirmed: 0 };
    for (const r of rates) {
      if (r.matchConfidence === "unmatched") s.unmatched++;
      else if (r.matchConfidence === "possible") s.needsReview++;
      else s.confirmed++;
    }
    return s;
  }, [rates]);

  // Filtered properties for reassign dropdown
  // filteredProperties removed — now handled inside PropertyCombobox

  const getConfidenceBadge = (confidence: string | null) => {
    const conf = CONFIDENCE_LABELS[confidence || "manual"] || CONFIDENCE_LABELS.manual;
    const Icon = conf.icon;
    return (
      <Badge variant="outline" className={`${conf.color} text-xs gap-1`}>
        <Icon className="h-3 w-3" />
        {conf.label}
      </Badge>
    );
  };

  const openEditDialog = (card: RateCardEntry) => {
    setEditingCard(card);
    setFormAmount(card.amount);
    setEditDialog(true);
  };

  const openReassignDialog = (card: RateCardEntry) => {
    setReassignCard(card);
    setReassignPropertyId(card.propertyId === "unmatched" ? "" : card.propertyId);
    setReassignDialog(true);
  };

  if (rateCardsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-amber-500" />
            Rate Card Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage turnover clean pricing for each property
          </p>
        </div>
        <Button onClick={() => { resetForm(); setAddDialog(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Rate
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="cursor-pointer hover:ring-1 hover:ring-amber-300 transition-all" onClick={() => setFilterMode("all")}>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total Entries</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:ring-1 hover:ring-green-300 transition-all" onClick={() => setFilterMode("confirmed")}>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-green-600">{stats.confirmed}</div>
            <div className="text-xs text-muted-foreground">Confirmed</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:ring-1 hover:ring-amber-300 transition-all" onClick={() => setFilterMode("needs-review")}>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-amber-600">{stats.needsReview}</div>
            <div className="text-xs text-muted-foreground">Needs Review</div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:ring-1 hover:ring-red-300 transition-all" onClick={() => setFilterMode("unmatched")}>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-red-600">{stats.unmatched}</div>
            <div className="text-xs text-muted-foreground">Unmatched</div>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by property name or CSV name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterMode} onValueChange={setFilterMode}>
          <SelectTrigger className="w-[200px]">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Rate Card Table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="p-3 text-left font-medium text-muted-foreground">Property</th>
                <th className="p-3 text-left font-medium text-muted-foreground">CSV Name</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Price</th>
                <th className="p-3 text-center font-medium text-muted-foreground w-[140px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    {searchQuery || filterMode !== "all"
                      ? "No entries match your filters"
                      : "No rate cards configured"}
                  </td>
                </tr>
              ) : (
                filteredRates.map((rate) => {
                  const bwName = propertyNameMap[rate.propertyId] || rate.propertyName;
                  const isUnmatched = rate.matchConfidence === "unmatched";
                  const isPossible = rate.matchConfidence === "possible";

                  return (
                    <tr key={rate.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="p-3">
                        <div className="font-medium">
                          {isUnmatched ? (
                            <span className="text-muted-foreground italic">Not assigned</span>
                          ) : (
                            bwName || `Property #${rate.propertyId}`
                          )}
                        </div>
                        {!isUnmatched && (
                          <div className="text-xs text-muted-foreground font-mono">
                            ID: {rate.propertyId}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        {rate.csvName ? (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded">{rate.csvName}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {getConfidenceBadge(rate.matchConfidence)}
                        {rate.matchScore != null && rate.matchScore < 100 && (
                          <span className="text-[10px] text-muted-foreground ml-1">{rate.matchScore}%</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <span className="font-mono font-semibold text-base">${rate.amount}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          {isPossible && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => handleConfirmMatch(rate)}
                              disabled={upsertMutation.isPending}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Confirm
                            </Button>
                          )}
                          {(isPossible || isUnmatched) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => openReassignDialog(rate)}
                            >
                              Reassign
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => openEditDialog(rate)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (confirm("Delete this rate card entry?")) {
                                deleteMutation.mutate({ id: rate.id });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground text-center">
        Showing {filteredRates.length} of {rates.length} entries
      </div>

      {/* Add Rate Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Rate Card Entry</DialogTitle>
            <DialogDescription>
              Set a turnover clean price for a Breezeway property
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Property</Label>
              <PropertyCombobox
                properties={properties.map((p) => ({
                  id: p.id,
                  name: p.name || `Property #${p.id}`,
                }))}
                value={formPropertyId || "all"}
                onValueChange={(v) => setFormPropertyId(v === "all" ? "" : v)}
                allLabel={undefined}
                placeholder="Select a property…"
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Price Dialog */}
      <Dialog open={editDialog} onOpenChange={(open) => { setEditDialog(open); if (!open) setEditingCard(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Price</DialogTitle>
            <DialogDescription>
              {editingCard?.propertyName || editingCard?.csvName || "Unknown property"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign Property Dialog */}
      <Dialog open={reassignDialog} onOpenChange={(open) => { setReassignDialog(open); if (!open) { setReassignCard(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reassignCard?.matchConfidence === "unmatched" ? "Assign" : "Reassign"} Property
            </DialogTitle>
            <DialogDescription>
              {reassignCard?.csvName && (
                <span>
                  CSV name: <strong>{reassignCard.csvName}</strong> (${reassignCard.amount})
                </span>
              )}
              {reassignCard?.matchConfidence === "possible" && reassignCard?.propertyName && (
                <span className="block mt-1">
                  Current suggestion: <strong>{reassignCard.propertyName}</strong> ({reassignCard.matchScore}% match)
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Breezeway Property</Label>
              <PropertyCombobox
                properties={properties.map((p) => ({
                  id: p.id,
                  name: p.name || `Property #${p.id}`,
                }))}
                value={reassignPropertyId || "all"}
                onValueChange={(v) => setReassignPropertyId(v === "all" ? "" : v)}
                allLabel={undefined}
                placeholder="Select a property…"
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignDialog(false)}>Cancel</Button>
            <Button onClick={handleReassign} disabled={upsertMutation.isPending || !reassignPropertyId}>
              {upsertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {reassignCard?.matchConfidence === "unmatched" ? "Assign" : "Reassign"} Property
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
