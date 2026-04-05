import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  BarChart2,
  BrainCircuit,
  Building2,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Hexagon,
  LayoutDashboard,
  ListTodo,
  Mail,
  Settings,
  Users,
  UsersRound,
  Wrench,
} from "lucide-react";

// Conductor's wand with AI sparkle — LeisrStays brand mark for Wand
function WandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Wand body — diagonal line from bottom-left to upper-right */}
      <line
        x1="5"
        y1="27"
        x2="22"
        y2="10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Wand handle — small rounded cap at bottom */}
      <circle cx="4.5" cy="27.5" r="2" fill="currentColor" opacity="0.7" />
      {/* Sparkle at tip — 4-point star */}
      <path
        d="M22 7 L23.2 9.8 L26 11 L23.2 12.2 L22 15 L20.8 12.2 L18 11 L20.8 9.8 Z"
        fill="#F08542"
        opacity="0.95"
      />
      {/* Tiny sparkle dot 1 */}
      <circle cx="27" cy="7" r="1" fill="#F08542" opacity="0.6" />
      {/* Tiny sparkle dot 2 */}
      <circle cx="25" cy="4" r="0.7" fill="#F08542" opacity="0.4" />
    </svg>
  );
}
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

export type NavItem = {
  icon: React.ElementType;
  label: string;
  path: string;
  /** Minimum role required: 'member' = all, 'manager' = manager+admin, 'admin' = admin only */
  minRole?: "member" | "manager" | "admin";
  children?: { label: string; path: string }[];
};

export const mainNavItems: NavItem[] = [
  { icon: ListTodo, label: "Tasks", path: "/" },
  { icon: BarChart2, label: "Analyze", path: "/analyze", minRole: "manager" },
  {
    icon: Building2,
    label: "Listings",
    path: "/listings",
    minRole: "manager",
    children: [
      { label: "All Properties", path: "/listings" },
      { label: "Reviews", path: "/listings/reviews" },
    ],
  },
  {
    icon: Wrench,
    label: "Breezeway",
    path: "/breezeway",
    minRole: "manager",
    children: [
      { label: "Properties", path: "/breezeway/properties" },
      { label: "Tasks & Cleans", path: "/breezeway/tasks" },
      { label: "Team", path: "/breezeway/team" },
    ],
  },
  {
    icon: DollarSign,
    label: "Billing",
    path: "/billing",
    minRole: "admin",
    children: [
      { label: "Run Billing", path: "/billing" },
      { label: "Customer Mapping", path: "/billing/customers" },
      { label: "Rate Card", path: "/billing/rate-card" },
    ],
  },
  {
    icon: Users,
    label: "Compensation",
    path: "/compensation",
    minRole: "admin",
    children: [
      { label: "Properties", path: "/compensation" },
      { label: "Cleaners", path: "/compensation" },
      { label: "Pay Calculator", path: "/compensation" },
    ],
  },
  {
    icon: Hexagon,
    label: "Pods",
    path: "/pods",
    minRole: "manager",
  },
];

/** Filter nav items based on user role */
function filterNavByRole(items: NavItem[], role: string | null): NavItem[] {
  if (!role) return items; // show all if role not loaded yet
  const roleLevel: Record<string, number> = { admin: 3, manager: 2, member: 1 };
  const userLevel = roleLevel[role] ?? 1;
  return items.filter((item) => {
    const requiredLevel = roleLevel[item.minRole || "member"] ?? 1;
    return userLevel >= requiredLevel;
  });
}

/** Footer nav items that are role-gated */
const footerNavItems: NavItem[] = [
  { icon: Settings, label: "Settings", path: "/settings", minRole: "admin" },
  { icon: UsersRound, label: "Team", path: "/team", minRole: "admin" },
];

const SIDEBAR_WIDTH_KEY = "wand-sidebar-width";
const DEFAULT_WIDTH = 200;
const MIN_WIDTH = 168;
const MAX_WIDTH = 280;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  // No auth gate — open access
  if (loading) {
    // Still show skeleton briefly while auth state resolves, but don't block
    // on unauthenticated state
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Filter nav items by user role
  const visibleNavItems = filterNavByRole(mainNavItems, permissions.role);
  const visibleFooterItems = filterNavByRole(footerNavItems, permissions.role);

  // Track which collapsible groups are open
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // Auto-open the group that contains the current path
    const initial: Record<string, boolean> = {};
    mainNavItems.forEach((item) => {
      if (item.children) {
        const isActive =
          location === item.path ||
          item.children.some((c) => location.startsWith(c.path));
        initial[item.path] = isActive;
      }
    });
    return initial;
  });

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft =
        sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  const isPathActive = (item: NavItem) => {
    if (item.children) {
      return (
        location === item.path ||
        item.children.some((c) => location.startsWith(c.path))
      );
    }
    return location === item.path;
  };

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0 bg-sidebar">
          {/* Header: Logo */}
          <SidebarHeader className="h-14 justify-center px-3">
            <button
              onClick={toggleSidebar}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity focus:outline-none w-full"
              aria-label="Toggle navigation"
            >
              <WandIcon className="h-7 w-7 text-sidebar-foreground shrink-0" />
              {!isCollapsed && (
                <span className="font-bold text-xl text-sidebar-foreground tracking-tight" style={{ fontFamily: 'Outfit, sans-serif', letterSpacing: '0.04em' }}>
                  Wand
                </span>
              )}
            </button>
          </SidebarHeader>

          {/* Nav items */}
          <SidebarContent className="gap-0 px-2 py-2">
            <SidebarMenu>
              {visibleNavItems.map((item) => {
                const active = isPathActive(item);
                if (item.children) {
                  return (
                    <Collapsible
                      key={item.path}
                      open={!isCollapsed && openGroups[item.path]}
                      onOpenChange={(open) =>
                        setOpenGroups((prev) => ({
                          ...prev,
                          [item.path]: open,
                        }))
                      }
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={active}
                            tooltip={item.label}
                            className="h-9 w-full font-normal text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
                            onClick={() => {
                              if (isCollapsed) {
                                setLocation(item.path);
                              }
                            }}
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1">{item.label}</span>
                            {!isCollapsed &&
                              (openGroups[item.path] ? (
                                <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/50" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/50" />
                              ))}
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.children.map((child) => {
                              const childActive = location === child.path || location.startsWith(child.path + "/");
                              return (
                                <SidebarMenuSubItem key={child.path}>
                                  <SidebarMenuSubButton
                                    isActive={childActive}
                                    onClick={() => setLocation(child.path)}
                                    className="text-sidebar-foreground/70 hover:text-sidebar-foreground data-[active=true]:text-sidebar-foreground data-[active=true]:bg-sidebar-accent/60"
                                  >
                                    {child.label}
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }

                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={active}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-9 font-normal text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          {/* Footer: Settings + Team + User */}
          <SidebarFooter className="px-2 py-2 gap-1">
            <SidebarMenu>
              {visibleFooterItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={location === item.path}
                    onClick={() => setLocation(item.path)}
                    tooltip={item.label}
                    className="h-9 font-normal text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>

            {/* Collapse toggle */}
            <button
              onClick={toggleSidebar}
              className="flex items-center justify-center h-7 w-7 rounded hover:bg-sidebar-accent transition-colors self-end text-sidebar-foreground/50 hover:text-sidebar-foreground"
              aria-label="Toggle sidebar"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
              />
            </button>

            {/* User */}
            <div className="flex items-center gap-2 px-1 py-1 mt-1">
              <Avatar className="h-8 w-8 shrink-0 bg-blue-600 text-white">
                {(user as any)?.avatarUrl && <AvatarImage src={(user as any).avatarUrl} alt={user?.name || ""} />}
                <AvatarFallback className="text-xs font-semibold bg-blue-600 text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-sidebar-foreground truncate leading-none">
                    {user?.name || "User"}
                  </p>
                  <p className="text-xs text-sidebar-foreground/50 truncate mt-0.5 capitalize">
                    {user?.role || "User"}
                  </p>
                </div>
              )}
            </div>
          </SidebarFooter>
        </Sidebar>

        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-sidebar-primary/30 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (!isCollapsed) setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-background">
        {isMobile && (
          <div className="flex border-b h-14 items-center px-4 bg-background sticky top-0 z-40">
            <SidebarTrigger className="h-9 w-9 rounded-lg" />
          </div>
        )}
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </>
  );
}
