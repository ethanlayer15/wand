import { trpc } from "@/lib/trpc";
import { PropertyCombobox } from "@/components/PropertyCombobox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  BarChart3,
  TrendingUp,
  Users,
  Flag,
  GitCompare,
  MessageSquare,
  RefreshCw,
  Brain,
  Search,
  AlertTriangle,
  Star,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CalendarIcon,
  X,
  Filter,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────

type TimeRange = "30d" | "quarter" | "year" | "all";
const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "30d": "Last 30 Days",
  "quarter": "This Quarter",
  "year": "This Year",
  "all": "All Time",
};

interface AnalyzeFilters {
  timeRange: TimeRange;
  startDate?: string;
  endDate?: string;
  listingId?: number;
  state?: string;
  podId?: number;
}

// ── Helper Components ──────────────────────────────────────────────────

function SentimentBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <Badge variant="outline">—</Badge>;
  if (score > 20) return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Positive ({score})</Badge>;
  if (score < -20) return <Badge className="bg-red-100 text-red-800 border-red-200">Negative ({score})</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Neutral ({score})</Badge>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-600 text-white",
    high: "bg-red-100 text-red-800 border-red-200",
    medium: "bg-amber-100 text-amber-800 border-amber-200",
    low: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return <Badge className={colors[severity] || colors.low}>{severity}</Badge>;
}

// Normalize any rating to 5-star scale (Booking.com/VRBO use 10-point)
function normalizeRating(r: number) { return r > 5 ? r / 2 : r; }

function RatingStars({ rating }: { rating: number }) {
  const normalized = normalizeRating(rating);
  return (
    <span className="text-amber-500 font-semibold">
      {rating > 0 ? `${normalized.toFixed(2)}★` : "—"}
    </span>
  );
}

function StatCard({ label, value, sub, trend }: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "flat";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <div className="flex items-end gap-2 mt-2">
        <p className="text-3xl font-bold">{value}</p>
        {trend === "up" && <ArrowUpRight className="h-5 w-5 text-emerald-500" />}
        {trend === "down" && <ArrowDownRight className="h-5 w-5 text-red-500" />}
        {trend === "flat" && <Minus className="h-5 w-5 text-muted-foreground" />}
      </div>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </Card>
  );
}

// Simple bar chart using divs
function MiniBarChart({ data, maxVal }: { data: Array<{ label: string; value: number; color?: string }>; maxVal?: number }) {
  const max = maxVal || Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-24 truncate text-right">{d.label}</span>
          <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
            <div
              className={`h-full rounded-full ${d.color || "bg-primary"}`}
              style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }}
            />
          </div>
          <span className="text-xs font-medium w-10 text-right">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────

function FilterBar({
  filters,
  setFilters,
  listings,
  states,
  pods,
}: {
  filters: AnalyzeFilters;
  setFilters: (f: AnalyzeFilters) => void;
  listings?: Array<{ id: number; name: string; podId?: number | null }>;
  states?: string[];
  pods?: Array<{ id: number; name: string; propertyCount: number }>;
}) {
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const isCustom = !!(filters.startDate || filters.endDate);

  const activeCount = [
    filters.timeRange !== "all" || isCustom,
    filters.listingId,
    filters.state,
    filters.podId,
  ].filter(Boolean).length;

  // Filter listings by selected pod
  const filteredListings = useMemo(() => {
    if (!listings) return listings;
    if (!filters.podId) return listings;
    return listings.filter((l: any) => l.podId === filters.podId);
  }, [listings, filters.podId]);

  const clearFilters = () => {
    setFilters({ timeRange: "all" });
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Filters</span>
        {activeCount > 0 && (
          <>
            <Badge variant="outline" className="text-xs">{activeCount} active</Badge>
            <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1">
              <X className="h-3 w-3" /> Clear all
            </button>
          </>
        )}
      </div>

      {/* Time range presets */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="text-xs text-muted-foreground self-center mr-1">Time:</span>
        {(["30d", "quarter", "year", "all"] as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => setFilters({ ...filters, timeRange: range, startDate: undefined, endDate: undefined })}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filters.timeRange === range && !isCustom
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {TIME_RANGE_LABELS[range]}
          </button>
        ))}

        {/* Custom date range */}
        <div className="flex items-center gap-1 ml-2">
          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <button className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                filters.startDate ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}>
                <CalendarIcon className="h-3 w-3" />
                {filters.startDate ? format(new Date(filters.startDate), "MMM d, yyyy") : "Start date"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={filters.startDate ? new Date(filters.startDate) : undefined}
                onSelect={(date) => {
                  setFilters({
                    ...filters,
                    timeRange: "all",
                    startDate: date ? date.toISOString().split("T")[0] : undefined,
                  });
                  setStartOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <span className="text-xs text-muted-foreground">→</span>
          <Popover open={endOpen} onOpenChange={setEndOpen}>
            <PopoverTrigger asChild>
              <button className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                filters.endDate ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}>
                <CalendarIcon className="h-3 w-3" />
                {filters.endDate ? format(new Date(filters.endDate), "MMM d, yyyy") : "End date"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={filters.endDate ? new Date(filters.endDate) : undefined}
                onSelect={(date) => {
                  setFilters({
                    ...filters,
                    timeRange: "all",
                    endDate: date ? date.toISOString().split("T")[0] : undefined,
                  });
                  setEndOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {isCustom && (
            <button
              onClick={() => setFilters({ ...filters, startDate: undefined, endDate: undefined })}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Pod, Property, and Region filters */}
      <div className="flex gap-3 flex-wrap">
        <Select
          value={filters.podId ? String(filters.podId) : "all"}
          onValueChange={(v) => {
            const podId = v !== "all" ? Number(v) : undefined;
            setFilters({ ...filters, podId, listingId: undefined });
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Pods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pods</SelectItem>
            {pods?.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name} ({p.propertyCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <PropertyCombobox
          properties={(filteredListings || listings || []).map((l) => ({
            id: l.id,
            name: (l as any).internalName || l.name,
          }))}
          value={filters.listingId ? String(filters.listingId) : "all"}
          onValueChange={(v) =>
            setFilters({ ...filters, listingId: v !== "all" ? Number(v) : undefined })
          }
          allLabel="All Properties"
          placeholder="Select property…"
          className="w-56"
        />

        <Select
          value={filters.state || "all"}
          onValueChange={(v) => setFilters({ ...filters, state: v !== "all" ? v : undefined, listingId: undefined })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Regions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            {states?.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export default function Analyze() {
  const { data: listings } = trpc.listings.list.useQuery();
  const { data: podsData = [] } = trpc.pods.list.useQuery();
  const [activeTab, setActiveTab] = useState("overview");
  const [filters, setFilters] = useState<AnalyzeFilters>({ timeRange: "all" });

  // Build the query input from filters
  const overviewInput = useMemo(() => {
    const input: Record<string, any> = {};
    if (filters.timeRange !== "all") input.timeRange = filters.timeRange;
    if (filters.startDate) input.startDate = filters.startDate;
    if (filters.endDate) input.endDate = filters.endDate;
    if (filters.listingId) input.listingId = filters.listingId;
    if (filters.state) input.state = filters.state;
    if (filters.podId) input.podId = filters.podId;
    return Object.keys(input).length > 0 ? input : undefined;
  }, [filters]);

  // Fetch overview to get states list
  const { data: overviewData } = trpc.analyze.overview.useQuery(overviewInput);
  const states = overviewData?.states;

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-6 w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="wand-page-title">Analyze</h1>
          <AnalyzeActions />
        </div>
        <p className="text-sm text-muted-foreground">
          AI-powered review analysis, sentiment trends, and issue detection across your portfolio
        </p>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        listings={listings}
        states={states}
        pods={podsData}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-3xl grid-cols-6">
          <TabsTrigger value="overview" className="text-xs">
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="trends" className="text-xs">
            <TrendingUp className="h-3.5 w-3.5 mr-1" />
            Trends
          </TabsTrigger>
          <TabsTrigger value="cleaners" className="text-xs">
            <Users className="h-3.5 w-3.5 mr-1" />
            Cleaners
          </TabsTrigger>
          <TabsTrigger value="flagged" className="text-xs">
            <Flag className="h-3.5 w-3.5 mr-1" />
            Flagged
          </TabsTrigger>
          <TabsTrigger value="comparison" className="text-xs">
            <GitCompare className="h-3.5 w-3.5 mr-1" />
            Comparison
          </TabsTrigger>
          <TabsTrigger value="feed" className="text-xs">
            <MessageSquare className="h-3.5 w-3.5 mr-1" />
            Review Feed
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="overview">
            <OverviewTab overviewInput={overviewInput} />
          </TabsContent>
          <TabsContent value="trends">
            <TrendsTab filters={filters} />
          </TabsContent>
          <TabsContent value="cleaners">
            <CleanersTab />
          </TabsContent>
          <TabsContent value="flagged">
            <FlaggedTab filters={filters} />
          </TabsContent>
          <TabsContent value="comparison">
            <ComparisonTab filters={filters} />
          </TabsContent>
          <TabsContent value="feed">
            <FeedTab filters={filters} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ── Analyze Actions (Sync + AI) ────────────────────────────────────────

function AnalyzeActions() {
  const utils = trpc.useUtils();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: countData, refetch: refetchCount } = trpc.analyze.countUnanalyzed.useQuery(undefined, {
    refetchInterval: activeJobId ? 5000 : false,
  });

  // Poll job status when a job is active
  const { data: jobStatus } = trpc.analyze.getAnalysisJobStatus.useQuery(
    { jobId: activeJobId || undefined },
    {
      enabled: !!activeJobId,
      refetchInterval: activeJobId ? 2000 : false,
    }
  );

  // Handle job completion via useEffect
  const prevJobStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!jobStatus) return;
    const prevStatus = prevJobStatusRef.current;
    prevJobStatusRef.current = jobStatus.status;
    if (prevStatus === "running" || prevStatus === null) {
      if (jobStatus.status === "completed") {
        toast.success(`Analysis complete! Processed ${jobStatus.analyzed.toLocaleString()} reviews.`);
        utils.analyze.invalidate();
        setActiveJobId(null);
        refetchCount();
      } else if (jobStatus.status === "stopped") {
        toast.info(`Analysis stopped. Processed ${jobStatus.analyzed.toLocaleString()} reviews so far.`);
        setActiveJobId(null);
        refetchCount();
      } else if (jobStatus.status === "error") {
        toast.error(`Analysis error: ${jobStatus.message}`);
        setActiveJobId(null);
      }
    }
  }, [jobStatus?.status]);

  const startJobMutation = trpc.analyze.startAnalysisJob.useMutation({
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      toast.info("Analysis started in background. Progress will update automatically.");
    },
    onError: (err) => {
      toast.error(`Failed to start analysis: ${err.message}`);
    },
  });

  const stopJobMutation = trpc.analyze.stopAnalysisJob.useMutation({
    onSuccess: () => {
      toast.info("Stopping analysis...");
    },
  });

  const syncMessages = trpc.analyze.syncMessages.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.synced} messages synced from ${data.conversations} conversations`);
      utils.analyze.invalidate();
    },
    onError: (err) => {
      toast.error(`Sync Failed: ${err.message}`);
    },
  });

  const isRunning = jobStatus?.status === "running";
  const isError = jobStatus?.status === "error";
  const progress = jobStatus && (isRunning || isError) ? { done: jobStatus.analyzed, total: jobStatus.total, errors: jobStatus.errors } : null;

  return (
    <div className="flex items-center gap-2">
      {progress && (
        <div className="flex items-center gap-2">
          <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
            {progress.errors > 0 && (
              <span className="text-red-500 ml-1">({progress.errors} errors)</span>
            )}
          </span>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => syncMessages.mutate()}
        disabled={syncMessages.isPending || isRunning}
      >
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMessages.isPending ? "animate-spin" : ""}`} />
        Sync Messages
      </Button>
      {isRunning ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => activeJobId && stopJobMutation.mutate({ jobId: activeJobId })}
          disabled={stopJobMutation.isPending}
        >
          Stop Analysis
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => startJobMutation.mutate()}
          disabled={startJobMutation.isPending}
        >
          <Brain className={`h-3.5 w-3.5 mr-1.5 ${startJobMutation.isPending ? "animate-spin" : ""}`} />
          {countData?.count != null ? `Analyze All (${countData.count.toLocaleString()} left)` : "Analyze All Reviews"}
        </Button>
      )}
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────

function OverviewTab({ overviewInput }: { overviewInput?: Record<string, any> }) {
  const { data, isLoading } = trpc.analyze.overview.useQuery(overviewInput);

  if (isLoading) return <OverviewSkeleton />;
  if (!data) return <p className="text-muted-foreground">No data available</p>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Avg Rating" value={`${data.avgRating.toFixed(2)}★`} sub={`${data.totalReviews} total reviews`} />
        <StatCard label="AI Analyzed" value={data.totalAnalyzed} sub={`of ${data.totalReviews} reviews`} />
        <StatCard label="Properties" value={data.totalListings} sub="active listings" />
        <StatCard label="Guest Messages" value={data.totalMessages} sub="synced from Hostaway" />
        <StatCard label="Open Tasks" value={data.totalTasks} sub="from all sources" />
      </div>

      {/* Sentiment + Issues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="font-semibold mb-4">Sentiment Distribution</h3>
          {data.totalAnalyzed > 0 ? (
            <div className="space-y-4">
              <div className="flex gap-4 text-center">
                <div className="flex-1 p-3 rounded-lg bg-emerald-50">
                  <p className="text-2xl font-bold text-emerald-700">{data.sentimentDist.positive}</p>
                  <p className="text-xs text-emerald-600">Positive</p>
                </div>
                <div className="flex-1 p-3 rounded-lg bg-amber-50">
                  <p className="text-2xl font-bold text-amber-700">{data.sentimentDist.neutral}</p>
                  <p className="text-xs text-amber-600">Neutral</p>
                </div>
                <div className="flex-1 p-3 rounded-lg bg-red-50">
                  <p className="text-2xl font-bold text-red-700">{data.sentimentDist.negative}</p>
                  <p className="text-xs text-red-600">Negative</p>
                </div>
              </div>
              {/* Sentiment bar */}
              <div className="flex h-3 rounded-full overflow-hidden">
                <div className="bg-emerald-500" style={{ width: `${(data.sentimentDist.positive / data.totalAnalyzed) * 100}%` }} />
                <div className="bg-amber-400" style={{ width: `${(data.sentimentDist.neutral / data.totalAnalyzed) * 100}%` }} />
                <div className="bg-red-500" style={{ width: `${(data.sentimentDist.negative / data.totalAnalyzed) * 100}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Click "Analyze Reviews" to generate sentiment data</p>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold mb-4">Top Issue Categories</h3>
          {data.topIssues.length > 0 ? (
            <MiniBarChart
              data={data.topIssues.map((i) => ({
                label: i.type,
                value: i.count,
                color: i.type === "cleaning" ? "bg-blue-500" :
                  i.type === "maintenance" ? "bg-orange-500" :
                  i.type === "safety" ? "bg-red-500" :
                  i.type === "noise" ? "bg-purple-500" :
                  "bg-slate-500",
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No issues detected yet</p>
          )}
        </Card>
      </div>

      {/* Properties Needing Attention */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Properties Needing Attention</h3>
        {data.propertiesNeedingAttention.length > 0 ? (
          <div className="space-y-3">
            {data.propertiesNeedingAttention.map((p, idx) => (
              <div key={p.listingId} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground w-6">{idx + 1}.</span>
                  <span className="font-medium">{p.name}</span>
                </div>
                <Badge variant="outline" className="text-red-600 border-red-200">
                  {p.issueCount} issues
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No issues detected. Analyze reviews to find properties needing attention.</p>
        )}
      </Card>

      {/* Rating Distribution */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Rating Distribution</h3>
        {Object.keys(data.ratingDist).length > 0 ? (
          <MiniBarChart
            data={[5, 4, 3, 2, 1].map((r) => ({
              label: `${r}★`,
              value: data.ratingDist[r] || 0,
              color: r >= 4 ? "bg-emerald-500" : r >= 3 ? "bg-amber-500" : "bg-red-500",
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No rating data available</p>
        )}
      </Card>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

// ── Trends Tab ─────────────────────────────────────────────────────────

function TrendsTab({ filters }: { filters: AnalyzeFilters }) {
  const [months] = useState(12);
  const { data, isLoading } = trpc.analyze.trends.useQuery({
    months,
    listingId: filters.listingId,
    podId: filters.podId,
    timeRange: filters.timeRange !== "all" ? filters.timeRange : undefined,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data || data.length === 0) {
    return (
      <Card className="p-12 text-center">
        <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No trend data available. Analyze reviews first.</p>
      </Card>
    );
  }

  const maxReviews = Math.max(...data.map((d) => d.count), 1);
  const maxIssues = Math.max(...data.map((d) => d.issueCount), 1);

  return (
    <div className="space-y-6">
      {/* Review Volume Over Time */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Review Volume by Month</h3>
        <div className="flex items-end gap-1 h-40">
          {data.map((d) => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium">{d.count}</span>
              <div
                className="w-full bg-primary rounded-t"
                style={{ height: `${(d.count / maxReviews) * 120}px` }}
              />
              <span className="text-[10px] text-muted-foreground rotate-[-45deg] origin-top-left mt-2">
                {d.month.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Average Rating Trend */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Average Rating Trend</h3>
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.month} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-16">{d.month}</span>
              <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                <div
                  className={`h-full rounded-full ${d.avgRating >= 4 ? "bg-emerald-500" : d.avgRating >= 3 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${(d.avgRating / 5) * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium w-14 text-right">{d.avgRating.toFixed(2)}★</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Sentiment Trend */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Sentiment Score Trend</h3>
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.month} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-16">{d.month}</span>
              <div className="flex-1 relative bg-muted rounded-full h-4 overflow-hidden">
                {/* Center line at 50% = neutral */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                <div
                  className={`absolute h-full rounded-full ${d.avgSentiment >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
                  style={{
                    left: d.avgSentiment >= 0 ? "50%" : `${50 + (d.avgSentiment / 200) * 100}%`,
                    width: `${Math.abs(d.avgSentiment / 200) * 100}%`,
                  }}
                />
              </div>
              <span className="text-xs font-medium w-12 text-right">{d.avgSentiment}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Issues Over Time */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">Issues Detected by Month</h3>
        <div className="flex items-end gap-1 h-32">
          {data.map((d) => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium">{d.issueCount}</span>
              <div
                className="w-full bg-red-400 rounded-t"
                style={{ height: `${(d.issueCount / maxIssues) * 100}px` }}
              />
              <span className="text-[10px] text-muted-foreground">{d.month.slice(5)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Cleaners Tab ───────────────────────────────────────────────────────

// Multiplier badge color helper
function MultiplierBadge({ multiplier }: { multiplier: number }) {
  let color = "bg-gray-100 text-gray-700 border-gray-200";
  let label = `${multiplier}x`;
  if (multiplier >= 1.5) {
    color = "bg-emerald-50 text-emerald-700 border-emerald-200";
    label = "1.5x Max";
  } else if (multiplier >= 1.1) {
    color = "bg-blue-50 text-blue-700 border-blue-200";
    label = "1.1x Bonus";
  } else if (multiplier >= 1.0) {
    color = "bg-amber-50 text-amber-700 border-amber-200";
    label = "1.0x Base";
  } else {
    color = "bg-red-50 text-red-700 border-red-200";
    label = "0x Docked";
  }
  return <Badge variant="outline" className={`${color} text-xs font-semibold px-2 py-0.5`}>{label}</Badge>;
}

function CleanersTab() {
  const { data: scorecards, isLoading } = trpc.compensation.attribution.scorecards.useQuery();
  const { data: stats } = trpc.compensation.attribution.stats.useQuery();
  const { data: legacyData } = trpc.analyze.cleaners.useQuery();
  const runAttribution = trpc.compensation.attribution.run.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Attribution complete: ${result.attributedReviews} reviews attributed, ${result.newCleaners} new cleaners`
      );
      utils.compensation.attribution.scorecards.invalidate();
      utils.compensation.attribution.stats.invalidate();
    },
    onError: (err) => toast.error(`Attribution failed: ${err.message}`),
  });
  const utils = trpc.useUtils();

  const hasAttributionData = scorecards && scorecards.length > 0;
  const hasLegacyData = legacyData && legacyData.length > 0;

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      {/* Attribution Stats Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Cleaner scorecards based on Breezeway task → Hostaway review attribution.
          </p>
          {stats && (
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalAttributions.toLocaleString()} attributions across {stats.totalCleaners} cleaners
              ({stats.attributionRate}% of {stats.totalReviews.toLocaleString()} reviews)
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runAttribution.mutate()}
          disabled={runAttribution.isPending}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${runAttribution.isPending ? "animate-spin" : ""}`} />
          {runAttribution.isPending ? "Running..." : "Run Attribution"}
        </Button>
      </div>

      {!hasAttributionData && !hasLegacyData && (
        <Card className="p-12 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">
            No cleaner data yet. Click "Run Attribution" to cross-reference Breezeway cleaning tasks with Hostaway reviews.
          </p>
          <Button
            onClick={() => runAttribution.mutate()}
            disabled={runAttribution.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${runAttribution.isPending ? "animate-spin" : ""}`} />
            {runAttribution.isPending ? "Running Attribution..." : "Run Attribution Now"}
          </Button>
        </Card>
      )}

      {hasAttributionData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scorecards!.map((cleaner) => (
            <Card key={cleaner.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-lg">{cleaner.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {cleaner.totalReviews} reviews · {cleaner.propertyCount} properties
                  </p>
                  {cleaner.email && (
                    <p className="text-xs text-muted-foreground">{cleaner.email}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <MultiplierBadge multiplier={cleaner.multiplier} />
                </div>
              </div>

              {/* Rolling Score Section */}
              <div className="rounded-lg border bg-gradient-to-r from-slate-50 to-white p-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">30-Day Rolling Score</span>
                  {cleaner.rollingScore30d !== null ? (
                    <span className="text-2xl font-bold tabular-nums">
                      {cleaner.rollingScore30d.toFixed(2)}
                      <Star className="inline h-4 w-4 ml-0.5 text-amber-500 fill-amber-500" />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">No recent reviews</span>
                  )}
                </div>
                {/* Score progress bar */}
                {cleaner.rollingScore30d !== null && (
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                    <div
                      className={`h-full rounded-full transition-all ${
                        cleaner.rollingScore30d >= 5.0 ? "bg-emerald-500" :
                        cleaner.rollingScore30d >= 4.8 ? "bg-blue-500" :
                        cleaner.rollingScore30d >= 4.6 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min((cleaner.rollingScore30d / 5) * 100, 100)}%` }}
                    />
                  </div>
                )}
                {/* Next tier indicator */}
                {cleaner.nextTier && (
                  <p className="text-xs text-muted-foreground">
                    <ArrowUpRight className="inline h-3 w-3 mr-0.5" />
                    {cleaner.nextTier.label}
                  </p>
                )}
                {!cleaner.nextTier && cleaner.rollingScore30d !== null && cleaner.rollingScore30d >= 5.0 && (
                  <p className="text-xs text-emerald-600 font-medium">
                    ✓ At maximum tier (1.5x)
                  </p>
                )}
              </div>

              {/* All-time average */}
              {cleaner.allTimeAvg !== null && (
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-3 px-1">
                  <span>All-time average: <strong className="text-foreground">{cleaner.allTimeAvg.toFixed(2)}★</strong></span>
                  <span>{cleaner.recentReviews} reviews in last 30d</span>
                </div>
              )}

              {/* Stats grid */}
              <div className="flex gap-3 text-center text-xs mb-3">
                <div className="flex-1 p-2 rounded bg-muted">
                  <p className="font-bold text-lg">{cleaner.totalReviews}</p>
                  <p className="text-muted-foreground">Total Reviews</p>
                </div>
                <div className="flex-1 p-2 rounded bg-muted">
                  <p className="font-bold text-lg">{cleaner.propertyCount}</p>
                  <p className="text-muted-foreground">Properties</p>
                </div>
                <div className="flex-1 p-2 rounded bg-muted">
                  <p className="font-bold text-lg">{cleaner.recentReviews}</p>
                  <p className="text-muted-foreground">Recent (30d)</p>
                </div>
              </div>

              {/* Rating distribution */}
              {cleaner.ratingDistribution && (
                <div className="flex gap-1 text-xs mb-3">
                  <div className="flex-1 text-center p-1 rounded bg-emerald-50 text-emerald-700">
                    <span className="font-bold">{cleaner.ratingDistribution.five}</span> × 5★
                  </div>
                  <div className="flex-1 text-center p-1 rounded bg-blue-50 text-blue-700">
                    <span className="font-bold">{cleaner.ratingDistribution.four}</span> × 4★
                  </div>
                  <div className="flex-1 text-center p-1 rounded bg-amber-50 text-amber-700">
                    <span className="font-bold">{cleaner.ratingDistribution.three}</span> × 3★
                  </div>
                  <div className="flex-1 text-center p-1 rounded bg-red-50 text-red-700">
                    <span className="font-bold">{cleaner.ratingDistribution.twoOrBelow}</span> × ≤2★
                  </div>
                </div>
              )}

              {/* Recent reviews */}
              {cleaner.recentReviewsList && cleaner.recentReviewsList.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Recent Reviews:</p>
                  <div className="space-y-1">
                    {cleaner.recentReviewsList.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1">
                          {r.rating !== null && <RatingStars rating={r.rating} />}
                        </span>
                        <span className="text-muted-foreground">
                          {r.date ? new Date(r.date).toLocaleDateString() : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Fallback: Show legacy AI-detected cleaner mentions if no attribution data */}
      {!hasAttributionData && hasLegacyData && (
        <>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Showing AI-detected cleaner mentions from review text. Run Attribution above for accurate Breezeway-based scoring.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {legacyData.map((cleaner) => (
              <Card key={cleaner.name} className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{cleaner.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {cleaner.reviewCount} mentions · {cleaner.propertyCount} properties
                    </p>
                  </div>
                  <SentimentBadge score={cleaner.avgSentiment} />
                </div>
                <div className="flex gap-4 text-center text-xs">
                  <div className="flex-1 p-2 rounded bg-muted">
                    <p className="font-bold text-lg">{cleaner.reviewCount}</p>
                    <p className="text-muted-foreground">Mentions</p>
                  </div>
                  <div className="flex-1 p-2 rounded bg-muted">
                    <p className="font-bold text-lg">{cleaner.issueCount}</p>
                    <p className="text-muted-foreground">Issues</p>
                  </div>
                  <div className="flex-1 p-2 rounded bg-muted">
                    <p className="font-bold text-lg">{cleaner.highlightCount}</p>
                    <p className="text-muted-foreground">Highlights</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Flagged Tab ───────────────────────────────────────────────────────

function FlaggedTab({ filters }: { filters: AnalyzeFilters }) {
  const [severity, setSeverity] = useState<string>("all");
  const { data, isLoading } = trpc.analyze.flagged.useQuery({
    listingId: filters.listingId,
    podId: filters.podId,
    severity: severity !== "all" ? severity : undefined,
    limit: 100,
    timeRange: filters.timeRange !== "all" ? filters.timeRange : undefined,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Reviews with AI-detected issues requiring attention
        </p>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!data || data.length === 0 ? (
        <Card className="p-12 text-center">
          <Flag className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No flagged reviews found. Analyze reviews to detect issues.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((review) => (
            <Card key={review.id} className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{review.guestName || "Anonymous"}</span>
                    <RatingStars rating={review.rating || 0} />
                    <Badge variant="outline" className="text-xs">{review.source}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(review.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {review.analysis && <SentimentBadge score={review.analysis.sentimentScore} />}
              </div>

              {review.text && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-3">{review.text}</p>
              )}

              {review.analysis?.summary && (
                <p className="text-sm italic text-foreground mb-3">AI: {review.analysis.summary}</p>
              )}

              {review.analysis?.issues && (review.analysis.issues as any[]).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-red-700">Detected Issues:</p>
                  {(review.analysis.issues as Array<{ type: string; description: string; severity: string; quote: string }>).map((issue, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs bg-red-50 p-2 rounded">
                      <SeverityBadge severity={issue.severity} />
                      <div>
                        <span className="font-medium">{issue.type}:</span> {issue.description}
                        {issue.quote && (
                          <p className="text-muted-foreground italic mt-0.5">"{issue.quote}"</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Comparison Tab ─────────────────────────────────────────────────────

function ComparisonTab({ filters }: { filters: AnalyzeFilters }) {
  const { data, isLoading } = trpc.analyze.comparison.useQuery({
    listingId: filters.listingId,
    podId: filters.podId,
    timeRange: filters.timeRange !== "all" ? filters.timeRange : undefined,
    startDate: filters.startDate,
    endDate: filters.endDate,
    state: filters.state,
  });
  const [sortBy, setSortBy] = useState<string>("reviewCount");

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      switch (sortBy) {
        case "avgRating": return b.avgRating - a.avgRating;
        case "avgSentiment": return b.avgSentiment - a.avgSentiment;
        case "issueCount": return b.issueCount - a.issueCount;
        default: return b.reviewCount - a.reviewCount;
      }
    });
  }, [data, sortBy]);

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Compare property performance side-by-side
        </p>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reviewCount">Most Reviews</SelectItem>
            <SelectItem value="avgRating">Highest Rating</SelectItem>
            <SelectItem value="avgSentiment">Best Sentiment</SelectItem>
            <SelectItem value="issueCount">Most Issues</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sorted.length === 0 ? (
        <Card className="p-12 text-center">
          <GitCompare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No comparison data available</p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 font-medium">Property</th>
                <th className="pb-2 font-medium text-center">Reviews</th>
                <th className="pb-2 font-medium text-center">Avg Rating</th>
                <th className="pb-2 font-medium text-center">Sentiment</th>
                <th className="pb-2 font-medium text-center">Issues</th>
                <th className="pb-2 font-medium">Top Issue</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 50).map((p) => (
                <tr key={p.listingId} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="py-2.5 font-medium max-w-[200px] truncate">{p.name}</td>
                  <td className="py-2.5 text-center">{p.reviewCount}</td>
                  <td className="py-2.5 text-center">
                    <RatingStars rating={p.avgRating} />
                  </td>
                  <td className="py-2.5 text-center">
                    <SentimentBadge score={p.avgSentiment} />
                  </td>
                  <td className="py-2.5 text-center">
                    {p.issueCount > 0 ? (
                      <Badge variant="outline" className="text-red-600 border-red-200">{p.issueCount}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="py-2.5 text-xs capitalize text-muted-foreground">{p.topIssueType || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Feed Tab ──────────────────────────────────────────────────────────

function FeedTab({ filters }: { filters: AnalyzeFilters }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<string>("all");
  const [sentiment, setSentiment] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const { data, isLoading } = trpc.analyze.feed.useQuery({
    listingId: filters.listingId,
    podId: filters.podId,
    source: source !== "all" ? source : undefined,
    sentiment: sentiment !== "all" ? sentiment : undefined,
    search: search || undefined,
    limit,
    offset,
    timeRange: filters.timeRange !== "all" ? filters.timeRange : undefined,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reviews..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="pl-9"
          />
        </div>
        <Select value={source} onValueChange={(v) => { setSource(v); setOffset(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="airbnb">Airbnb</SelectItem>
            <SelectItem value="vrbo">VRBO</SelectItem>
            <SelectItem value="booking">Booking</SelectItem>
            <SelectItem value="direct">Direct</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sentiment} onValueChange={(v) => { setSentiment(v); setOffset(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Sentiment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sentiment</SelectItem>
            <SelectItem value="positive">Positive</SelectItem>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="negative">Negative</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      {data && (
        <p className="text-xs text-muted-foreground">
          Showing {offset + 1}–{Math.min(offset + limit, data.total)} of {data.total} reviews
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : !data || data.reviews.length === 0 ? (
        <Card className="p-12 text-center">
          <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No reviews match your filters</p>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {data.reviews.map((review) => (
              <Card key={review.id} className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{review.guestName || "Anonymous"}</span>
                    <RatingStars rating={review.rating || 0} />
                    <Badge variant="outline" className="text-xs">{review.source}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(review.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {review.text && (
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-4">{review.text}</p>
                )}

                {review.analysis && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                    <SentimentBadge score={review.analysis.sentimentScore} />
                    {review.analysis.summary && (
                      <span className="text-xs text-muted-foreground italic">{review.analysis.summary}</span>
                    )}
                    {review.analysis.issues && (review.analysis.issues as any[]).length > 0 && (
                      <Badge variant="outline" className="text-red-600 border-red-200 text-xs ml-auto">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {(review.analysis.issues as any[]).length} issue(s)
                      </Badge>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {data.total > limit && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {Math.floor(offset / limit) + 1} of {Math.ceil(data.total / limit)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + limit >= data.total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
