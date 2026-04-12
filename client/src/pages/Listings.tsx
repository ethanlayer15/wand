import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  MapPin,
  Star,
  Users,
  Hexagon,
  Wrench,
  Phone,
  Mail,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Building2,
  Hash,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

// ── Specialty helpers (shared with Pods page) ──────────────────────────────
const SPECIALTIES = [
  { value: "plumber", label: "Plumber" },
  { value: "electrician", label: "Electrician" },
  { value: "hvac", label: "HVAC" },
  { value: "handyman", label: "Handyman" },
  { value: "pest_control", label: "Pest Control" },
  { value: "landscaper", label: "Landscaper" },
  { value: "appliance_repair", label: "Appliance Repair" },
] as const;

type Specialty = (typeof SPECIALTIES)[number]["value"];

function specialtyLabel(s: string) {
  return SPECIALTIES.find((sp) => sp.value === s)?.label ?? s;
}

function specialtyColor(s: string) {
  const colors: Record<string, string> = {
    plumber: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    electrician: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    hvac: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    handyman: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    pest_control: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    landscaper: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    appliance_repair: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  };
  return colors[s] ?? "bg-muted text-muted-foreground";
}

type ListingType = {
  id: number;
  name: string;
  internalName?: string | null;
  city?: string | null;
  state?: string | null;
  status: string;
  photoUrl?: string | null;
  avgRating?: string | null;
  reviewCount?: number | null;
  guestCapacity?: number | null;
  podId?: number | null;
};

// ── Property Detail Sheet ──────────────────────────────────────────────────
function PropertyDetailSheet({
  listing,
  open,
  onOpenChange,
}: {
  listing: ListingType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { isAdmin } = usePermissions();

  // Effective vendors (property overrides + pod defaults)
  const { data: effectiveVendors, isLoading: vendorsLoading } =
    trpc.pods.effectiveVendors.useQuery(
      { listingId: listing?.id ?? 0 },
      { enabled: open && !!listing }
    );

  // Pod list for displaying pod name
  const { data: podList } = trpc.pods.list.useQuery(undefined, {
    enabled: open && !!listing?.podId,
  });

  const podName = listing?.podId
    ? podList?.find((p) => p.id === listing.podId)?.name ?? `Pod #${listing.podId}`
    : null;

  // Vendor form state
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editVendor, setEditVendor] = useState<any>(null);
  const [vendorForm, setVendorForm] = useState({
    name: "",
    phone: "",
    email: "",
    company: "",
    specialty: "plumber" as Specialty,
    notes: "",
  });

  function resetVendorForm() {
    setVendorForm({ name: "", phone: "", email: "", company: "", specialty: "plumber", notes: "" });
    setEditVendor(null);
  }

  const createVendorMut = trpc.pods.createPropertyVendor.useMutation({
    onSuccess: () => {
      utils.pods.effectiveVendors.invalidate({ listingId: listing?.id });
      setShowVendorForm(false);
      resetVendorForm();
      toast.success("Property vendor added");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateVendorMut = trpc.pods.updatePropertyVendor.useMutation({
    onSuccess: () => {
      utils.pods.effectiveVendors.invalidate({ listingId: listing?.id });
      setShowVendorForm(false);
      resetVendorForm();
      toast.success("Vendor updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteVendorMut = trpc.pods.deletePropertyVendor.useMutation({
    onSuccess: () => {
      utils.pods.effectiveVendors.invalidate({ listingId: listing?.id });
      toast.success("Vendor removed");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!listing) return null;

  const displayName = listing.internalName || listing.name;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0">
          <SheetHeader className="px-6 pt-6 pb-3">
            <SheetTitle className="text-base leading-snug">{displayName}</SheetTitle>
            <SheetDescription className="text-xs">
              {listing.city && listing.state
                ? `${listing.city}, ${listing.state}`
                : "Property details"}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-90px)] px-6 pb-6">
            <div className="space-y-5 pt-1 pb-8">
              {/* Property photo */}
              {listing.photoUrl && (
                <div className="rounded-lg overflow-hidden h-40">
                  <img
                    src={listing.photoUrl}
                    alt={displayName}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {/* Key stats */}
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="inline-flex items-center gap-1 text-yellow-600 font-medium">
                  <Star className="h-3.5 w-3.5" />
                  {listing.avgRating || "—"} ({listing.reviewCount || 0} reviews)
                </span>
                {listing.guestCapacity && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {listing.guestCapacity} guests
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={
                    listing.status === "active"
                      ? "text-green-600 border-green-200"
                      : "text-muted-foreground"
                  }
                >
                  {listing.status}
                </Badge>
              </div>

              {/* Pod assignment */}
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/30">
                <Hexagon className="h-4 w-4 text-indigo-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Pod Assignment</p>
                  <p className="text-sm font-medium">
                    {podName ?? (
                      <span className="text-muted-foreground italic">Not assigned to a pod</span>
                    )}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Vendor directory */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-orange-500" />
                    Vendor Directory
                  </h4>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        resetVendorForm();
                        setShowVendorForm(true);
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Override
                    </Button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  Property overrides take priority over pod defaults. Entries marked{" "}
                  <span className="font-medium text-foreground">Pod</span> inherit from the pod.
                </p>

                {vendorsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                ) : effectiveVendors ? (
                  <div className="space-y-4">
                    {SPECIALTIES.map((spec) => {
                      const entry = effectiveVendors[spec.value];
                      const vendors = entry?.vendors ?? [];
                      const source = entry?.source ?? "pod";

                      return (
                        <div key={spec.value}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <Badge
                              variant="secondary"
                              className={specialtyColor(spec.value)}
                            >
                              {spec.label}
                            </Badge>
                            {source === "property" ? (
                              <Badge
                                variant="outline"
                                className="text-xs h-4 px-1.5 text-emerald-600 border-emerald-200"
                              >
                                <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
                                Override
                              </Badge>
                            ) : vendors.length > 0 ? (
                              <Badge
                                variant="outline"
                                className="text-xs h-4 px-1.5 text-indigo-500 border-indigo-200"
                              >
                                <Hexagon className="h-2.5 w-2.5 mr-0.5" />
                                Pod
                              </Badge>
                            ) : null}
                          </div>

                          {vendors.length === 0 ? (
                            <p className="text-xs text-muted-foreground ml-2">No contacts</p>
                          ) : (
                            <div className="space-y-1.5 ml-2">
                              {vendors.map((v: any) => (
                                <div
                                  key={v.id}
                                  className="flex items-center justify-between px-3 py-2 rounded-md border bg-card"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium">{v.name}</p>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                      {v.company && <span>{v.company}</span>}
                                      {v.phone && (
                                        <span className="flex items-center gap-1">
                                          <Phone className="h-3 w-3" /> {v.phone}
                                        </span>
                                      )}
                                      {v.email && (
                                        <span className="flex items-center gap-1">
                                          <Mail className="h-3 w-3" /> {v.email}
                                        </span>
                                      )}
                                    </div>
                                    {v.notes && (
                                      <p className="text-xs text-muted-foreground mt-0.5 italic line-clamp-1">
                                        {v.notes}
                                      </p>
                                    )}
                                  </div>
                                  {/* Only show edit/delete for property-level overrides */}
                                  {isAdmin && source === "property" && (
                                    <div className="flex gap-1 shrink-0">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => {
                                          setEditVendor(v);
                                          setVendorForm({
                                            name: v.name,
                                            phone: v.phone || "",
                                            email: v.email || "",
                                            company: v.company || "",
                                            specialty: v.specialty as Specialty,
                                            notes: v.notes || "",
                                          });
                                          setShowVendorForm(true);
                                        }}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => {
                                          if (confirm(`Remove ${v.name}?`)) {
                                            deleteVendorMut.mutate({ vendorId: v.id });
                                          }
                                        }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No vendor data available.
                  </p>
                )}
              </div>

              <Separator />

              {/* Cleaning Report Recipients */}
              <CleaningReportRecipients listingId={listing.id} isAdmin={isAdmin} />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Vendor Form Dialog */}
      <Dialog open={showVendorForm} onOpenChange={setShowVendorForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editVendor ? "Edit Vendor Override" : "Add Vendor Override"}</DialogTitle>
            <DialogDescription>
              {editVendor
                ? "Update this property-specific vendor contact"
                : `Add a vendor override for ${displayName}. This will take priority over the pod default for the selected specialty.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Name *</Label>
                <Input
                  value={vendorForm.name}
                  onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="John Smith"
                />
              </div>
              <div>
                <Label>Specialty *</Label>
                <Select
                  value={vendorForm.specialty}
                  onValueChange={(v) => setVendorForm((f) => ({ ...f, specialty: v as Specialty }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPECIALTIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Phone</Label>
                <Input
                  value={vendorForm.phone}
                  onChange={(e) => setVendorForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="(828) 555-1234"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  value={vendorForm.email}
                  onChange={(e) => setVendorForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="john@example.com"
                />
              </div>
            </div>
            <div>
              <Label>Company</Label>
              <Input
                value={vendorForm.company}
                onChange={(e) => setVendorForm((f) => ({ ...f, company: e.target.value }))}
                placeholder="ABC Plumbing"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={vendorForm.notes}
                onChange={(e) => setVendorForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Preferred for emergency calls, available 24/7..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowVendorForm(false); resetVendorForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!vendorForm.name.trim()) {
                  toast.error("Name is required");
                  return;
                }
                if (editVendor) {
                  updateVendorMut.mutate({
                    vendorId: editVendor.id,
                    ...vendorForm,
                    email: vendorForm.email || undefined,
                    phone: vendorForm.phone || undefined,
                    company: vendorForm.company || undefined,
                    notes: vendorForm.notes || undefined,
                  });
                } else if (listing) {
                  createVendorMut.mutate({
                    listingId: listing.id,
                    ...vendorForm,
                    email: vendorForm.email || undefined,
                    phone: vendorForm.phone || undefined,
                    company: vendorForm.company || undefined,
                    notes: vendorForm.notes || undefined,
                  });
                }
              }}
              disabled={createVendorMut.isPending || updateVendorMut.isPending}
            >
              {editVendor ? "Save Changes" : "Add Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Cleaning Report Recipients ──────────────────────────────────────────

function CleaningReportRecipients({ listingId, isAdmin }: { listingId: number; isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const { data: recipients, isLoading } = trpc.cleaningReports.getRecipients.useQuery({ listingId });
  const [showForm, setShowForm] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");

  /** Normalize input to E.164: strip non-digits, prepend +1 if needed */
  function toE164(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return raw.trim(); // let server validation catch bad formats
  }

  const addMut = trpc.cleaningReports.addRecipient.useMutation({
    onSuccess: () => {
      utils.cleaningReports.getRecipients.invalidate({ listingId });
      setPhoneNumber("");
      setName("");
      setShowForm(false);
      toast.success("Recipient added");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMut = trpc.cleaningReports.removeRecipient.useMutation({
    onSuccess: () => {
      utils.cleaningReports.getRecipients.invalidate({ listingId });
      toast.success("Recipient removed");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Phone className="h-4 w-4 text-blue-500" />
          Cleaning Report Recipients
        </h4>
        {isAdmin && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        These numbers receive an automatic SMS when a turnover clean is completed.
      </p>

      {/* Add form */}
      {showForm && (
        <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Phone Number *</Label>
              <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="(828) 555-1234" className="h-8 text-sm" type="tel" />
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Property Owner" className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" disabled={!phoneNumber.trim() || addMut.isPending}
              onClick={() => addMut.mutate({ listingId, phoneNumber: toE164(phoneNumber), name: name.trim() || undefined })}>
              {addMut.isPending ? "Adding..." : "Add Recipient"}
            </Button>
          </div>
        </div>
      )}

      {/* Recipient list */}
      {isLoading ? (
        <Skeleton className="h-8" />
      ) : recipients && recipients.length > 0 ? (
        <div className="space-y-1.5">
          {recipients.map((r: any) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-md border bg-card">
              <div className="min-w-0">
                <p className="text-sm">{r.phoneNumber}</p>
                {r.name && <p className="text-xs text-muted-foreground">{r.name}</p>}
              </div>
              {isAdmin && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                  onClick={() => { if (confirm(`Remove ${r.phoneNumber}?`)) removeMut.mutate({ id: r.id }); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No recipients configured. Add phone numbers above to receive cleaning report SMS.
        </p>
      )}

      {/* Slack webhook */}
      {isAdmin && <SlackWebhookConfig listingId={listingId} />}
    </div>
  );
}

function SlackWebhookConfig({ listingId }: { listingId: number }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.cleaningReports.getSlackWebhook.useQuery({ listingId });
  const [editing, setEditing] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  const setMut = trpc.cleaningReports.setSlackWebhook.useMutation({
    onSuccess: () => {
      utils.cleaningReports.getSlackWebhook.invalidate({ listingId });
      setEditing(false);
      toast.success(webhookUrl ? "Slack webhook saved" : "Slack webhook removed");
    },
    onError: (err) => toast.error(err.message),
  });

  const currentUrl = data?.webhookUrl;

  return (
    <div className="pt-2 border-t space-y-2">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Hash className="h-4 w-4 text-purple-500" />
        Slack Channel
      </h4>
      <p className="text-xs text-muted-foreground">
        Optionally post cleaning reports to a Slack channel via incoming webhook.
      </p>

      {isLoading ? (
        <Skeleton className="h-8" />
      ) : editing ? (
        <div className="space-y-2">
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="h-8 text-sm"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
            {currentUrl && (
              <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" disabled={setMut.isPending}
                onClick={() => { setWebhookUrl(""); setMut.mutate({ listingId, webhookUrl: null }); }}>
                Remove
              </Button>
            )}
            <Button size="sm" className="h-7 text-xs" disabled={!webhookUrl.trim() || setMut.isPending}
              onClick={() => setMut.mutate({ listingId, webhookUrl: webhookUrl.trim() })}>
              {setMut.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      ) : currentUrl ? (
        <div className="flex items-center justify-between px-3 py-2 rounded-md border bg-card">
          <p className="text-sm text-muted-foreground truncate">{currentUrl.replace(/https:\/\/hooks\.slack\.com\/services\//, "hooks.slack.com/...")}</p>
          <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={() => { setWebhookUrl(currentUrl); setEditing(true); }}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setWebhookUrl(""); setEditing(true); }}>
          <Plus className="h-3 w-3 mr-1" /> Add Slack Webhook
        </Button>
      )}
    </div>
  );
}

// ── Main Listings Page ─────────────────────────────────────────────────────
export default function Listings() {
  const { data: listings, isLoading } = trpc.listings.list.useQuery();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedListing, setSelectedListing] = useState<ListingType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filteredListings =
    listings?.filter(
      (l) =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (l.internalName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.city?.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

  return (
    <div className="space-y-6 p-6 w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="wand-page-title">Listings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {listings?.length || 0} properties synced from Hostaway — click any card to view vendors
          </p>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search properties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Property grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </>
        ) : filteredListings.length > 0 ? (
          filteredListings.map((listing) => (
            <Card
              key={listing.id}
              className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => {
                setSelectedListing(listing as ListingType);
                setDetailOpen(true);
              }}
            >
              {/* Image */}
              <div className="w-full h-40 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                {listing.photoUrl ? (
                  <img
                    src={listing.photoUrl}
                    alt={listing.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 className="h-10 w-10 text-gray-400" />
                )}
              </div>

              {/* Content */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-sm line-clamp-2">
                    {listing.internalName || listing.name}
                  </h3>
                  <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded whitespace-nowrap">
                    {listing.status}
                  </span>
                </div>

                {listing.internalName && (
                  <p className="text-xs text-muted-foreground mb-1 line-clamp-1">{listing.name}</p>
                )}

                <p className="text-xs text-muted-foreground mb-3">
                  {listing.city}, {listing.state}
                </p>

                <div className="flex items-center justify-between pt-3 border-t">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-yellow-500">
                      {listing.avgRating || "—"}★
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({listing.reviewCount || 0})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {listing.podId && (
                      <Hexagon className="h-3.5 w-3.5 text-indigo-400" aria-label="Assigned to a pod" />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {listing.guestCapacity || "—"} guests
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <div className="col-span-full text-center py-12">
            <p className="text-muted-foreground">No properties found</p>
          </div>
        )}
      </div>

      {/* Property Detail Sheet */}
      <PropertyDetailSheet
        listing={selectedListing}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
