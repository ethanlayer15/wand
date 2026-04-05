import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  BarChart3,
  AlertTriangle,
  Clock,
  Building2,
  Flag,
  Sparkles,
  RefreshCw,
  MessageSquare,
  Brain,
  Star,
  ArrowRight,
  Shield,
  Wrench,
  SprayCanIcon,
  Zap,
  MapPin,
  User,
} from "lucide-react";
import { useState } from "react";

// ── Urgent Tasks Widget ────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  created: "In Queue",
  in_progress: "In Progress",
};

const STATUS_COLORS: Record<string, string> = {
  created: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  in_progress: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
};

function UrgentTasksWidget() {
  const { data: urgentTasks, isLoading } = trpc.tasks.urgent.useQuery();

  if (!isLoading && (!urgentTasks || urgentTasks.length === 0)) return null;

  return (
    <Card className="p-4 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-red-600 dark:text-red-400" />
          <h3 className="text-sm font-bold text-red-800 dark:text-red-300">Urgent Items</h3>
          {urgentTasks && urgentTasks.length > 0 && (
            <Badge className="bg-red-600 text-white text-xs h-5">{urgentTasks.length}</Badge>
          )}
        </div>
        <Link href="/tasks">
          <Button variant="link" className="p-0 h-auto text-red-700 dark:text-red-400 text-xs">
            View on board <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <div className="space-y-2">
          {urgentTasks!.slice(0, 6).map((task) => (
            <Link key={task.id} href="/tasks">
              <div className="flex items-center gap-3 bg-white dark:bg-red-950/30 rounded-lg px-3 py-2.5 border border-red-100 dark:border-red-800 hover:border-red-300 dark:hover:border-red-600 transition-colors cursor-pointer">
                <Zap className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {task.listingName && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 truncate">
                        <MapPin className="h-2.5 w-2.5 shrink-0" />
                        {task.listingName}
                      </span>
                    )}
                    {task.assignedTo && (
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5 shrink-0">
                        <User className="h-2.5 w-2.5" />
                        {task.assignedTo}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                  STATUS_COLORS[task.status] || "bg-gray-100 text-gray-600"
                }`}>
                  {STATUS_LABELS[task.status] || task.status}
                </span>
              </div>
            </Link>
          ))}
          {urgentTasks!.length > 6 && (
            <p className="text-xs text-red-500 dark:text-red-400 text-center pt-1">
              +{urgentTasks!.length - 6} more urgent tasks
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

type TimeRange = "30d" | "quarter" | "all";
const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "30d": "Last 30 Days",
  "quarter": "This Quarter",
  "all": "All Time",
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = trpc.dashboard.stats.useQuery();
  const [ratingTimeRange, setRatingTimeRange] = useState<TimeRange>("30d");
  const { data: ratingData, isLoading: ratingLoading } = trpc.dashboard.avgRating.useQuery({ timeRange: ratingTimeRange });
  const { data: recentTasks, isLoading: tasksLoading } = trpc.dashboard.recentTasks.useQuery();
  const { data: recentReviews, isLoading: reviewsLoading } = trpc.dashboard.recentReviews.useQuery();
  const { data: urgentAlerts, isLoading: alertsLoading } = trpc.dashboard.urgentAlerts.useQuery();
  const utils = trpc.useUtils();

  const syncMutation = trpc.integrations.syncAll.useMutation({
    onSuccess: () => {
      toast.success("Data synced successfully");
      utils.dashboard.invalidate();
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
  });

  const analyzeMutation = trpc.analyze.analyzeReviews.useMutation({
    onSuccess: (data) => {
      toast.success(`Analyzed ${data.analyzed} reviews`);
      utils.dashboard.invalidate();
    },
    onError: (err) => toast.error(`Analysis failed: ${err.message}`),
  });

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="space-y-6 p-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="wand-page-title">{greeting}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <p className="text-sm text-muted-foreground">
          {stats?.urgentCount || 0} high-priority tasks
          {stats?.analyzedCount ? ` · ${stats.analyzedCount} reviews analyzed` : ""}
          {stats?.totalMessages ? ` · ${stats.totalMessages} guest messages` : ""}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing..." : "Sync Data"}
        </Button>
        <Button
          size="sm"
          className="bg-yellow-500 hover:bg-yellow-600 text-black"
          onClick={() => analyzeMutation.mutate({ batchSize: 20 })}
          disabled={analyzeMutation.isPending}
        >
          <Sparkles className={`h-4 w-4 mr-2 ${analyzeMutation.isPending ? "animate-spin" : ""}`} />
          {analyzeMutation.isPending ? "Analyzing..." : "AI Analyze"}
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground font-medium">AVG RATING</p>
                <span className="text-[10px] text-muted-foreground">· {TIME_RANGE_LABELS[ratingTimeRange]}</span>
              </div>
              <div className="text-3xl font-bold mt-2">
                {ratingLoading ? <Skeleton className="h-8 w-16" /> : (
                  <>{ratingData?.avgRating}<span className="text-lg">★</span></>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{ratingData?.reviewCount ?? 0} reviews</p>
            </div>
            <Star className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex gap-1 mt-3">
            {(["30d", "quarter", "all"] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setRatingTimeRange(range)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  ratingTimeRange === range
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {TIME_RANGE_LABELS[range]}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">URGENT</p>
              <p className="text-3xl font-bold mt-2 text-red-600">
                {statsLoading ? <Skeleton className="h-8 w-12" /> : stats?.urgentCount || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.openTasksCount || 0} open total</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">PROPERTIES</p>
              <p className="text-3xl font-bold mt-2">
                {statsLoading ? <Skeleton className="h-8 w-12" /> : stats?.propertiesCount || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">synced from Hostaway</p>
            </div>
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">AI ANALYZED</p>
              <p className="text-3xl font-bold mt-2">
                {statsLoading ? <Skeleton className="h-8 w-12" /> : stats?.analyzedCount || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">of {stats?.totalReviews || 0} reviews</p>
            </div>
            <Brain className="h-5 w-5 text-purple-500" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">MESSAGES</p>
              <p className="text-3xl font-bold mt-2">
                {statsLoading ? <Skeleton className="h-8 w-12" /> : stats?.totalMessages || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.urgentMessageCount || 0} urgent
              </p>
            </div>
            <MessageSquare className="h-5 w-5 text-blue-500" />
          </div>
        </Card>
      </div>

      {/* Sentiment + Issues Summary */}
      {stats?.analyzedCount && stats.analyzedCount > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sentiment Bar */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Sentiment Overview</h3>
            <div className="flex gap-4 text-center mb-3">
              <div className="flex-1 p-2 rounded bg-emerald-50">
                <p className="text-xl font-bold text-emerald-700">{stats.sentimentDist.positive}</p>
                <p className="text-[10px] text-emerald-600">Positive</p>
              </div>
              <div className="flex-1 p-2 rounded bg-amber-50">
                <p className="text-xl font-bold text-amber-700">{stats.sentimentDist.neutral}</p>
                <p className="text-[10px] text-amber-600">Neutral</p>
              </div>
              <div className="flex-1 p-2 rounded bg-red-50">
                <p className="text-xl font-bold text-red-700">{stats.sentimentDist.negative}</p>
                <p className="text-[10px] text-red-600">Negative</p>
              </div>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500" style={{ width: `${(stats.sentimentDist.positive / stats.analyzedCount) * 100}%` }} />
              <div className="bg-amber-400" style={{ width: `${(stats.sentimentDist.neutral / stats.analyzedCount) * 100}%` }} />
              <div className="bg-red-500" style={{ width: `${(stats.sentimentDist.negative / stats.analyzedCount) * 100}%` }} />
            </div>
          </Card>

          {/* Top Issues */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Top Issues Detected</h3>
            {stats.topIssues.length > 0 ? (
              <div className="space-y-2">
                {stats.topIssues.map((issue) => {
                  const icon = issue.type === "cleaning" ? SprayCanIcon :
                    issue.type === "maintenance" ? Wrench :
                    issue.type === "safety" ? Shield : Flag;
                  const Icon = icon;
                  return (
                    <div key={issue.type} className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm flex-1 capitalize">{issue.type}</span>
                      <Badge variant="outline" className="text-xs">{issue.count}</Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No issues detected yet</p>
            )}
          </Card>
        </div>
      )}

      {/* Urgent Alerts */}
      {urgentAlerts && urgentAlerts.length > 0 && (
        <Card className="p-4 border-red-200 bg-red-50/50">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <h3 className="text-sm font-semibold text-red-800">Urgent Alerts</h3>
            <Badge className="bg-red-600 text-white text-xs">{urgentAlerts.length}</Badge>
          </div>
          <div className="space-y-2">
            {urgentAlerts.slice(0, 5).map((alert, idx) => (
              <div key={idx} className="flex items-start gap-3 bg-white p-3 rounded border border-red-100">
                <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${alert.severity === "critical" ? "bg-red-600" : "bg-orange-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs ${alert.severity === "critical" ? "text-red-700 border-red-300" : "text-orange-700 border-orange-300"}`}>
                      {alert.severity}
                    </Badge>
                    <span className="text-xs font-medium capitalize">{alert.title}</span>
                    <Badge variant="outline" className="text-xs">{alert.type}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{alert.description}</p>
                </div>
              </div>
            ))}
          </div>
          <Link href="/analyze" className="inline-block mt-3">
            <Button variant="link" className="p-0 h-auto text-red-700 text-xs">
              View all in Analyze <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </Card>
      )}

      {/* Urgent Tasks Widget */}
      <UrgentTasksWidget />

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Here's what to do</h2>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
              {recentTasks?.length || 0}
            </span>
          </div>

          <div className="space-y-3">
            {tasksLoading ? (
              <>
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </>
            ) : recentTasks && recentTasks.length > 0 ? (
              recentTasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className="border rounded p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                        task.priority === "high"
                          ? "bg-red-500"
                          : task.priority === "medium"
                            ? "bg-orange-500"
                            : "bg-gray-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium uppercase text-muted-foreground">
                          {task.priority}
                        </span>
                        <span className="text-xs font-medium text-blue-600">
                          {task.source === "airbnb_review"
                            ? "Airbnb Review"
                            : "Guest Message"}
                        </span>
                      </div>
                      <p className="font-medium text-sm mt-1">{task.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {task.listingId ? "Property" : "Unknown"}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No tasks yet. Sync data and run AI analysis to detect issues.</p>
            )}
          </div>

          <Link href="/analyze">
            <Button variant="link" className="mt-4 p-0 h-auto">
              View all tasks →
            </Button>
          </Link>
        </Card>

        {/* Reviews */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Recent reviews</h2>
            <Flag className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="space-y-3">
            {reviewsLoading ? (
              <>
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </>
            ) : recentReviews && recentReviews.length > 0 ? (
              recentReviews.slice(0, 5).map((review) => (
                <div
                  key={review.id}
                  className="border rounded p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {review.source || "Review"}
                      </p>
                      <p className="text-sm mt-1 line-clamp-2">{review.text}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {review.guestName} · {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : ""}
                      </p>
                    </div>
                    <div className="text-lg font-semibold text-yellow-500">
                      {review.rating ? `${(review.rating / 2).toFixed(1)}★` : "—"}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No reviews yet. Sync data from Hostaway.</p>
            )}
          </div>

          <Link href="/analyze">
            <Button variant="link" className="mt-4 p-0 h-auto">
              View all reviews →
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}
