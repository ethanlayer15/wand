import { useAuth } from "@/_core/hooks/useAuth";
import { useMemo } from "react";

export type UserRole = "admin" | "manager" | "member";

export interface Permissions {
  role: UserRole | null;
  isAdmin: boolean;
  isManager: boolean;
  isMember: boolean;
  isManagerOrAbove: boolean;

  // Feature-level permissions
  canViewDashboard: boolean;
  canViewAllTasks: boolean;
  canAssignTasks: boolean;
  canDragAnyTask: boolean;
  canPushToBreezeway: boolean;
  canRunPipeline: boolean;
  canViewAnalyze: boolean;
  canViewListings: boolean;
  canViewBreezeway: boolean;
  canViewBilling: boolean;
  canViewCompensation: boolean;
  canViewViv: boolean;
  canViewSettings: boolean;
  canManageTeam: boolean;
}

export function usePermissions(): Permissions {
  const { user } = useAuth();

  return useMemo(() => {
    const role = (user?.role as UserRole) || null;
    const isAdmin = role === "admin";
    const isManager = role === "manager";
    const isMember = role === "member";
    const isManagerOrAbove = isAdmin || isManager;

    return {
      role,
      isAdmin,
      isManager,
      isMember,
      isManagerOrAbove,

      // Dashboard: all roles, but members see limited data
      canViewDashboard: true,
      // Tasks: all roles, but members only see assigned
      canViewAllTasks: isManagerOrAbove,
      canAssignTasks: isManagerOrAbove,
      canDragAnyTask: isManagerOrAbove,
      canPushToBreezeway: isManagerOrAbove,
      canRunPipeline: isManagerOrAbove,
      // Analyze, Listings, Breezeway: manager+
      canViewAnalyze: isManagerOrAbove,
      canViewListings: isManagerOrAbove,
      canViewBreezeway: isManagerOrAbove,
      // Billing, Compensation, Viv, Settings, Team: admin only
      canViewBilling: isAdmin,
      canViewCompensation: isAdmin,
      canViewViv: isAdmin,
      canViewSettings: isAdmin,
      canManageTeam: isAdmin,
    };
  }, [user?.role]);
}
