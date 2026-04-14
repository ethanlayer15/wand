import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, Clock, RefreshCw, Loader2, Power, PowerOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const { data: integrations, isLoading, refetch } =
    trpc.integrations.list.useQuery();

  const [syncInProgress, setSyncInProgress] = useState<string | null>(null);

  // Breezeway task sync state
  const { data: bwSyncStatus, refetch: refetchBwSync } =
    trpc.breezeway.taskSync.status.useQuery();

  const activateSyncMutation = trpc.breezeway.taskSync.activate.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(
          `Breezeway task sync activated! Leisr Stays assignee ID: ${data.assigneeId}. Tasks will now appear on the board.`
        );
      } else {
        toast.error(`Failed to activate sync: ${data.error}`);
      }
      refetchBwSync();
      refetch();
    },
    onError: (err) => {
      toast.error(`Activation failed: ${err.message}`);
    },
  });

  const deactivateSyncMutation = trpc.breezeway.taskSync.deactivate.useMutation({
    onSuccess: () => {
      toast.success("Breezeway task sync deactivated");
      refetchBwSync();
      refetch();
    },
    onError: (err) => {
      toast.error(`Deactivation failed: ${err.message}`);
    },
  });

  const manualPollMutation = trpc.breezeway.taskSync.poll.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Manual poll complete: ${data.created} created, ${data.updated} updated, ${data.hidden} hidden`
      );
      refetchBwSync();
    },
    onError: (err) => {
      toast.error(`Poll failed: ${err.message}`);
    },
  });

  // Sync mutations
  const syncAllMutation = trpc.integrations.syncAll.useMutation({
    onSuccess: () => {
      toast.success("Full sync completed successfully");
      setSyncInProgress(null);
      refetch();
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err.message}`);
      setSyncInProgress(null);
    },
  });

  const syncHostawayListingsMutation =
    trpc.integrations.syncHostawayListings.useMutation({
      onSuccess: (data) => {
        toast.success(
          `Synced ${data.synced} listings${data.errors > 0 ? ` (${data.errors} errors)` : ""}`
        );
        setSyncInProgress(null);
        refetch();
      },
      onError: (err) => {
        toast.error(`Failed to sync listings: ${err.message}`);
        setSyncInProgress(null);
      },
    });

  const syncHostawayReviewsMutation =
    trpc.integrations.syncHostawayReviews.useMutation({
      onSuccess: (data) => {
        toast.success(
          `Synced ${data.synced} reviews${data.errors > 0 ? ` (${data.errors} errors)` : ""}`
        );
        setSyncInProgress(null);
        refetch();
      },
      onError: (err) => {
        toast.error(`Failed to sync reviews: ${err.message}`);
        setSyncInProgress(null);
      },
    });

  const syncBreezewayPropertiesMutation =
    trpc.integrations.syncBreezewayProperties.useMutation({
      onSuccess: (data) => {
        toast.success(
          `Synced ${data.synced} properties${data.errors > 0 ? ` (${data.errors} errors)` : ""}`
        );
        setSyncInProgress(null);
        refetch();
      },
      onError: (err) => {
        toast.error(`Failed to sync properties: ${err.message}`);
        setSyncInProgress(null);
      },
    });

  const syncBreezewayTagsMutation =
    trpc.integrations.syncBreezewayPropertyTags.useMutation({
      onSuccess: (data: any) => {
        toast.success(
          `Tags synced: ${data.updated}/${data.total} properties${data.errors > 0 ? ` (${data.errors} errors)` : ""}`,
          { description: data.sampleDebug ? `Debug: ${data.sampleDebug}` : undefined, duration: 15000 }
        );
        setSyncInProgress(null);
        refetch();
      },
      onError: (err) => {
        toast.error(`Failed to sync tags: ${err.message}`);
        setSyncInProgress(null);
      },
    });

  const syncBreezewayTeamMutation =
    trpc.integrations.syncBreezewayTeam.useMutation({
      onSuccess: (data) => {
        toast.success(
          `Synced ${data.synced} team members${data.errors > 0 ? ` (${data.errors} errors)` : ""}`
        );
        setSyncInProgress(null);
        refetch();
      },
      onError: (err) => {
        toast.error(`Failed to sync team: ${err.message}`);
        setSyncInProgress(null);
      },
    });

  const registerWebhooksMutation =
    trpc.integrations.registerBreezewayWebhooks.useMutation({
      onSuccess: (data) => {
        if (data.task && data.propertyStatus) {
          toast.success("Breezeway webhooks registered successfully");
        } else {
          toast.warning(
            `Webhooks registered partially (task: ${data.task}, property-status: ${data.propertyStatus})`
          );
        }
        setSyncInProgress(null);
        refetch();
      },
      onError: (err) => {
        toast.error(`Failed to register webhooks: ${err.message}`);
        setSyncInProgress(null);
      },
    });

  const testSlackMutation = trpc.integrations.testSlackWebhook.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Slack webhook test successful!");
      } else {
        toast.error("Slack webhook test failed — check SLACK_WEBHOOK_URL in Settings → Secrets");
      }
      setSyncInProgress(null);
      refetch();
    },
    onError: (err) => {
      toast.error(`Slack test failed: ${err.message}`);
      setSyncInProgress(null);
    },
  });

  const triggerSdtMutation = trpc.integrations.triggerSdtCheck.useMutation({
    onSuccess: (data) => {
      toast.success(
        `SDT check complete: ${data.sdtsFound} SDTs found, ${data.unassigned} unassigned${
          data.notified ? " — Slack notified" : ""
        }`
      );
      setSyncInProgress(null);
    },
    onError: (err) => {
      toast.error(`SDT check failed: ${err.message}`);
      setSyncInProgress(null);
    },
  });

  const triggerLastMinuteMutation = trpc.integrations.triggerLastMinuteCheck.useMutation({
    onSuccess: (data) => {
      const summary = data.changes.length > 0
        ? data.changes
            .slice(0, 3)
            .map((c) => `${c.type}: ${c.propertyName}`)
            .join(" · ") + (data.changes.length > 3 ? ` · +${data.changes.length - 3} more` : "")
        : "no changes";
      toast.success(
        `Last-minute check: ${data.reservationsFetched} reservations, ${data.changesDetected} changes — ${summary}${
          data.notified ? " · Slack notified" : ""
        }`
      );
      setSyncInProgress(null);
    },
    onError: (err) => {
      toast.error(`Last-minute check failed: ${err.message}`);
      setSyncInProgress(null);
    },
  });

  const handleSync = (type: string) => {
    setSyncInProgress(type);
    switch (type) {
      case "all":
        syncAllMutation.mutate();
        break;
      case "hostaway-listings":
        syncHostawayListingsMutation.mutate();
        break;
      case "hostaway-reviews":
        syncHostawayReviewsMutation.mutate();
        break;
      case "breezeway-properties":
        syncBreezewayPropertiesMutation.mutate();
        break;
      case "breezeway-tags":
        syncBreezewayTagsMutation.mutate();
        break;
      case "breezeway-team":
        syncBreezewayTeamMutation.mutate();
        break;
      case "breezeway-webhooks":
        registerWebhooksMutation.mutate({
          webhookUrl: `${window.location.origin}/api/webhooks/breezeway`,
        });
        break;
      case "slack-test":
        testSlackMutation.mutate();
        break;
      case "sdt-check":
        triggerSdtMutation.mutate();
        break;
      case "last-minute-check":
        triggerLastMinuteMutation.mutate();
        break;
    }
  };

  const getIntegrationStatus = (name: string) => {
    const integration = integrations?.find((i) => i.name === name);
    return {
      status: integration?.status ?? "not_connected",
      lastSyncAt: integration?.lastSyncAt
        ? new Date(integration.lastSyncAt).toLocaleString()
        : null,
      errorMessage: integration?.errorMessage,
    };
  };

  const hostawayStatus = getIntegrationStatus("hostaway");
  const breezewayStatus = getIntegrationStatus("breezeway");
  const slackStatus = getIntegrationStatus("slack");

  const integrationDetails = [
    {
      id: "hostaway",
      name: "Hostaway",
      icon: "H",
      color: "bg-blue-600",
      type: "READ-ONLY",
      description: "Channel management — pull guest messages and reviews",
      status: hostawayStatus.status,
      statusText: hostawayStatus.lastSyncAt
        ? `Last synced: ${hostawayStatus.lastSyncAt}`
        : "Not synced yet",
      actions: [
        {
          label: "Sync Listings",
          onClick: () => handleSync("hostaway-listings"),
          loading: syncInProgress === "hostaway-listings",
        },
        {
          label: "Sync Reviews",
          onClick: () => handleSync("hostaway-reviews"),
          loading: syncInProgress === "hostaway-reviews",
        },
      ],
    },
    {
      id: "breezeway",
      name: "Breezeway",
      icon: "B",
      color: "bg-cyan-600",
      type: "READ + WRITE",
      description: "Property operations — pull reports, create tasks",
      status: breezewayStatus.status,
      statusText: breezewayStatus.lastSyncAt
        ? `Last synced: ${breezewayStatus.lastSyncAt}`
        : "Not synced yet",
      actions: [
        {
          label: "Sync Properties",
          onClick: () => handleSync("breezeway-properties"),
          loading: syncInProgress === "breezeway-properties",
        },
        {
          label: "Sync Tags",
          onClick: () => handleSync("breezeway-tags"),
          loading: syncInProgress === "breezeway-tags",
        },
        {
          label: "Sync Team",
          onClick: () => handleSync("breezeway-team"),
          loading: syncInProgress === "breezeway-team",
        },
        {
          label: "Register Webhooks",
          onClick: () => handleSync("breezeway-webhooks"),
          loading: syncInProgress === "breezeway-webhooks",
        },
      ],
    },
    {
      id: "amazon",
      name: "Amazon",
      icon: "A",
      color: "bg-orange-500",
      type: "SEARCH",
      description: "Product search and one-click ordering for replacements",
      status: "ready",
      statusText: "Using public product data for MVP",
      actions: [],
    },
    {
      id: "slack",
      name: "Slack",
      icon: "S",
      color: "bg-red-600",
      type: "WRITE",
      description: "SDT alerts and team notifications via webhook",
      status: slackStatus.status,
      statusText: slackStatus.lastSyncAt
        ? `Connected — last tested: ${slackStatus.lastSyncAt}`
        : "Configure SLACK_WEBHOOK_URL in Settings → Secrets",
      actions: [
        {
          label: "Test Webhook",
          onClick: () => handleSync("slack-test"),
          loading: syncInProgress === "slack-test",
        },
        {
          label: "Trigger SDT Check",
          onClick: () => handleSync("sdt-check"),
          loading: syncInProgress === "sdt-check",
        },
        {
          label: "Trigger Last-Minute Check",
          onClick: () => handleSync("last-minute-check"),
          loading: syncInProgress === "last-minute-check",
        },
      ],
    },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case "ready":
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "connected":
        return "Connected";
      case "ready":
        return "Ready";
      case "error":
        return "Error";
      default:
        return "Not Connected";
    }
  };

  const isSyncActive = bwSyncStatus?.enabled ?? false;
  const isActivating = activateSyncMutation.isPending;
  const isDeactivating = deactivateSyncMutation.isPending;
  const isPolling = manualPollMutation.isPending;

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="wand-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage integrations, automation rules, and team
        </p>
      </div>

      {/* Breezeway status banner */}
      {breezewayStatus.status === "connected" && (
        <div className="p-4 bg-cyan-50 border border-cyan-200 rounded-lg dark:bg-cyan-950 dark:border-cyan-700">
          <p className="text-sm text-cyan-700 dark:text-cyan-300">
            <span className="font-semibold">✓ Breezeway Connected</span> — Your
            Breezeway account is synced and ready. Real-time webhooks are active
            for task and property events.
          </p>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="integrations" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-4">
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="team">Team & Users</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Connected Services</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSync("all")}
              disabled={syncInProgress === "all"}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${syncInProgress === "all" ? "animate-spin" : ""}`}
              />
              {syncInProgress === "all" ? "Syncing..." : "Sync All"}
            </Button>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <>
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </>
            ) : (
              integrationDetails.map((integration) => (
                <Card
                  key={integration.id}
                  className="p-4 flex flex-col gap-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div
                      className={`${integration.color} h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0`}
                    >
                      {integration.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{integration.name}</h3>
                        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {integration.type}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {integration.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {integration.statusText}
                      </p>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2 shrink-0">
                      {getStatusIcon(integration.status)}
                      <span className="text-xs font-medium text-muted-foreground">
                        {getStatusLabel(integration.status)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  {integration.actions.length > 0 && (
                    <div className="flex gap-2 flex-wrap border-t pt-3">
                      {integration.actions.map((action) => (
                        <Button
                          key={action.label}
                          size="sm"
                          variant="outline"
                          onClick={action.onClick}
                          disabled={action.loading || !!syncInProgress}
                        >
                          {action.loading && (
                            <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          )}
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {/* Breezeway Task Sync sub-panel */}
                  {integration.id === "breezeway" && (
                    <div className="border-t pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium">
                            Wand Task Board Sync
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isSyncActive
                              ? `Active — polling every 5 min for tasks assigned to "Leisr Stays"${bwSyncStatus?.leisrStaysAssigneeId ? ` (ID: ${bwSyncStatus.leisrStaysAssigneeId})` : ""}${bwSyncStatus?.lastPollAt ? ` · Last poll: ${new Date(bwSyncStatus.lastPollAt).toLocaleString()}` : ""}`
                              : 'Disabled — enable to pull Breezeway tasks assigned to "Leisr Stays" onto the Wand task board'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isSyncActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => manualPollMutation.mutate()}
                              disabled={isPolling || isDeactivating}
                            >
                              {isPolling ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              {isPolling ? "Polling..." : "Poll Now"}
                            </Button>
                          )}
                          {isSyncActive ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                              onClick={() => deactivateSyncMutation.mutate()}
                              disabled={isDeactivating || isActivating}
                            >
                              {isDeactivating ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <PowerOff className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              {isDeactivating ? "Disabling..." : "Disable Sync"}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="bg-cyan-600 hover:bg-cyan-700 text-white"
                              onClick={() => activateSyncMutation.mutate()}
                              disabled={isActivating || isDeactivating}
                            >
                              {isActivating ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <Power className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              {isActivating ? "Activating..." : "Enable Sync"}
                            </Button>
                          )}
                        </div>
                      </div>
                      {isSyncActive && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            Sync active — new Breezeway tasks will appear on the board automatically
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Automation Tab */}
        <TabsContent value="automation" className="mt-6">
          <Card className="p-12">
            <p className="text-center text-muted-foreground">
              Automation rules coming soon
            </p>
          </Card>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="mt-6">
          <Card className="p-12">
            <p className="text-center text-muted-foreground">
              Team & Users management coming soon
            </p>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="mt-6">
          <Card className="p-12">
            <p className="text-center text-muted-foreground">
              Notification settings coming soon
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
