/**
 * On-Call Schedule — single-screen admin page (Phase 1).
 *
 * Lets ops set who is on call for each department/role at any given time.
 * Wanda + Starry read this to route escalations.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CalendarClock, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const DEPARTMENTS = [
  { value: "leisr_ops", label: "Leisr Ops" },
  { value: "leisr_mgmt", label: "Leisr Mgmt" },
  { value: "fivestr_ops", label: "5STR Ops" },
] as const;

const ROLES = [
  { value: "primary", label: "Primary" },
  { value: "backup", label: "Backup" },
  { value: "guest_relations", label: "Guest Relations" },
] as const;

type Department = (typeof DEPARTMENTS)[number]["value"];

function toDateInputValue(d?: Date | string | null) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  // YYYY-MM-DDTHH:mm for datetime-local
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function OnCall() {
  const [filterDept, setFilterDept] = useState<Department | "all">("all");
  const [editing, setEditing] = useState<null | {
    id?: number;
    department: Department;
    role: string;
    userId: number | null;
    startsAt: string;
    endsAt: string;
    notes: string;
    slackUserId: string;
  }>(null);

  const teamQuery = trpc.team.members.useQuery();
  const shiftsQuery = trpc.onCall.list.useQuery(
    filterDept === "all" ? undefined : { department: filterDept }
  );
  const upsert = trpc.onCall.upsertShift.useMutation({
    onSuccess: () => {
      shiftsQuery.refetch();
      setEditing(null);
      toast.success("Shift saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.onCall.deleteShift.useMutation({
    onSuccess: () => {
      shiftsQuery.refetch();
      toast.success("Shift deleted");
    },
  });

  const usersById = useMemo(() => {
    const map = new Map<number, { name: string | null; email: string | null }>();
    (teamQuery.data ?? []).forEach((u: any) =>
      map.set(u.id, { name: u.name, email: u.email })
    );
    return map;
  }, [teamQuery.data]);

  function newShift(): NonNullable<typeof editing> {
    const now = new Date();
    const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      department: "leisr_ops",
      role: "primary",
      userId: null,
      startsAt: toDateInputValue(now),
      endsAt: toDateInputValue(inAWeek),
      notes: "",
      slackUserId: "",
    };
  }

  function handleSave() {
    if (!editing) return;
    if (!editing.userId) {
      toast.error("Pick a team member");
      return;
    }
    const startsAt = new Date(editing.startsAt);
    const endsAt = new Date(editing.endsAt);
    if (!(startsAt instanceof Date) || isNaN(startsAt.getTime())) {
      toast.error("Invalid start time");
      return;
    }
    if (endsAt <= startsAt) {
      toast.error("End must be after start");
      return;
    }
    upsert.mutate({
      id: editing.id,
      department: editing.department,
      role: editing.role,
      userId: editing.userId,
      startsAt,
      endsAt,
      notes: editing.notes || undefined,
      slackUserId: editing.slackUserId || undefined,
    });
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-orange-500" />
            <h1 className="text-2xl font-semibold">On-Call Schedule</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            The single source of truth Wanda &amp; Starry read when routing escalations.
          </p>
        </div>
        <Button onClick={() => setEditing(newShift())}>
          <Plus className="h-4 w-4 mr-2" />
          Add Shift
        </Button>
      </div>

      {/* Current on-call summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {DEPARTMENTS.map((d) => (
          <CurrentOnCallCard key={d.value} department={d.value} label={d.label} />
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>All Shifts</CardTitle>
            <CardDescription>Past, current, and future shifts.</CardDescription>
          </div>
          <Select
            value={filterDept}
            onValueChange={(v) => setFilterDept(v as any)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {shiftsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (shiftsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shifts yet. Click <em>Add Shift</em> to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(shiftsQuery.data ?? []).map((s: any) => {
                  const dept = DEPARTMENTS.find((d) => d.value === s.department);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant="secondary">{dept?.label ?? s.department}</Badge>
                      </TableCell>
                      <TableCell className="capitalize">{s.role}</TableCell>
                      <TableCell>
                        {s.userName || s.userEmail || `user #${s.userId}`}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(s.startsAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(s.endsAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setEditing({
                              id: s.id,
                              department: s.department,
                              role: s.role,
                              userId: s.userId,
                              startsAt: toDateInputValue(s.startsAt),
                              endsAt: toDateInputValue(s.endsAt),
                              notes: s.notes ?? "",
                              slackUserId: s.slackUserId ?? "",
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Delete this shift?"))
                              remove.mutate({ id: s.id });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Shift" : "New Shift"}</DialogTitle>
            <DialogDescription>
              When this shift is active, the assigned person is the on-call contact for routing.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Department</Label>
                  <Select
                    value={editing.department}
                    onValueChange={(v) =>
                      setEditing({ ...editing, department: v as Department })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Role</Label>
                  <Select
                    value={editing.role}
                    onValueChange={(v) => setEditing({ ...editing, role: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Person</Label>
                <Select
                  value={editing.userId ? String(editing.userId) : ""}
                  onValueChange={(v) =>
                    setEditing({ ...editing, userId: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a team member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(teamQuery.data ?? []).map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name || u.email || `user #${u.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Starts</Label>
                  <Input
                    type="datetime-local"
                    value={editing.startsAt}
                    onChange={(e) =>
                      setEditing({ ...editing, startsAt: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Ends</Label>
                  <Input
                    type="datetime-local"
                    value={editing.endsAt}
                    onChange={(e) =>
                      setEditing({ ...editing, endsAt: e.target.value })
                    }
                  />
                </div>
              </div>

              <div>
                <Label>Slack User ID (optional)</Label>
                <Input
                  placeholder="U01ABCD2EF (for DM routing)"
                  value={editing.slackUserId}
                  onChange={(e) =>
                    setEditing({ ...editing, slackUserId: e.target.value })
                  }
                />
              </div>

              <div>
                <Label>Notes (optional)</Label>
                <Input
                  value={editing.notes}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CurrentOnCallCard({
  department,
  label,
}: {
  department: Department;
  label: string;
}) {
  const q = trpc.onCall.getCurrent.useQuery({
    department,
    role: "primary",
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label} — Primary
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : q.data ? (
          <div>
            <p className="text-lg font-semibold">
              {q.data.userName || q.data.userEmail || `user #${q.data.userId}`}
            </p>
            <p className="text-xs text-muted-foreground">
              Until {new Date(q.data.endsAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No one assigned</p>
        )}
      </CardContent>
    </Card>
  );
}
