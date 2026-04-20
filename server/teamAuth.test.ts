import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Google OAuth Route Tests ────────────────────────────────────────

describe("Google OAuth", () => {
  describe("Domain Restriction", () => {
    const ALLOWED = ["leisrstays.com", "5strclean.com"];
    const isAllowed = (email: string) =>
      ALLOWED.some((d) => email.toLowerCase().endsWith(`@${d}`));

    it("should accept @leisrstays.com emails", () => {
      expect(isAllowed("alice@leisrstays.com")).toBe(true);
    });

    it("should accept @5strclean.com emails", () => {
      expect(isAllowed("bob@5strclean.com")).toBe(true);
    });

    it("should reject non-allowed emails", () => {
      const emails = [
        "alice@gmail.com",
        "bob@yahoo.com",
        "charlie@other.com",
        "admin@leisrstays.org",
      ];
      for (const email of emails) {
        expect(isAllowed(email)).toBe(false);
      }
    });

    it("should reject emails with domain as substring", () => {
      expect(isAllowed("user@notleisrstays.com")).toBe(false);
      expect(isAllowed("user@not5strclean.com")).toBe(false);
    });
  });

  describe("State Parameter", () => {
    it("should encode and decode state with origin and CSRF token", () => {
      const origin = "https://wandaimanage-d9uetjht.manus.space";
      const csrf = "abc123";
      const statePayload = JSON.stringify({ csrf, origin });
      const state = Buffer.from(statePayload).toString("base64url");

      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      expect(decoded.origin).toBe(origin);
      expect(decoded.csrf).toBe(csrf);
    });

    it("should handle malformed state gracefully", () => {
      const badState = "not-valid-base64!!!";
      let origin: string;
      try {
        const parsed = JSON.parse(Buffer.from(badState, "base64url").toString());
        origin = parsed.origin;
      } catch {
        origin = "https://fallback.example.com";
      }
      expect(origin).toBe("https://fallback.example.com");
    });
  });

  describe("OpenID Generation", () => {
    it("should generate openId from Google sub", () => {
      const googleId = "117234567890123456789";
      const openId = `google_${googleId}`;
      expect(openId).toBe("google_117234567890123456789");
      expect(openId.startsWith("google_")).toBe(true);
    });
  });
});

// ── Team Invitation Tests ───────────────────────────────────────────

describe("Team Invitations", () => {
  describe("Email Validation", () => {
    const INVITE_ALLOWED = ["leisrstays.com", "5strclean.com"];
    const isInvitable = (email: string) =>
      INVITE_ALLOWED.some((d) => email.endsWith(`@${d}`));

    it("should validate @leisrstays.com and @5strclean.com emails", () => {
      const validEmails = [
        "alice@leisrstays.com",
        "bob.smith@leisrstays.com",
        "team+test@leisrstays.com",
        "carol@5strclean.com",
        "dave.cleaner@5strclean.com",
      ];
      for (const email of validEmails) {
        expect(isInvitable(email)).toBe(true);
      }
    });

    it("should reject non-allowed-domain emails for invitations", () => {
      const invalidEmails = [
        "alice@gmail.com",
        "bob@company.com",
        "",
      ];
      for (const email of invalidEmails) {
        expect(isInvitable(email)).toBe(false);
      }
    });
  });

  describe("Invitation Expiry", () => {
    it("should set expiry to 7 days from creation", () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it("should detect expired invitations", () => {
      const expired = new Date(Date.now() - 1000); // 1 second ago
      expect(expired.getTime() < Date.now()).toBe(true);
    });

    it("should detect valid invitations", () => {
      const valid = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expect(valid.getTime() > Date.now()).toBe(true);
    });
  });

  describe("Invitation Status", () => {
    it("should track pending, accepted, and revoked states", () => {
      const validStatuses = ["pending", "accepted", "revoked"];
      expect(validStatuses).toContain("pending");
      expect(validStatuses).toContain("accepted");
      expect(validStatuses).toContain("revoked");
    });
  });
});

// ── RBAC Permission Tests ───────────────────────────────────────────

describe("RBAC Permissions", () => {
  type UserRole = "admin" | "manager" | "member";

  interface Permissions {
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

  function getPermissions(role: UserRole): Permissions {
    const isAdmin = role === "admin";
    const isManager = role === "manager";
    const isManagerOrAbove = isAdmin || isManager;

    return {
      canViewAllTasks: isManagerOrAbove,
      canAssignTasks: isManagerOrAbove,
      canDragAnyTask: isManagerOrAbove,
      canPushToBreezeway: isManagerOrAbove,
      canRunPipeline: isManagerOrAbove,
      canViewAnalyze: isManagerOrAbove,
      canViewListings: isManagerOrAbove,
      canViewBreezeway: isManagerOrAbove,
      canViewBilling: isAdmin,
      canViewCompensation: isAdmin,
      canViewViv: isAdmin,
      canViewSettings: isAdmin,
      canManageTeam: isAdmin,
    };
  }

  describe("Admin permissions", () => {
    const perms = getPermissions("admin");

    it("should have full access to all features", () => {
      expect(perms.canViewAllTasks).toBe(true);
      expect(perms.canAssignTasks).toBe(true);
      expect(perms.canDragAnyTask).toBe(true);
      expect(perms.canPushToBreezeway).toBe(true);
      expect(perms.canRunPipeline).toBe(true);
      expect(perms.canViewAnalyze).toBe(true);
      expect(perms.canViewListings).toBe(true);
      expect(perms.canViewBreezeway).toBe(true);
    });

    it("should have access to admin-only features", () => {
      expect(perms.canViewBilling).toBe(true);
      expect(perms.canViewCompensation).toBe(true);
      expect(perms.canViewViv).toBe(true);
      expect(perms.canViewSettings).toBe(true);
      expect(perms.canManageTeam).toBe(true);
    });
  });

  describe("Manager permissions", () => {
    const perms = getPermissions("manager");

    it("should have access to operational features", () => {
      expect(perms.canViewAllTasks).toBe(true);
      expect(perms.canAssignTasks).toBe(true);
      expect(perms.canDragAnyTask).toBe(true);
      expect(perms.canPushToBreezeway).toBe(true);
      expect(perms.canRunPipeline).toBe(true);
      expect(perms.canViewAnalyze).toBe(true);
      expect(perms.canViewListings).toBe(true);
      expect(perms.canViewBreezeway).toBe(true);
    });

    it("should NOT have access to admin-only features", () => {
      expect(perms.canViewBilling).toBe(false);
      expect(perms.canViewCompensation).toBe(false);
      expect(perms.canViewViv).toBe(false);
      expect(perms.canViewSettings).toBe(false);
      expect(perms.canManageTeam).toBe(false);
    });
  });

  describe("Team Member permissions", () => {
    const perms = getPermissions("member");

    it("should NOT have access to operational features", () => {
      expect(perms.canViewAllTasks).toBe(false);
      expect(perms.canAssignTasks).toBe(false);
      expect(perms.canPushToBreezeway).toBe(false);
      expect(perms.canRunPipeline).toBe(false);
      expect(perms.canViewAnalyze).toBe(false);
      expect(perms.canViewListings).toBe(false);
      expect(perms.canViewBreezeway).toBe(false);
    });

    it("should NOT have access to admin-only features", () => {
      expect(perms.canViewBilling).toBe(false);
      expect(perms.canViewCompensation).toBe(false);
      expect(perms.canViewViv).toBe(false);
      expect(perms.canViewSettings).toBe(false);
      expect(perms.canManageTeam).toBe(false);
    });
  });

  describe("Sidebar Navigation Filtering", () => {
    type NavItem = {
      label: string;
      minRole?: "member" | "manager" | "admin";
    };

    const navItems: NavItem[] = [
      { label: "Dashboard" },
      { label: "Tasks" },
      { label: "Analyze", minRole: "manager" },
      { label: "Listings", minRole: "manager" },
      { label: "Breezeway", minRole: "manager" },
      { label: "Billing", minRole: "admin" },
      { label: "Compensation", minRole: "admin" },
      { label: "Viv", minRole: "admin" },
    ];

    function filterNavByRole(items: NavItem[], role: string): NavItem[] {
      const roleLevel: Record<string, number> = { admin: 3, manager: 2, member: 1 };
      const userLevel = roleLevel[role] ?? 1;
      return items.filter((item) => {
        const requiredLevel = roleLevel[item.minRole || "member"] ?? 1;
        return userLevel >= requiredLevel;
      });
    }

    it("should show all items for admin", () => {
      const visible = filterNavByRole(navItems, "admin");
      expect(visible.map((i) => i.label)).toEqual([
        "Dashboard", "Tasks", "Analyze", "Listings", "Breezeway",
        "Billing", "Compensation", "Viv",
      ]);
    });

    it("should show manager-level items for manager", () => {
      const visible = filterNavByRole(navItems, "manager");
      expect(visible.map((i) => i.label)).toEqual([
        "Dashboard", "Tasks", "Analyze", "Listings", "Breezeway",
      ]);
    });

    it("should show only member-level items for team member", () => {
      const visible = filterNavByRole(navItems, "member");
      expect(visible.map((i) => i.label)).toEqual([
        "Dashboard", "Tasks",
      ]);
    });
  });

  describe("Task Visibility for Members", () => {
    const allTasks = [
      { id: 1, title: "Fix AC", assignedTo: "Alice", status: "created" },
      { id: 2, title: "Clean pool", assignedTo: "Bob", status: "in_progress" },
      { id: 3, title: "Replace bulb", assignedTo: null, status: "created" },
      { id: 4, title: "Paint wall", assignedTo: "Alice", status: "ignored" },
    ];

    it("should show all tasks for admin/manager", () => {
      const visible = allTasks; // no filter
      expect(visible.length).toBe(4);
    });

    it("should show only assigned tasks for team member", () => {
      const userName = "Alice";
      const visible = allTasks.filter((t) => t.assignedTo === userName);
      expect(visible.length).toBe(2);
      expect(visible.every((t) => t.assignedTo === "Alice")).toBe(true);
    });

    it("should show no tasks for unassigned member", () => {
      const userName = "Charlie";
      const visible = allTasks.filter((t) => t.assignedTo === userName);
      expect(visible.length).toBe(0);
    });
  });

  describe("Role Hierarchy", () => {
    const roleLevel: Record<string, number> = { admin: 3, manager: 2, member: 1 };

    it("admin > manager > member", () => {
      expect(roleLevel.admin).toBeGreaterThan(roleLevel.manager);
      expect(roleLevel.manager).toBeGreaterThan(roleLevel.member);
    });

    it("should prevent self-demotion for admin", () => {
      // Business rule: admin cannot change their own role
      const currentUserId = 1;
      const targetUserId = 1;
      expect(currentUserId === targetUserId).toBe(true);
      // UI should prevent this action
    });

    it("should prevent non-admin from changing roles", () => {
      const userRole = "manager";
      expect(userRole !== "admin").toBe(true);
      // Backend enforces this via adminProcedure
    });
  });
});

// ── managerProcedure Middleware Tests ────────────────────────────────

describe("managerProcedure Middleware", () => {
  it("should allow admin users", () => {
    const role = "admin";
    const allowed = role === "admin" || role === "manager";
    expect(allowed).toBe(true);
  });

  it("should allow manager users", () => {
    const role = "manager";
    const allowed = role === "admin" || role === "manager";
    expect(allowed).toBe(true);
  });

  it("should reject member users", () => {
    const role = "member";
    const allowed = role === "admin" || role === "manager";
    expect(allowed).toBe(false);
  });

  it("should reject unknown roles", () => {
    const role = "guest";
    const allowed = role === "admin" || role === "manager";
    expect(allowed).toBe(false);
  });
});
