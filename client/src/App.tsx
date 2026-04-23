import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
// Dashboard removed — Tasks board is now the home page
import Tasks from "@/pages/Tasks";
import Analyze from "@/pages/Analyze";
import Listings from "@/pages/Listings";
import Settings from "@/pages/Settings";
import BreezewayProperties from "@/pages/BreezewayProperties";
import BreezewayTasks from "@/pages/BreezewayTasks";
import BreezewayTeam from "@/pages/BreezewayTeam";
import Billing from "@/pages/Billing";
import BillingCustomers from "@/pages/BillingCustomers";
import BillingRateCard from "@/pages/BillingRateCard";
import Compensation from "@/pages/Compensation";
import Pods from "@/pages/Pods";
import Login from "@/pages/Login";
import TeamManagement from "@/pages/TeamManagement";
import NotFound from "@/pages/NotFound";
import CleanerDashboard from "@/pages/CleanerDashboard";
import OpsInbox from "@/pages/OpsInbox";
import OnCall from "@/pages/OnCall";
import OnboardingList from "@/pages/OnboardingList";
import OnboardingProject from "@/pages/OnboardingProject";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffect } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/**
 * Route guard component that checks role permissions.
 * If the user doesn't have the required role, redirects to their default page.
 */
function RequireRole({
  minRole,
  children,
}: {
  minRole: "member" | "manager" | "admin";
  children: React.ReactNode;
}) {
  const { role } = usePermissions();
  const [, setLocation] = useLocation();

  const roleLevel: Record<string, number> = { admin: 3, manager: 2, member: 1 };
  const userLevel = roleLevel[role || "member"] ?? 1;
  const requiredLevel = roleLevel[minRole] ?? 1;

  useEffect(() => {
    if (role && userLevel < requiredLevel) {
      toast.error("You don't have permission to access this page");
      setLocation("/");
    }
  }, [role, userLevel, requiredLevel, setLocation]);

  if (!role) return null; // loading
  if (userLevel < requiredLevel) return null;
  return <>{children}</>;
}

/**
 * Deep link component: navigates to the Tasks board and opens the task detail sheet.
 * Uses a URL search param so the Tasks page can pick it up.
 */
function TaskDeepLink({ taskId }: { taskId: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(`/?openTask=${taskId}`);
  }, [taskId, setLocation]);
  return null;
}

function Router() {
  return (
    <>
      <Switch>
        {/* Login page — no sidebar */}
        <Route path="/login">
          <Login />
        </Route>

        {/* Cleaner dashboard — public, no auth, no sidebar */}
        <Route path="/cleaner/:token">
          {(params: { token: string }) => <CleanerDashboard token={params.token} />}
        </Route>

        {/* Standard Wand routes */}
        <Route>
          <DashboardLayout>
            <Switch>
              <Route path="/" component={Tasks} />
              <Route path="/tasks">
                <Redirect to="/" />
              </Route>

              {/* Manager+ routes */}
              <Route path="/analyze">
                <RequireRole minRole="manager"><Analyze /></RequireRole>
              </Route>
              <Route path="/listings">
                <RequireRole minRole="manager"><Listings /></RequireRole>
              </Route>
              <Route path="/listings/reviews">
                <RequireRole minRole="manager"><Listings /></RequireRole>
              </Route>
              <Route path="/breezeway/properties">
                <RequireRole minRole="manager"><BreezewayProperties /></RequireRole>
              </Route>
              <Route path="/breezeway/tasks">
                <RequireRole minRole="manager"><BreezewayTasks /></RequireRole>
              </Route>
              <Route path="/breezeway/team">
                <RequireRole minRole="manager"><BreezewayTeam /></RequireRole>
              </Route>

              {/* Admin-only routes */}
              <Route path="/billing">
                <RequireRole minRole="admin"><Billing /></RequireRole>
              </Route>
              <Route path="/billing/customers">
                <RequireRole minRole="admin"><BillingCustomers /></RequireRole>
              </Route>
              <Route path="/billing/rate-card">
                <RequireRole minRole="admin"><BillingRateCard /></RequireRole>
              </Route>
              <Route path="/compensation">
                <RequireRole minRole="admin"><Compensation /></RequireRole>
              </Route>
              <Route path="/pods">
                <RequireRole minRole="manager"><Pods /></RequireRole>
              </Route>
              <Route path="/ops-inbox">
                <OpsInbox />
              </Route>
              <Route path="/on-call">
                <RequireRole minRole="manager"><OnCall /></RequireRole>
              </Route>
              <Route path="/onboarding" component={OnboardingList} />
              <Route path="/onboarding/:id">
                {(params: { id: string }) => <OnboardingProject id={Number(params.id)} />}
              </Route>
              <Route path="/settings">
                <RequireRole minRole="admin"><Settings /></RequireRole>
              </Route>
              <Route path="/team">
                <RequireRole minRole="admin"><TeamManagement /></RequireRole>
              </Route>

              <Route path="/task/:id">
                {(params: { id: string }) => <TaskDeepLink taskId={params.id} />}
              </Route>
              <Route path="/404" component={NotFound} />
              <Route component={NotFound} />
            </Switch>
          </DashboardLayout>
        </Route>
      </Switch>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
