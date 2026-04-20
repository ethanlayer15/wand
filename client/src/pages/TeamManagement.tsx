import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/hooks/usePermissions";
import { Users, UserPlus, Mail, Shield, Trash2, MoreVertical, Slack as SlackIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export default function TeamManagement() {
  const { isAdmin } = usePermissions();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [inviteOpen, setInviteOpen] = useState(false);

  const membersQuery = trpc.team.members.useQuery();
  const invitationsQuery = trpc.team.invitations.useQuery();

  const inviteMutation = trpc.team.invite.useMutation({
    onSuccess: (data) => {
      if (data.inviteUrl) {
        navigator.clipboard.writeText(data.inviteUrl).then(() => {
          toast.success("Invite link copied to clipboard! Share it with the invitee.");
        }).catch(() => {
          toast.success(`Invitation created. Share this link: ${data.inviteUrl}`);
        });
      } else {
        toast.success("Invitation sent");
      }
      setInviteEmail("");
      setInviteOpen(false);
      invitationsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const changeRoleMutation = trpc.team.changeRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      membersQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMemberMutation = trpc.team.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      membersQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeInvitationMutation = trpc.team.revokeInvitation.useMutation({
    onSuccess: () => {
      toast.success("Invitation revoked");
      invitationsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const members = membersQuery.data ?? [];
  const invitations = invitationsQuery.data ?? [];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            Team Management
          </h1>
          <p className="text-muted-foreground mt-1">Manage team members and invitations</p>
        </div>
        {isAdmin && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>Send an invitation to join the team.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@leisrstays.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole as "manager" | "member", origin: window.location.origin })}
                  disabled={!inviteEmail || inviteMutation.isPending}
                >
                  {inviteMutation.isPending ? "Sending…" : "Send Invitation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>{members.length} team member{members.length !== 1 ? "s" : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last Sign In</TableHead>
                {isAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member: any) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{member.name || "—"}</div>
                      <div className="text-sm text-muted-foreground">{member.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          changeRoleMutation.mutate({ userId: member.id, role })
                        }
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="capitalize">{member.role}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.lastSignedIn
                      ? new Date(member.lastSignedIn).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              if (confirm(`Remove ${member.name || member.email} from the team?`)) {
                                removeMemberMutation.mutate({ userId: member.id });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Slack User Linking (Phase 2) */}
      <SlackLinkingCard members={members} isAdmin={isAdmin} />

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited</TableHead>
                  {isAdmin && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv: any) => (
                  <TableRow key={inv.id}>
                    <TableCell className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      {inv.email}
                    </TableCell>
                    <TableCell className="capitalize">{inv.role}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => revokeInvitationMutation.mutate({ invitationId: inv.id })}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Slack User Linking ────────────────────────────────────────────────

function SlackLinkingCard({
  members,
  isAdmin,
}: {
  members: any[];
  isAdmin: boolean;
}) {
  const linksQuery = trpc.slackLinks.list.useQuery();
  const autoMatchMut = trpc.slackLinks.autoMatch.useMutation({
    onSuccess: (data: any) => {
      const summary = `Auto-match: ${data.matched} matched, ${data.alreadyLinked} already linked, ${data.skippedNoSlack} no Slack account, ${data.skippedNoEmail} no email${
        data.failed ? `, ${data.failed} failed` : ""
      }`;
      if (data.failed && data.errors?.length > 0) {
        toast.error(summary);
        for (const e of data.errors.slice(0, 3)) {
          toast.error(`${e.email}: ${e.error}`);
        }
      } else {
        toast.success(summary);
      }
      linksQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const upsertMut = trpc.slackLinks.upsert.useMutation({
    onSuccess: () => {
      toast.success("Link saved");
      linksQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMut = trpc.slackLinks.delete.useMutation({
    onSuccess: () => {
      toast.success("Link removed");
      linksQuery.refetch();
    },
  });

  const links = linksQuery.data ?? [];
  const linkedUserIds = new Set(links.map((l: any) => l.userId));
  const unlinkedMembers = members.filter((m) => !linkedUserIds.has(m.id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <SlackIcon className="w-5 h-5" />
            Slack User Linking
          </CardTitle>
          <CardDescription>
            Connects each Wand user to their Slack account so Wanda + Starry can
            identify them in DMs and surface their tasks.
          </CardDescription>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoMatchMut.mutate({ force: false })}
            disabled={autoMatchMut.isPending}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${autoMatchMut.isPending ? "animate-spin" : ""}`}
            />
            Auto-match by email
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Slack links yet. Click <em>Auto-match by email</em> to connect
            everyone whose Slack email matches their Wand email.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wand User</TableHead>
                <TableHead>Slack User ID</TableHead>
                <TableHead>Workspace</TableHead>
                {isAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.userName || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.userEmail}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.slackUserId}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {l.workspaceId}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm("Remove this Slack link?"))
                            deleteMut.mutate({ id: l.id });
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {isAdmin && unlinkedMembers.length > 0 && (
          <ManualLinkRow members={unlinkedMembers} onSubmit={upsertMut.mutate} />
        )}
      </CardContent>
    </Card>
  );
}

function ManualLinkRow({
  members,
  onSubmit,
}: {
  members: any[];
  onSubmit: (input: {
    userId: number;
    workspaceId: string;
    slackUserId: string;
  }) => void;
}) {
  const [userId, setUserId] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [slackUserId, setSlackUserId] = useState<string>("");

  const submit = () => {
    if (!userId || !workspaceId || !slackUserId) {
      toast.error("All three fields required");
      return;
    }
    onSubmit({
      userId: Number(userId),
      workspaceId: workspaceId.trim(),
      slackUserId: slackUserId.trim(),
    });
    setUserId("");
    setSlackUserId("");
  };

  return (
    <div className="border-t pt-4">
      <p className="text-xs text-muted-foreground mb-2">
        Or link manually (e.g. for someone whose Slack email differs):
      </p>
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs">Wand user</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Pick a member" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m: any) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name || m.email || `user #${m.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs">Workspace ID</Label>
          <Input
            placeholder="T01ABC2DE3"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs">Slack User ID</Label>
          <Input
            placeholder="U01ABC2DE3"
            value={slackUserId}
            onChange={(e) => setSlackUserId(e.target.value)}
            className="h-9"
          />
        </div>
        <Button onClick={submit} size="sm">
          Link
        </Button>
      </div>
    </div>
  );
}
