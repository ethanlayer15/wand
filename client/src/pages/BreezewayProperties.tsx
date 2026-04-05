import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";

export default function BreezewayProperties() {
  const { data: properties, isLoading } =
    trpc.breezeway.properties.list.useQuery();

  return (
    <div className="space-y-6 p-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="wand-page-title">Breezeway Properties</h1>
        <p className="text-sm text-muted-foreground">
          {properties?.length || 0} properties synced from Breezeway
        </p>
      </div>

      {/* Properties grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </>
        ) : properties && properties.length > 0 ? (
          properties.map((property) => (
            <Card
              key={property.id}
              className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
            >
              {/* Image placeholder */}
              <div className="w-full h-32 bg-gradient-to-br from-cyan-200 to-cyan-300 flex items-center justify-center">
                {property.photoUrl ? (
                  <img
                    src={property.photoUrl}
                    alt={property.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 className="h-8 w-8 text-cyan-600" />
                )}
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="font-semibold text-sm line-clamp-2 mb-2">
                  {property.name}
                </h3>

                <p className="text-xs text-muted-foreground mb-3">
                  {property.city}, {property.state}
                </p>

                <div className="flex items-center justify-between pt-3 border-t">
                  <span className="text-xs font-medium text-cyan-600 bg-cyan-50 px-2 py-1 rounded">
                    {property.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ID: {property.breezewayId.slice(0, 8)}...
                  </span>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <div className="col-span-full text-center py-12">
            <p className="text-muted-foreground">
              No properties synced yet. Configure Breezeway in Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
