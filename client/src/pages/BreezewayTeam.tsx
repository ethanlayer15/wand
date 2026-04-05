import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, User } from "lucide-react";

export default function BreezewayTeam() {
  const { data: team, isLoading } = trpc.breezeway.team.list.useQuery();

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="wand-page-title">Breezeway Team</h1>
        <p className="text-sm text-muted-foreground">
          {team?.length || 0} team members synced from Breezeway
        </p>
      </div>

      {/* Team list */}
      <div className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : team && team.length > 0 ? (
          team.map((member) => {
            const initials = `${member.firstName?.charAt(0) || ""}${member.lastName?.charAt(0) || ""}`.toUpperCase();
            return (
              <Card
                key={member.id}
                className="p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <Avatar className="h-10 w-10 bg-blue-600 text-white">
                    <AvatarFallback className="bg-blue-600 text-white font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">
                      {member.firstName} {member.lastName}
                    </h3>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      {member.email && (
                        <div className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          {member.email}
                        </div>
                      )}
                      {member.role && (
                        <div className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {member.role}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded ${
                        member.active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {member.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No team members synced yet. Configure Breezeway in Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
