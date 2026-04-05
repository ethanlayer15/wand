import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, Home } from "lucide-react";

/**
 * VivAirbnb — Airbnb booking & review management.
 *
 * TODO: This file was truncated during Manus export.
 * Re-export the full VivAirbnb.tsx from Manus to restore functionality.
 */
export default function VivAirbnb() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Home className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Airbnb Inbox</h1>
      </div>
      <div className="rounded-lg border border-dashed border-muted-foreground/30 p-12 text-center">
        <p className="text-muted-foreground">
          This page needs to be re-exported from Manus. The file was truncated during zip export.
        </p>
      </div>
    </div>
  );
}
