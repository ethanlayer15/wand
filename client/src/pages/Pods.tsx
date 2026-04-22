import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Hexagon,
  Plus,
  Pencil,
  Trash2,
  Building2,
  Phone,
  Mail,
  Wrench,
  MapPin,
  Route,
  Search,
  Loader2,
} from "lucide-react";

const SPECIALTIES = [
  { value: "plumber", label: "Plumber" },
  { value: "electrician", label: "Electrician" },
  { value: "hvac", label: "HVAC" },
  { value: "handyman", label: "Handyman" },
  { value: "pest_control", label: "Pest Control" },
  { value: "landscaper", label: "Landscaper" },
  { value: "appliance_repair", label: "Appliance Repair" },
];

type PodFormState = { name: string; region: string; storageAddress: string };
type VendorFormState = {
  name: string;
  phone: string;
  email: string;
  company: string;
  specialty: string;
  notes: string;
};

const defaultPodForm: PodFormState = { name: "", region: "", storageAddress: "" };
const defaultVendorForm: VendorFormState = {
  name: "",
  phone: "",
  email: "",
  company: "",
  specialty: "handyman",
  notes: "",
};

export default function Pods() {
  const { isAdmin } = usePermissions();

  // Pod data
  const podsQuery = trpc.pods.list.useQuery();
  const pods = podsQuery.data ?? [];

  // Pod CRUD state
  const [createOpen, setCreateOpen] = useState(false);
  const [editPod, setEditPod] = useState<(typeof pods)[0] | null>(null);
  const [deleteConfirmPod, setDeleteConfirmPod] = useState<(typeof pods)[0] | null>(null);
  const [podForm, setPodForm] = useState<PodFormState>(defaultPodForm);

  // Membership state
  const [membershipSearch, setMembershipSearch] = useState("");
  const [membershipPodFilter, setMembershipPodFilter] = useState<string>("all"); // "all" | "unassigned" | "<podId>"
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());

  // Vendor state
  const [selectedPodId, setSelectedPodId] = useState<number | null>(null);
  const [vendorForm, setVendorForm] = useState<VendorFormState>(defaultVendorForm);
  const [editVendor, setEditVendor] = useState<{
    id: number;
    name: string;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
    specialty: string;
    notes?: string | null;
  } | null>(null);

  // Pod detail (vendors for selected pod)
  const podDetailQuery = trpc.pods.get.useQuery(
    { podId: selectedPodId! },
    { enabled: selectedPodId !== null }
  );
  const vendors = podDetailQuery.data?.vendors ?? [];

  // Membership data
  const propertiesQuery = trpc.pods.properties.useQuery();
  const properties = propertiesQuery.data ?? [];

  const filteredMembershipProperties = properties.filter((prop) => {
    const q = membershipSearch.trim().toLowerCase();
    if (q) {
      const haystack = [prop.internalName ?? "", prop.name ?? "", prop.city ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (membershipPodFilter === "unassigned") return prop.podId === null;
    if (membershipPodFilter !== "all") return String(prop.podId) === membershipPodFilter;
    return true;
  });

  // Mutations — Pod
  const createMutation = trpc.pods.create.useMutation({
    onSuccess: () => {
      podsQuery.refetch();
      setCreateOpen(false);
      setPodForm(defaultPodForm);
      toast.success("Pod created");
    },
    onError: (e) => toast.error(`Failed to create pod: ${e.message}`),
  });

  const updateMutation = trpc.pods.update.useMutation({
    onSuccess: () => {
      podsQuery.refetch();
      setEditPod(null);
      setPodForm(defaultPodForm);
      toast.success("Pod updated");
    },
    onError: (e) => toast.error(`Failed to update pod: ${e.message}`),
  });

  const deleteMutation = trpc.pods.delete.useMutation({
    onSuccess: () => {
      podsQuery.refetch();
      setDeleteConfirmPod(null);
      toast.success("Pod deleted");
    },
    onError: (e) => toast.error(`Failed to delete pod: ${e.message}`),
  });

  const calcDistancesMutation = trpc.pods.calculateDistances.useMutation({
    onSuccess: (r) =>
      toast.success(`Distances updated: ${r.updated} of ${r.total} properties${r.errors ? `, ${r.errors} errors` : ""}`),
    onError: (e) => toast.error(`Distance calculation failed: ${e.message}`),
  });

  const seedAddressesMutation = trpc.pods.seedAddresses.useMutation({
    onSuccess: () => {
      podsQuery.refetch();
      toast.success("WNC-West, WNC-East, WNC-AVL storage addresses seeded");
    },
    onError: (e) => toast.error(`Seeding failed: ${e.message}`),
  });

  // Mutations — Membership
  const assignPropertiesMutation = trpc.pods.assignProperties.useMutation();
  const unassignPropertiesMutation = trpc.pods.unassignProperties.useMutation();

  async function changePropertyPod(listingId: number, newValue: string) {
    setSavingIds((prev) => new Set(prev).add(listingId));
    try {
      if (newValue === "unassigned") {
        await unassignPropertiesMutation.mutateAsync({ listingIds: [listingId] });
      } else {
        await assignPropertiesMutation.mutateAsync({
          podId: Number(newValue),
          listingIds: [listingId],
        });
      }
      await Promise.all([propertiesQuery.refetch(), podsQuery.refetch()]);
      toast.success("Pod updated");
    } catch (e: any) {
      toast.error(`Failed to update pod: ${e.message}`);
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(listingId);
        return next;
      });
    }
  }

  // Mutations — Vendor
  const createVendorMutation = trpc.pods.createVendor.useMutation({
    onSuccess: () => {
      podDetailQuery.refetch();
      setVendorForm(defaultVendorForm);
      toast.success("Vendor added");
    },
    onError: (e) => toast.error(`Failed to add vendor: ${e.message}`),
  });

  const updateVendorMutation = trpc.pods.updateVendor.useMutation({
    onSuccess: () => {
      podDetailQuery.refetch();
      setEditVendor(null);
      setVendorForm(defaultVendorForm);
      toast.success("Vendor updated");
    },
    onError: (e) => toast.error(`Failed to update vendor: ${e.message}`),
  });

  const deleteVendorMutation = trpc.pods.deleteVendor.useMutation({
    onSuccess: () => {
      podDetailQuery.refetch();
      toast.success("Vendor removed");
    },
    onError: (e) => toast.error(`Failed to remove vendor: ${e.message}`),
  });

  // Helpers
  function openEditPod(pod: (typeof pods)[0]) {
    setPodForm({
      name: pod.name,
      region: pod.region ?? "",
      storageAddress: pod.storageAddress ?? "",
    });
    setEditPod(pod);
  }

  function openEditVendor(v: (typeof vendors)[0]) {
    setVendorForm({
      name: v.name,
      phone: v.phone ?? "",
      email: v.email ?? "",
      company: v.company ?? "",
      specialty: v.specialty,
      notes: v.notes ?? "",
    });
    setEditVendor(v);
  }

  function savePod() {
    const payload = {
      name: podForm.name,
      region: podForm.region || undefined,
      storageAddress: podForm.storageAddress || undefined,
    };
    if (editPod) {
      updateMutation.mutate({ podId: editPod.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isSavingPod = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pods</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Geographic property clusters, storage addresses, and vendor directories
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => seedAddressesMutation.mutate()}
              disabled={seedAddressesMutation.isPending}
            >
              {seedAddressesMutation.isPending ? "Seeding…" : "Seed WNC Addresses"}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setPodForm(defaultPodForm);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Pod
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="pods">
        <TabsList>
          <TabsTrigger value="pods">Pods</TabsTrigger>
          <TabsTrigger value="memberships">Memberships</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>

        {/* ── Pods Tab ──────────────────────────────────────────────── */}
        <TabsContent value="pods" className="mt-4">
          {podsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading pods…</p>
          ) : pods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pods yet. Click "Add Pod" to create one, or "Seed WNC Addresses" to
              pre-populate the three WNC clusters.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pods.map((pod) => (
                <Card key={pod.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Hexagon className="h-4 w-4 text-indigo-500 shrink-0" />
                      <span className="truncate">{pod.name}</span>
                      {pod.region && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          {pod.region}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="flex items-start gap-1 text-xs">
                      <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                      {pod.storageAddress ? (
                        pod.storageAddress
                      ) : (
                        <span className="italic text-muted-foreground">No storage address set</span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-between">
                    <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                      {pod.propertyCount} {pod.propertyCount === 1 ? "property" : "properties"}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1.5 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => openEditPod(pod)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={calcDistancesMutation.isPending || !pod.storageAddress}
                          title={!pod.storageAddress ? "Set a storage address first" : "Calculate drive distances to all properties in this pod"}
                          onClick={() => calcDistancesMutation.mutate({ podId: pod.id })}
                        >
                          <Route className="h-3 w-3 mr-1" />
                          Calc Distances
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirmPod(pod)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Memberships Tab ──────────────────────────────────────── */}
        <TabsContent value="memberships" className="mt-4 space-y-3">
          {!isAdmin ? (
            <p className="text-sm text-muted-foreground">
              Admin access required to edit pod memberships.
            </p>
          ) : (
            <>
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="h-8 pl-7 text-sm"
                    placeholder="Search by name or city…"
                    value={membershipSearch}
                    onChange={(e) => setMembershipSearch(e.target.value)}
                  />
                </div>
                <Select
                  value={membershipPodFilter}
                  onValueChange={setMembershipPodFilter}
                >
                  <SelectTrigger className="w-52 h-8 text-sm">
                    <SelectValue placeholder="Filter by pod" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All pods</SelectItem>
                    <SelectItem value="unassigned">Unassigned only</SelectItem>
                    {pods.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground ml-auto">
                  {filteredMembershipProperties.length} of {properties.length}
                </span>
              </div>

              {/* Table */}
              {propertiesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading properties…</p>
              ) : properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active properties.</p>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-9">Property</TableHead>
                        <TableHead className="h-9">Location</TableHead>
                        <TableHead className="h-9 w-52">Pod</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMembershipProperties.map((prop) => {
                          const isSaving = savingIds.has(prop.id);
                          const currentValue = prop.podId === null ? "unassigned" : String(prop.podId);
                          const displayName = prop.internalName || prop.name;
                          const location = [prop.city, prop.state].filter(Boolean).join(", ");
                          return (
                            <TableRow key={prop.id}>
                              <TableCell className="py-2">
                                <span className="text-sm font-medium">{displayName}</span>
                                {prop.internalName && prop.name && prop.internalName !== prop.name && (
                                  <span className="block text-xs text-muted-foreground truncate">
                                    {prop.name}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-muted-foreground">
                                {location || <span className="italic">—</span>}
                              </TableCell>
                              <TableCell className="py-2">
                                <div className="flex items-center gap-2">
                                  <Select
                                    value={currentValue}
                                    onValueChange={(v) => {
                                      if (v !== currentValue) changePropertyPod(prop.id, v);
                                    }}
                                    disabled={isSaving}
                                  >
                                    <SelectTrigger className="h-8 text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="unassigned">
                                        <span className="italic text-muted-foreground">Unassigned</span>
                                      </SelectItem>
                                      {pods.map((p) => (
                                        <SelectItem key={p.id} value={String(p.id)}>
                                          {p.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {isSaving && (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Vendors Tab ───────────────────────────────────────────── */}
        <TabsContent value="vendors" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium shrink-0">Select Pod:</span>
            <Select
              value={selectedPodId ? String(selectedPodId) : ""}
              onValueChange={(v) => setSelectedPodId(Number(v))}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Choose a pod…" />
              </SelectTrigger>
              <SelectContent>
                {pods.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPodId && (
            <div className="space-y-4">
              {/* Vendor list */}
              {podDetailQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading vendors…</p>
              ) : vendors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No vendors for this pod yet.</p>
              ) : (
                <div className="grid gap-2">
                  {vendors.map((v) => (
                    <Card key={v.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium">{v.name}</span>
                            <Badge variant="secondary" className="text-xs capitalize">
                              {v.specialty.replace("_", " ")}
                            </Badge>
                          </div>
                          {v.company && (
                            <p className="text-xs text-muted-foreground">{v.company}</p>
                          )}
                          <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                            {v.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {v.phone}
                              </span>
                            )}
                            {v.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {v.email}
                              </span>
                            )}
                          </div>
                          {v.notes && (
                            <p className="text-xs text-muted-foreground">{v.notes}</p>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => openEditVendor(v)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              disabled={deleteVendorMutation.isPending}
                              onClick={() => deleteVendorMutation.mutate({ vendorId: v.id })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Add vendor form */}
              {isAdmin && (
                <Card className="p-4">
                  <p className="text-sm font-medium mb-3">Add Vendor</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Name *</Label>
                      <Input
                        className="h-8 text-sm mt-1"
                        placeholder="John's Plumbing"
                        value={vendorForm.name}
                        onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Specialty *</Label>
                      <Select
                        value={vendorForm.specialty}
                        onValueChange={(v) => setVendorForm((f) => ({ ...f, specialty: v }))}
                      >
                        <SelectTrigger className="h-8 text-sm mt-1">
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
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input
                        className="h-8 text-sm mt-1"
                        placeholder="(828) 555-0100"
                        value={vendorForm.phone}
                        onChange={(e) => setVendorForm((f) => ({ ...f, phone: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input
                        className="h-8 text-sm mt-1"
                        placeholder="vendor@example.com"
                        value={vendorForm.email}
                        onChange={(e) => setVendorForm((f) => ({ ...f, email: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Company</Label>
                      <Input
                        className="h-8 text-sm mt-1"
                        value={vendorForm.company}
                        onChange={(e) => setVendorForm((f) => ({ ...f, company: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Input
                        className="h-8 text-sm mt-1"
                        placeholder="Available Mon–Fri"
                        value={vendorForm.notes}
                        onChange={(e) => setVendorForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={!vendorForm.name || createVendorMutation.isPending}
                    onClick={() =>
                      createVendorMutation.mutate({
                        podId: selectedPodId,
                        name: vendorForm.name,
                        phone: vendorForm.phone || undefined,
                        email: vendorForm.email || undefined,
                        company: vendorForm.company || undefined,
                        specialty: vendorForm.specialty as
                          | "plumber"
                          | "electrician"
                          | "hvac"
                          | "handyman"
                          | "pest_control"
                          | "landscaper"
                          | "appliance_repair",
                        notes: vendorForm.notes || undefined,
                      })
                    }
                  >
                    {createVendorMutation.isPending ? "Adding…" : "Add Vendor"}
                  </Button>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Create / Edit Pod Dialog ───────────────────────────────── */}
      <Dialog
        open={createOpen || editPod !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditPod(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editPod ? "Edit Pod" : "Create Pod"}</DialogTitle>
            <DialogDescription>
              {editPod
                ? `Update settings for ${editPod.name}.`
                : "Add a new geographic property cluster."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input
                className="mt-1"
                placeholder="e.g. WNC-West"
                value={podForm.name}
                onChange={(e) => setPodForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Region</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Western NC"
                value={podForm.region}
                onChange={(e) => setPodForm((f) => ({ ...f, region: e.target.value }))}
              />
            </div>
            <div>
              <Label>Storage Address</Label>
              <Input
                className="mt-1"
                placeholder="Full street address (used for Google Maps distance calc)"
                value={podForm.storageAddress}
                onChange={(e) => setPodForm((f) => ({ ...f, storageAddress: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter the POD's supply storage location. Used to calculate drive distances to
                properties.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditPod(null);
              }}
            >
              Cancel
            </Button>
            <Button disabled={!podForm.name || isSavingPod} onClick={savePod}>
              {isSavingPod ? "Saving…" : editPod ? "Save Changes" : "Create Pod"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Vendor Dialog ─────────────────────────────────────── */}
      <Dialog
        open={editVendor !== null}
        onOpenChange={(open) => {
          if (!open) setEditVendor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Vendor</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                className="h-8 text-sm mt-1"
                value={vendorForm.name}
                onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Specialty</Label>
              <Select
                value={vendorForm.specialty}
                onValueChange={(v) => setVendorForm((f) => ({ ...f, specialty: v }))}
              >
                <SelectTrigger className="h-8 text-sm mt-1">
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
            <div>
              <Label className="text-xs">Phone</Label>
              <Input
                className="h-8 text-sm mt-1"
                value={vendorForm.phone}
                onChange={(e) => setVendorForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input
                className="h-8 text-sm mt-1"
                value={vendorForm.email}
                onChange={(e) => setVendorForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Company</Label>
              <Input
                className="h-8 text-sm mt-1"
                value={vendorForm.company}
                onChange={(e) => setVendorForm((f) => ({ ...f, company: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input
                className="h-8 text-sm mt-1"
                value={vendorForm.notes}
                onChange={(e) => setVendorForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVendor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!vendorForm.name || updateVendorMutation.isPending}
              onClick={() =>
                updateVendorMutation.mutate({
                  vendorId: editVendor!.id,
                  name: vendorForm.name,
                  phone: vendorForm.phone || undefined,
                  email: vendorForm.email || undefined,
                  company: vendorForm.company || undefined,
                  specialty: vendorForm.specialty as
                    | "plumber"
                    | "electrician"
                    | "hvac"
                    | "handyman"
                    | "pest_control"
                    | "landscaper"
                    | "appliance_repair",
                  notes: vendorForm.notes || undefined,
                })
              }
            >
              {updateVendorMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Pod Confirm Dialog ──────────────────────────────── */}
      <Dialog
        open={deleteConfirmPod !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmPod(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pod</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteConfirmPod?.name}"? Properties assigned to
              this pod will become unassigned, but no property data will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmPod(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteConfirmPod && deleteMutation.mutate({ podId: deleteConfirmPod.id })
              }
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Pod"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
