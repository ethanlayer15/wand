import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/hooks/usePermissions";
import { Users, UserPlus, Mail, Shield, Trash2, MoreVertical } from "lucide-react";
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
    onSuccess: () => {
      toast.success("Invitation sent");
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
