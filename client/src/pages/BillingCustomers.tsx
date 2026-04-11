import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Trash2,
  Link2,
  Loader2,
  Check,
  ChevronsUpDown,
  Building2,
  User,
  Wand2,
  ArrowRight,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Searchable Combobox ─────────────────────────────────────────────────────

interface ComboboxItem {
  value: string;
  label: string;
  sublabel?: string;
}

function SearchableCombobox({
  items,
  value,
  onSelect,
  placeholder,
  searchPlaceholder,
  emptyText,
  loading,
  disabled,
}: {
  items: ComboboxItem[];
  value: string;
  onSelect: (value: string, label: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="w-full justify-between font-normal bg-background"
        >
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </span>
          ) : selected ? (
            <span className="flex flex-col items-start text-left">
              <span className="text-sm">{selected.label}</span>
              {selected.sublabel && (
                <span className="text-xs text-muted-foreground">{selected.sublabel}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(400px,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={`${item.label} ${item.sublabel || ""}`}
                  onSelect={() => {
                    onSelect(item.value, item.label);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === item.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm">{item.label}</span>
                    {item.sublabel && (
                      <span className="text-xs text-muted-foreground">{item.sublabel}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Auto-Map Panel ──────────────────────────────────────────────────────────

interface AutoMapSuggestion {
  breezewayPropertyId: string;
  breezewayPropertyName: string;
  stripeCustomerId: string;
  stripeCustomerName: string;
  stripeCustomerEmail: string | null;
  score: number;
  confidence: "high" | "possible";
}

function AutoMapPanel({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (suggestion: AutoMapSuggestion) => void;
}) {
  const autoMapQuery = trpc.billing.autoMap.useQuery(undefined, {
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  // Track dismissed suggestions locally
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Track confirmed suggestions locally (for optimistic UI)
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  const suggestions = autoMapQuery.data?.suggestions ?? [];
  const stats = autoMapQuery.data;

  // Filter out dismissed and confirmed
  const activeSuggestions = suggestions.filter(
    (s) => !dismissed.has(s.breezewayPropertyId) && !confirmed.has(s.breezewayPropertyId)
  );

  const highConfidence = activeSuggestions.filter((s) => s.confidence === "high");
  const possibleMatches = activeSuggestions.filter((s) => s.confidence === "possible");

  const handleConfirm = (s: AutoMapSuggestion) => {
    setConfirmed((prev) => new Set([...Array.from(prev), s.breezewayPropertyId]));
    onConfirm(s);
  };

  const handleSkip = (propertyId: string) => {
    setDismissed((prev) => new Set([...Array.from(prev), propertyId]));
  };

  const [confirmingAll, setConfirmingAll] = useState(false);

  const handleConfirmAllHigh = async () => {
    if (highConfidence.length === 0) return;
    setConfirmingAll(true);
    // Fire each confirmation sequentially to avoid overwhelming the server
    for (const s of highConfidence) {
      onConfirm(s);
      setConfirmed((prev) => new Set([...Array.from(prev), s.breezewayPropertyId]));
      // Small delay between mutations to avoid race conditions
      await new Promise((r) => setTimeout(r, 80));
    }
    setConfirmingAll(false);
  };

  const confirmedCount = confirmed.size;
  const skippedCount = dismissed.size;

  return (
    <Card className="border-amber-500/30 bg-amber-50/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-amber-500" />
            Auto-Map Suggestions
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {autoMapQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyzing {stats?.totalProperties ?? "..."} properties and {stats?.totalCustomers ?? "..."} customers...
          </div>
        ) : stats ? (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
            <span>{stats.totalProperties} properties</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{stats.totalCustomers} Stripe customers</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{stats.alreadyMapped} already mapped</span>
            {confirmedCount > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-emerald-600 font-medium">{confirmedCount} confirmed</span>
              </>
            )}
            {skippedCount > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>{skippedCount} skipped</span>
              </>
            )}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {autoMapQuery.isLoading ? (
          <div className="py-8 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-sm">Running fuzzy match algorithm...</p>
          </div>
        ) : autoMapQuery.isError ? (
          <div className="py-6 text-center text-sm text-red-500">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            Failed to run auto-map. Check Stripe API key and Breezeway sync.
          </div>
        ) : activeSuggestions.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
            <p className="text-sm font-medium text-foreground">
              {confirmedCount > 0 || skippedCount > 0
                ? "All suggestions reviewed!"
                : suggestions.length === 0
                ? "No matches found"
                : "All suggestions reviewed!"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {confirmedCount > 0 && `${confirmedCount} mapping${confirmedCount > 1 ? "s" : ""} confirmed. `}
              {suggestions.length === 0 && stats
                ? `${stats.totalProperties - stats.alreadyMapped} unmapped properties remain for manual mapping.`
                : "Remaining properties can be mapped manually."}
            </p>
          </div>
        ) : (
          <>
            {/* High confidence matches */}
            {highConfidence.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/15">
                      <Sparkles className="h-3 w-3 mr-1" />
                      High Confidence
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {highConfidence.length} match{highConfidence.length !== 1 ? "es" : ""}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-500"
                    onClick={handleConfirmAllHigh}
                    disabled={confirmingAll || highConfidence.length === 0}
                  >
                    {confirmingAll ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Confirming...</>
                    ) : (
                      <><CheckCircle2 className="h-3 w-3 mr-1" />Confirm All High ({highConfidence.length})</>
                    )}
                  </Button>
                </div>
                {highConfidence.map((s) => (
                  <SuggestionRow
                    key={s.breezewayPropertyId}
                    suggestion={s}
                    onConfirm={() => handleConfirm(s)}
                    onSkip={() => handleSkip(s.breezewayPropertyId)}
                  />
                ))}
              </div>
            )}

            {/* Possible matches */}
            {possibleMatches.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Possible Match
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {possibleMatches.length} match{possibleMatches.length !== 1 ? "es" : ""}
                  </span>
                </div>
                {possibleMatches.map((s) => (
                  <SuggestionRow
                    key={s.breezewayPropertyId}
                    suggestion={s}
                    onConfirm={() => handleConfirm(s)}
                    onSkip={() => handleSkip(s.breezewayPropertyId)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SuggestionRow({
  suggestion,
  onConfirm,
  onSkip,
}: {
  suggestion: AutoMapSuggestion;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const scorePercent = Math.round(suggestion.score * 100);
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/30">
      {/* Breezeway property */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
          <Building2 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{suggestion.breezewayPropertyName}</p>
          <p className="text-[11px] text-muted-foreground font-mono">Breezeway</p>
        </div>
      </div>

      {/* Arrow + score */}
      <div className="flex flex-col items-center shrink-0 px-1">
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span className={cn(
          "text-[10px] font-medium mt-0.5",
          scorePercent >= 70 ? "text-emerald-600" : "text-amber-600"
        )}>
          {scorePercent}%
        </span>
      </div>

      {/* Stripe customer */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 text-purple-500 shrink-0">
          <User className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{suggestion.stripeCustomerName}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {suggestion.stripeCustomerEmail || suggestion.stripeCustomerId}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 shrink-0">
        <Button
          size="sm"
          className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={onConfirm}
        >
          <Check className="h-3 w-3 mr-1" />
          Confirm
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onSkip}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BillingCustomers() {
  const [addDialog, setAddDialog] = useState(false);
  const [showAutoMap, setShowAutoMap] = useState(false);
  // Form state — these hold the selected IDs/names
  const [formPropertyId, setFormPropertyId] = useState("");
  const [formPropertyName, setFormPropertyName] = useState("");
  const [formStripeId, setFormStripeId] = useState("");
  const [formStripeLabel, setFormStripeLabel] = useState("");
  const [formBillingMethod, setFormBillingMethod] = useState<
    "card_on_file" | "invoice" | "ask_each_time"
  >("ask_each_time");
  // Track which mapping we're editing (by DB id)
  const [editingId, setEditingId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const mappingsQuery = trpc.billing.customerMappings.list.useQuery();
  const stripeCustomersQuery = trpc.billing.stripeCustomers.list.useQuery();
  const breezewayPropsQuery = trpc.billing.breezewayProperties.useQuery();

  const upsertMutation = trpc.billing.customerMappings.upsert.useMutation({
    onSuccess: () => {
      utils.billing.customerMappings.list.invalidate();
      setAddDialog(false);
      resetForm();
      toast.success("Customer mapping saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.billing.customerMappings.delete.useMutation({
    onSuccess: () => {
      utils.billing.customerMappings.list.invalidate();
      toast.success("Mapping removed");
    },
    onError: (err) => toast.error(err.message),
  });

  // Mutation for auto-map confirmations
  const autoMapConfirmMutation = trpc.billing.customerMappings.upsert.useMutation({
    onSuccess: () => {
      utils.billing.customerMappings.list.invalidate();
      // Don't close auto-map panel, just refresh
    },
    onError: (err) => toast.error(`Auto-map failed: ${err.message}`),
  });

  const resetForm = () => {
    setFormPropertyId("");
    setFormPropertyName("");
    setFormStripeId("");
    setFormStripeLabel("");
    setFormBillingMethod("ask_each_time");
    setEditingId(null);
  };

  const handleSave = () => {
    if (!formPropertyId.trim()) {
      toast.error("Please select a Breezeway property");
      return;
    }
    upsertMutation.mutate({
      breezewayOwnerId: formPropertyId.trim(),
      breezewayOwnerName: formPropertyName.trim() || undefined,
      stripeCustomerId: formStripeId.trim() || undefined,
      preferredBillingMethod: formBillingMethod,
    });
  };

  const handleAutoMapConfirm = (suggestion: AutoMapSuggestion) => {
    autoMapConfirmMutation.mutate(
      {
        breezewayOwnerId: suggestion.breezewayPropertyId,
        breezewayOwnerName: suggestion.breezewayPropertyName,
        stripeCustomerId: suggestion.stripeCustomerId,
        preferredBillingMethod: "ask_each_time",
      },
      {
        onSuccess: () => {
          toast.success(
            `Mapped "${suggestion.breezewayPropertyName}" → "${suggestion.stripeCustomerName}"`
          );
        },
      }
    );
  };

  const openEdit = (m: {
    id: number;
    breezewayOwnerId: string;
    breezewayOwnerName: string | null;
    stripeCustomerId: string | null;
    preferredBillingMethod: "card_on_file" | "invoice" | "ask_each_time";
  }) => {
    setEditingId(m.id);
    setFormPropertyId(m.breezewayOwnerId);
    setFormPropertyName(m.breezewayOwnerName || "");
    setFormStripeId(m.stripeCustomerId || "");
    // Find the Stripe customer label
    const sc = (stripeCustomersQuery.data || []).find(
      (c) => c.id === m.stripeCustomerId
    );
    setFormStripeLabel(
      sc
        ? `${sc.name || "Unnamed"} — ${sc.email || sc.id}`
        : m.stripeCustomerId || ""
    );
    setFormBillingMethod(m.preferredBillingMethod);
    setAddDialog(true);
  };

  // Build combobox items from live data
  const breezewayItems = useMemo<ComboboxItem[]>(
    () =>
      (breezewayPropsQuery.data || []).map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: p.address || undefined,
      })),
    [breezewayPropsQuery.data]
  );

  const stripeItems = useMemo<ComboboxItem[]>(
    () =>
      (stripeCustomersQuery.data || []).map((c) => ({
        value: c.id,
        label: c.name || "Unnamed Customer",
        sublabel: c.email ? `${c.email} · ${c.id}` : c.id,
      })),
    [stripeCustomersQuery.data]
  );

  const mappings = mappingsQuery.data || [];

  // Helper to get Stripe customer display name from cached data
  const getStripeLabel = (customerId: string | null) => {
    if (!customerId) return null;
    const sc = (stripeCustomersQuery.data || []).find(
      (c) => c.id === customerId
    );
    if (sc) return `${sc.name || "Unnamed"} (${sc.email || customerId})`;
    return customerId;
  };

  return (
    <div className="p-6 max-w-[1000px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Link2 className="h-6 w-6 text-blue-500" />
            Customer Mapping
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Map Breezeway properties to Stripe customers for billing
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowAutoMap(!showAutoMap);
              if (!showAutoMap) {
                // Invalidate to get fresh data when opening
                utils.billing.autoMap.invalidate();
              }
            }}
            className={cn(
              "transition-colors",
              showAutoMap && "border-amber-500/50 bg-amber-500/5 text-amber-600"
            )}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Auto-Map
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setAddDialog(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Mapping
          </Button>
        </div>
      </div>

      {/* Auto-Map Panel */}
      {showAutoMap && (
        <AutoMapPanel
          onClose={() => setShowAutoMap(false)}
          onConfirm={handleAutoMapConfirm}
        />
      )}

      {/* Mapping list */}
      {mappings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No customer mappings yet</p>
            <p className="text-sm mt-1">
              Click <strong>Auto-Map</strong> to get started, or add mappings manually
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {mappings.map((m) => (
            <Card key={m.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  {/* Left: Breezeway property */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {m.breezewayOwnerName || m.breezewayOwnerId}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        ID: {m.breezewayOwnerId}
                      </p>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="text-muted-foreground shrink-0">
                    <ArrowRight className="h-4 w-4" />
                  </div>

                  {/* Right: Stripe customer */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-purple-500/10 text-purple-500 shrink-0">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      {m.stripeCustomerId ? (
                        <>
                          <p className="text-sm font-medium truncate">
                            {getStripeLabel(m.stripeCustomerId)}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-amber-500">No Stripe customer linked</p>
                      )}
                      <Badge variant="outline" className="text-xs mt-1 capitalize">
                        {m.preferredBillingMethod.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => openEdit(m)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate({ id: m.id })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit" : "Add"} Customer Mapping
            </DialogTitle>
            <DialogDescription>
              Connect a Breezeway property to a Stripe customer for billing
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Breezeway property combobox */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-blue-500" />
                Breezeway Property
              </Label>
              {breezewayPropsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading properties...
                </div>
              ) : breezewayItems.length === 0 ? (
                <div className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2">
                  No Breezeway properties synced yet. Go to Settings and click
                  "Sync Properties" first.
                </div>
              ) : (
                <SearchableCombobox
                  items={breezewayItems}
                  value={formPropertyId}
                  onSelect={(id, name) => {
                    setFormPropertyId(id);
                    setFormPropertyName(name);
                  }}
                  placeholder="Search and select a property..."
                  searchPlaceholder="Type to search properties..."
                  emptyText="No properties found"
                />
              )}
              {formPropertyId && (
                <p className="text-xs text-muted-foreground font-mono">
                  Property ID: {formPropertyId}
                </p>
              )}
            </div>

            {/* Stripe customer combobox */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-purple-500" />
                Stripe Customer
              </Label>
              {stripeCustomersQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading Stripe customers...
                </div>
              ) : stripeCustomersQuery.isError ? (
                <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 rounded-md px-3 py-2">
                  Failed to load Stripe customers. Check your Stripe API key in
                  Settings.
                </div>
              ) : stripeItems.length === 0 ? (
                <div className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2">
                  No Stripe customers found. Create customers in your Stripe
                  dashboard first.
                </div>
              ) : (
                <SearchableCombobox
                  items={stripeItems}
                  value={formStripeId}
                  onSelect={(id, label) => {
                    setFormStripeId(id);
                    setFormStripeLabel(label);
                  }}
                  placeholder="Search by name or email..."
                  searchPlaceholder="Type name or email to search..."
                  emptyText="No customers found"
                />
              )}
              {formStripeId && (
                <p className="text-xs text-muted-foreground font-mono">
                  Customer ID: {formStripeId}
                </p>
              )}
            </div>

            {/* Preferred billing method */}
            <div className="space-y-2">
              <Label>Preferred Billing Method</Label>
              <Select
                value={formBillingMethod}
                onValueChange={(v) => setFormBillingMethod(v as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="card_on_file">Card on File</SelectItem>
                  <SelectItem value="invoice">Invoice</SelectItem>
                  <SelectItem value="ask_each_time">Ask Each Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={upsertMutation.isPending || !formPropertyId}
            >
              {upsertMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save Mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
