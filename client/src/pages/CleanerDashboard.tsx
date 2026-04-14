/**
 * Cleaner Pay Dashboard — Public token-based page (no login required).
 *
 * Accessible at /cleaner/:token
 * Shows: reviews, cleaning score summary, weekly pay breakdown.
 * IMPORTANT: Never shows cleaning fee amounts or revenue data.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Star,
  DollarSign,
  TrendingUp,
  MapPin,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Award,
  Zap,
  Car,
  Phone,
  Wrench,
  Loader2,
  AlertCircle,
  Upload,
  Camera,
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type Period = "week" | "month" | "year" | "all";

interface CleanerDashboardProps {
  token: string;
}

function CleanerDashboard({ token }: CleanerDashboardProps) {
  const [period, setPeriod] = useState<Period>("month");
  const [weekOffset, setWeekOffset] = useState(0);
  const [receiptType, setReceiptType] = useState<"cell_phone" | "vehicle_maintenance">("cell_phone");
  const [isUploading, setIsUploading] = useState(false);

  // Get the Monday of the target week
  const weekOf = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(now.setDate(diff));
    monday.setDate(monday.getDate() + weekOffset * 7);
    return monday.toISOString().split("T")[0];
  }, [weekOffset]);

  // Queries
  const profileQuery = trpc.cleanerDashboard.getByToken.useQuery({ token });
  const reviewsQuery = trpc.cleanerDashboard.reviews.useQuery({ token, period });
  const weeklyPayQuery = trpc.cleanerDashboard.weeklyPay.useQuery({ token, weekOf });
  const payHistoryQuery = trpc.cleanerDashboard.payHistory.useQuery({ token, limit: 8 });
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const myReceiptsQuery = trpc.cleanerDashboard.myReceipts.useQuery({ token, month: currentMonth });
  const submitReceiptMutation = trpc.cleanerDashboard.submitReceipt.useMutation({
    onSuccess: () => {
      toast.success("Receipt submitted! Your receipt has been uploaded for review.");
      myReceiptsQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Upload failed: ${err.message}`);
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large — max 10MB.");
      return;
    }
    setIsUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      await submitReceiptMutation.mutateAsync({
        token,
        type: receiptType,
        month: currentMonth,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type || "application/octet-stream",
      });
    } catch {
      // Error handled by mutation onError
    } finally {
      setIsUploading(false);
      e.target.value = ""; // Reset file input
    }
  };

  // Loading state
  if (profileQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mx-auto mb-4" />
          <p className="text-emerald-300 text-sm">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (!profileQuery.data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950 flex items-center justify-center">
        <Card className="max-w-md mx-auto bg-emerald-900/50 border-emerald-700">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Dashboard Not Found</h2>
            <p className="text-emerald-300 text-sm">
              This link may be invalid or expired. Contact your manager for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const profile = profileQuery.data;
  const reviews = reviewsQuery.data;
  const weeklyPay = weeklyPayQuery.data;
  const payHistory = payHistoryQuery.data;

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;
  const formatDate = (date: string | Date) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getQualityColor = (multiplier: number) => {
    if (multiplier >= 1.5) return { bg: "bg-emerald-500/20", text: "text-emerald-300", border: "border-emerald-500/30" };
    if (multiplier >= 1.2) return { bg: "bg-amber-500/20", text: "text-amber-300", border: "border-amber-500/30" };
    return { bg: "bg-red-500/20", text: "text-red-300", border: "border-red-500/30" };
  };

  const getVolumeColor = (label: string) => {
    if (label === "Gold") return { bg: "bg-yellow-500/20", text: "text-yellow-300" };
    if (label === "Silver") return { bg: "bg-slate-400/20", text: "text-slate-300" };
    return { bg: "bg-zinc-500/20", text: "text-zinc-400" };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-950">
      {/* Header */}
      <div className="bg-emerald-900/50 border-b border-emerald-700/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-lg">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-white font-semibold text-lg">{profile.name}</h1>
              <p className="text-emerald-400 text-xs">Wand Cleaning Team</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-emerald-400" />
            <span className="text-emerald-300 text-sm font-medium">Wand</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Score Summary Card */}
        <Card className="bg-emerald-900/30 border-emerald-700/50 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-800/50 to-emerald-700/30 px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-emerald-400 text-xs uppercase tracking-wider font-medium mb-1">
                  30-Day Cleaning Score
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-white">
                    {profile.qualityScore != null ? Number(profile.qualityScore).toFixed(2) : "—"}
                  </span>
                  <span className="text-emerald-400 text-sm">/ 5.00</span>
                </div>
              </div>
              {weeklyPay && (
                <div className="flex gap-3">
                  <div className={`px-3 py-2 rounded-lg ${getQualityColor(weeklyPay.qualityMultiplier).bg} ${getQualityColor(weeklyPay.qualityMultiplier).border} border`}>
                    <p className="text-[10px] uppercase tracking-wider text-emerald-400 mb-0.5">Quality</p>
                    <p className={`text-lg font-bold ${getQualityColor(weeklyPay.qualityMultiplier).text}`}>
                      {weeklyPay.qualityTierLabel}
                    </p>
                  </div>
                  <div className={`px-3 py-2 rounded-lg ${getVolumeColor(weeklyPay.volumeTierLabel).bg} border border-white/10`}>
                    <p className="text-[10px] uppercase tracking-wider text-emerald-400 mb-0.5">Volume</p>
                    <p className={`text-lg font-bold ${getVolumeColor(weeklyPay.volumeTierLabel).text}`}>
                      {weeklyPay.volumeTierLabel}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {/* Score bar */}
            {profile.qualityScore !== null && (
              <div className="mt-4">
                <div className="w-full bg-emerald-900/50 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min((profile.qualityScore / 5) * 100, 100)}%`,
                      background: profile.qualityScore >= 4.93
                        ? "linear-gradient(90deg, #10b981, #34d399)"
                        : profile.qualityScore >= 4.85
                        ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                        : "linear-gradient(90deg, #ef4444, #f87171)",
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-emerald-500">
                  <span>0</span>
                  <span className="border-l border-emerald-700 pl-1">4.85</span>
                  <span className="border-l border-emerald-700 pl-1">4.93</span>
                  <span>5.0</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Main Tabs */}
        <Tabs defaultValue="pay" className="space-y-4">
          <TabsList className="bg-emerald-900/50 border border-emerald-700/50 w-full grid grid-cols-4">
            <TabsTrigger value="pay" className="data-[state=active]:bg-emerald-700 data-[state=active]:text-white text-emerald-400">
              <DollarSign className="h-4 w-4 mr-1.5" />
              Pay
            </TabsTrigger>
            <TabsTrigger value="reviews" className="data-[state=active]:bg-emerald-700 data-[state=active]:text-white text-emerald-400">
              <Star className="h-4 w-4 mr-1.5" />
              Reviews
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-emerald-700 data-[state=active]:text-white text-emerald-400">
              <TrendingUp className="h-4 w-4 mr-1.5" />
              History
            </TabsTrigger>
            <TabsTrigger value="receipts" className="data-[state=active]:bg-emerald-700 data-[state=active]:text-white text-emerald-400">
              <FileText className="h-4 w-4 mr-1.5" />
              Receipts
            </TabsTrigger>
          </TabsList>

          {/* ── Pay Tab ─────────────────────────────────────────── */}
          <TabsContent value="pay" className="space-y-4">
            {/* Week Navigation */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-400 hover:text-white hover:bg-emerald-800"
                onClick={() => setWeekOffset((o) => o - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev Week
              </Button>
              <span className="text-emerald-300 text-sm font-medium">
                Week of {formatDate(weekOf)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-400 hover:text-white hover:bg-emerald-800"
                onClick={() => setWeekOffset((o) => Math.min(o + 1, 0))}
                disabled={weekOffset >= 0}
              >
                Next Week
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {weeklyPayQuery.isLoading ? (
              <Card className="bg-emerald-900/30 border-emerald-700/50">
                <CardContent className="py-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-400 mx-auto" />
                </CardContent>
              </Card>
            ) : !weeklyPay ? (
              <Card className="bg-emerald-900/30 border-emerald-700/50">
                <CardContent className="py-8 text-center">
                  <p className="text-emerald-400 text-sm">No pay data for this week.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Pay Breakdown */}
                <Card className="bg-emerald-900/30 border-emerald-700/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-white text-base flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-emerald-400" />
                      Pay Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Base Pay */}
                    <div className="flex justify-between items-center py-2 border-b border-emerald-800/50">
                      <div>
                        <p className="text-white text-sm font-medium">Base Pay</p>
                        <p className="text-emerald-500 text-xs">{weeklyPay.totalCleans} clean{weeklyPay.totalCleans !== 1 ? "s" : ""}</p>
                      </div>
                      <span className="text-white font-semibold">{formatCurrency(weeklyPay.basePay)}</span>
                    </div>

                    {/* Quality Multiplier */}
                    <div className="flex justify-between items-center py-2 border-b border-emerald-800/50">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-emerald-400" />
                        <div>
                          <p className="text-white text-sm font-medium">Quality Multiplier</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge className={`text-[10px] px-1.5 py-0 ${getQualityColor(weeklyPay.qualityMultiplier).bg} ${getQualityColor(weeklyPay.qualityMultiplier).text} border-0`}>
                              {weeklyPay.qualityTierLabel}
                            </Badge>
                            {weeklyPay.qualityScore !== null && (
                              <span className="text-emerald-500 text-xs">
                                Score: {Number(weeklyPay.qualityScore).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="text-white font-semibold">×{Number(weeklyPay.qualityMultiplier ?? 1).toFixed(1)}</span>
                    </div>

                    {/* Volume Multiplier */}
                    <div className="flex justify-between items-center py-2 border-b border-emerald-800/50">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-400" />
                        <div>
                          <p className="text-white text-sm font-medium">Volume Multiplier</p>
                          <Badge className={`text-[10px] px-1.5 py-0 mt-0.5 ${getVolumeColor(weeklyPay.volumeTierLabel).bg} ${getVolumeColor(weeklyPay.volumeTierLabel).text} border-0`}>
                            {weeklyPay.volumeTierLabel}
                          </Badge>
                        </div>
                      </div>
                      <span className="text-white font-semibold">×{Number(weeklyPay.volumeMultiplier ?? 1).toFixed(1)}</span>
                    </div>

                    {/* Mileage */}
                    {weeklyPay.mileagePay > 0 && (
                      <div className="flex justify-between items-center py-2 border-b border-emerald-800/50">
                        <div className="flex items-center gap-2">
                          <Car className="h-4 w-4 text-emerald-400" />
                          <div>
                            <p className="text-white text-sm font-medium">Mileage</p>
                            <p className="text-emerald-500 text-xs">
                              {Number(weeklyPay.totalMileage ?? 0).toFixed(1)} mi × {formatCurrency(weeklyPay.mileageRate ?? 0)}/mi
                            </p>
                          </div>
                        </div>
                        <span className="text-emerald-300 font-semibold">+{formatCurrency(weeklyPay.mileagePay)}</span>
                      </div>
                    )}

                    {/* Reimbursements */}
                    {(weeklyPay.cellPhoneReimbursement > 0 || weeklyPay.vehicleReimbursement > 0) && (
                      <div className="py-2 border-b border-emerald-800/50 space-y-2">
                        <p className="text-emerald-400 text-xs uppercase tracking-wider font-medium">Reimbursements</p>
                        {weeklyPay.cellPhoneReimbursement > 0 && (
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <Phone className="h-3.5 w-3.5 text-emerald-500" />
                              <span className="text-white text-sm">Cell Phone</span>
                            </div>
                            <span className="text-emerald-300 font-semibold">+{formatCurrency(weeklyPay.cellPhoneReimbursement)}</span>
                          </div>
                        )}
                        {weeklyPay.vehicleReimbursement > 0 && (
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <Wrench className="h-3.5 w-3.5 text-emerald-500" />
                              <span className="text-white text-sm">Vehicle Maintenance</span>
                            </div>
                            <span className="text-emerald-300 font-semibold">+{formatCurrency(weeklyPay.vehicleReimbursement)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Total */}
                    <div className="flex justify-between items-center pt-3">
                      <p className="text-white text-lg font-bold">Total Pay</p>
                      <p className="text-emerald-300 text-2xl font-bold">{formatCurrency(weeklyPay.totalPay)}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Cleans List */}
                {weeklyPay.cleans.length > 0 && (
                  <Card className="bg-emerald-900/30 border-emerald-700/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white text-base flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-emerald-400" />
                        Cleans This Week
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {weeklyPay.cleans.map((clean, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between py-2 px-3 rounded-lg bg-emerald-800/20 border border-emerald-700/30"
                          >
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span className="text-white text-sm">{clean.propertyName}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-emerald-400">
                              {clean.distanceMiles && (
                                <span>{(Number(clean.distanceMiles ?? 0) * 2).toFixed(1)} mi RT</span>
                              )}
                              {clean.scheduledDate && (
                                <span>{formatDate(clean.scheduledDate)}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Reviews Tab ─────────────────────────────────────── */}
          <TabsContent value="reviews" className="space-y-4">
            {/* Period Selector */}
            <div className="flex gap-2">
              {(["week", "month", "year", "all"] as Period[]).map((p) => (
                <Button
                  key={p}
                  variant={period === p ? "default" : "outline"}
                  size="sm"
                  className={
                    period === p
                      ? "bg-emerald-700 text-white hover:bg-emerald-600"
                      : "text-emerald-400 border-emerald-700 hover:bg-emerald-800 hover:text-white bg-transparent"
                  }
                  onClick={() => setPeriod(p)}
                >
                  {p === "week" ? "This Week" : p === "month" ? "This Month" : p === "year" ? "This Year" : "All Time"}
                </Button>
              ))}
            </div>

            {/* Score Summary */}
            {reviews && (
              <Card className="bg-emerald-900/30 border-emerald-700/50">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-emerald-400 text-xs uppercase tracking-wider">
                        {period === "week" ? "This Week" : period === "month" ? "This Month" : period === "year" ? "This Year" : "All Time"} Average
                      </p>
                      <p className="text-3xl font-bold text-white mt-1">
                        {reviews.averageScore != null ? Number(reviews.averageScore).toFixed(2) : "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-emerald-400 text-xs">Reviews</p>
                      <p className="text-2xl font-bold text-white">{reviews.reviewCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Reviews List */}
            {reviewsQuery.isLoading ? (
              <Card className="bg-emerald-900/30 border-emerald-700/50">
                <CardContent className="py-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-400 mx-auto" />
                </CardContent>
              </Card>
            ) : !reviews || reviews.reviews.length === 0 ? (
              <Card className="bg-emerald-900/30 border-emerald-700/50">
                <CardContent className="py-8 text-center">
                  <Star className="h-8 w-8 text-emerald-700 mx-auto mb-2" />
                  <p className="text-emerald-400 text-sm">No reviews for this period.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {reviews.reviews.map((review: any) => {
                  const score = Number(review.scoreUsed ?? 0);
                  const scoreColor =
                    score >= 4.9
                      ? "bg-emerald-700 text-white"
                      : score >= 4.7
                      ? "bg-emerald-800 text-emerald-100"
                      : score >= 4.0
                      ? "bg-amber-700 text-amber-50"
                      : "bg-red-800 text-red-50";
                  const sourceColor =
                    review.source === "airbnb"
                      ? "bg-rose-900/50 text-rose-300 border-rose-700/50"
                      : review.source === "vrbo"
                      ? "bg-sky-900/50 text-sky-300 border-sky-700/50"
                      : "bg-emerald-900/50 text-emerald-300 border-emerald-700/50";
                  return (
                    <Card key={review.id} className="bg-emerald-900/30 border-emerald-700/50">
                      <CardContent className="py-4 space-y-2">
                        {/* Top row: source + property + score */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase ${sourceColor}`}
                            >
                              {review.source}
                            </Badge>
                            <span className="text-white text-sm font-medium truncate">
                              {review.propertyName}
                            </span>
                          </div>
                          {review.scoreUsed != null && (
                            <span
                              className={`text-sm font-bold px-2 py-0.5 rounded ${scoreColor}`}
                            >
                              {Number(review.scoreUsed).toFixed(1)}
                            </span>
                          )}
                        </div>

                        {/* Ratings row */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-400">
                          {review.cleanlinessRating != null && (
                            <span>
                              Cleanliness:{" "}
                              <strong className="text-emerald-200">
                                {review.cleanlinessRating}
                              </strong>
                              /5
                            </span>
                          )}
                          {review.rating != null && (
                            <span>
                              Overall:{" "}
                              <strong className="text-emerald-200">{review.rating}</strong>
                            </span>
                          )}
                          {review.scoreReason && (
                            <span className="italic text-[10px] text-emerald-500">
                              {review.scoreReason}
                            </span>
                          )}
                        </div>

                        {/* Dates */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-emerald-500">
                          {review.arrivalDate && <span>Guest arrival: {review.arrivalDate}</span>}
                          {review.submittedAt && <span>Reviewed: {review.submittedAt}</span>}
                          {review.matchedCleanDate && (
                            <span className="text-indigo-300">
                              Matched clean: {review.matchedCleanDate}
                            </span>
                          )}
                        </div>

                        {/* Public review */}
                        {review.publicReview && (
                          <div className="rounded-md bg-emerald-800/30 border border-emerald-700/40 p-2.5">
                            <p className="text-[10px] font-medium text-emerald-400 uppercase tracking-wide mb-1">
                              Public Review
                            </p>
                            <p className="text-xs text-emerald-100 leading-relaxed whitespace-pre-line">
                              {review.publicReview}
                            </p>
                          </div>
                        )}

                        {/* Private feedback */}
                        {review.privateFeedback && (
                          <div className="rounded-md bg-amber-900/20 border border-amber-700/40 p-2.5">
                            <p className="text-[10px] font-medium text-amber-300 uppercase tracking-wide mb-1">
                              Private Feedback
                            </p>
                            <p className="text-xs text-amber-50 leading-relaxed whitespace-pre-line">
                              {review.privateFeedback}
                            </p>
                          </div>
                        )}

                        {/* AI summary (if no public/private text) */}
                        {!review.publicReview && !review.privateFeedback && review.excerpt && (
                          <p className="text-emerald-300 text-xs leading-relaxed bg-emerald-800/20 rounded p-2">
                            {review.excerpt}
                          </p>
                        )}

                        {review.guestName && (
                          <p className="text-[10px] text-emerald-500">— {review.guestName}</p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── History Tab ──────────────────────────────────────── */}
          <TabsContent value="history" className="space-y-4">
            <Card className="bg-emerald-900/30 border-emerald-700/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-base">Pay History</CardTitle>
                <CardDescription className="text-emerald-500 text-xs">Last 8 weeks</CardDescription>
              </CardHeader>
              <CardContent>
                {payHistoryQuery.isLoading ? (
                  <div className="py-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-400 mx-auto" />
                  </div>
                ) : !payHistory || payHistory.length === 0 ? (
                  <div className="py-8 text-center">
                    <TrendingUp className="h-8 w-8 text-emerald-700 mx-auto mb-2" />
                    <p className="text-emerald-400 text-sm">No pay history yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {payHistory.map((week: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-3 px-3 rounded-lg bg-emerald-800/20 border border-emerald-700/30 cursor-pointer hover:bg-emerald-800/30 transition-colors"
                        onClick={() => {
                          setWeekOffset(
                            Math.round(
                              (new Date(week.weekOf).getTime() - new Date().getTime()) /
                                (7 * 24 * 60 * 60 * 1000)
                            )
                          );
                        }}
                      >
                        <div>
                          <p className="text-white text-sm font-medium">
                            Week of {formatDate(week.weekOf)}
                          </p>
                          <p className="text-emerald-500 text-xs">
                            {week.totalCleans} clean{week.totalCleans !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-emerald-300 font-bold">{formatCurrency(week.totalPay)}</p>
                          <div className="flex gap-1 mt-0.5">
                            <Badge className={`text-[9px] px-1 py-0 ${getQualityColor(week.qualityMultiplier).bg} ${getQualityColor(week.qualityMultiplier).text} border-0`}>
                              {week.qualityTierLabel}
                            </Badge>
                            <Badge className={`text-[9px] px-1 py-0 ${getVolumeColor(week.volumeTierLabel).bg} ${getVolumeColor(week.volumeTierLabel).text} border-0`}>
                              {week.volumeTierLabel}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Receipts Tab ─────────────────────────────────────────── */}
          <TabsContent value="receipts" className="space-y-4">
            <Card className="bg-emerald-900/30 border-emerald-700/50">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Upload className="h-5 w-5 text-emerald-400" />
                  Submit Monthly Receipts
                </CardTitle>
                <CardDescription className="text-emerald-400">
                  Upload your cell phone bill or vehicle maintenance receipts for {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
                  Deadline: 5th of each month.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Receipt type selector */}
                <div className="flex gap-2">
                  <Button
                    variant={receiptType === "cell_phone" ? "default" : "outline"}
                    size="sm"
                    className={receiptType === "cell_phone"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "border-emerald-700 text-emerald-400 hover:bg-emerald-800 hover:text-white"}
                    onClick={() => setReceiptType("cell_phone")}
                  >
                    <Phone className="h-4 w-4 mr-1.5" />
                    Cell Phone Bill
                  </Button>
                  <Button
                    variant={receiptType === "vehicle_maintenance" ? "default" : "outline"}
                    size="sm"
                    className={receiptType === "vehicle_maintenance"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "border-emerald-700 text-emerald-400 hover:bg-emerald-800 hover:text-white"}
                    onClick={() => setReceiptType("vehicle_maintenance")}
                  >
                    <Wrench className="h-4 w-4 mr-1.5" />
                    Vehicle Maintenance
                  </Button>
                </div>

                {/* Upload area */}
                <label className="block cursor-pointer">
                  <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    isUploading
                      ? "border-emerald-500 bg-emerald-900/30"
                      : "border-emerald-700/50 hover:border-emerald-500 hover:bg-emerald-900/20"
                  }`}>
                    {isUploading ? (
                      <>
                        <Loader2 className="h-10 w-10 animate-spin text-emerald-400 mx-auto mb-3" />
                        <p className="text-emerald-300 text-sm">Uploading...</p>
                      </>
                    ) : (
                      <>
                        <Camera className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                        <p className="text-white font-medium mb-1">Tap to take a photo or choose a file</p>
                        <p className="text-emerald-500 text-xs">PDF, JPG, PNG — max 10MB</p>
                      </>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                  />
                </label>
              </CardContent>
            </Card>

            {/* Submitted receipts for current month */}
            <Card className="bg-emerald-900/30 border-emerald-700/50">
              <CardHeader>
                <CardTitle className="text-white text-base">This Month's Submissions</CardTitle>
              </CardHeader>
              <CardContent>
                {myReceiptsQuery.isLoading ? (
                  <div className="text-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-emerald-400 mx-auto" />
                  </div>
                ) : !myReceiptsQuery.data?.length ? (
                  <p className="text-emerald-500 text-sm text-center py-4">
                    No receipts submitted yet this month.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {myReceiptsQuery.data.map((receipt) => (
                      <div
                        key={receipt.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-emerald-900/30 border border-emerald-700/30"
                      >
                        <div className="flex items-center gap-3">
                          {receipt.type === "cell_phone" ? (
                            <Phone className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <Wrench className="h-4 w-4 text-emerald-400" />
                          )}
                          <div>
                            <p className="text-white text-sm font-medium">
                              {receipt.type === "cell_phone" ? "Cell Phone Bill" : "Vehicle Maintenance"}
                            </p>
                            <p className="text-emerald-500 text-xs">
                              {receipt.fileName || "Receipt"}
                            </p>
                          </div>
                        </div>
                        <Badge
                          className={`text-xs border-0 ${
                            receipt.status === "approved"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : receipt.status === "rejected"
                              ? "bg-red-500/20 text-red-300"
                              : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {receipt.status === "approved" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {receipt.status === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                          {receipt.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                          {receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-emerald-700 text-xs">
            Powered by Wand · Questions? Contact your manager.
          </p>
        </div>
      </div>
    </div>
  );
}

export default CleanerDashboard;
