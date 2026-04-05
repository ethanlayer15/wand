/**
 * Google Maps API client — Distance Matrix and geocoding.
 */

import { ENV } from "./env";

export interface DistanceMatrixResult {
  destination_addresses: string[];
  origin_addresses: string[];
  rows: Array<{
    elements: Array<{
      distance?: { text: string; value: number };
      duration?: { text: string; value: number };
      status: string;
    }>;
  }>;
  status: string;
}

const MAPS_BASE_URL = "https://maps.googleapis.com";

export async function makeRequest<T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(path, MAPS_BASE_URL);

  // Add API key
  url.searchParams.set("key", (ENV as any).googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY || "");

  // Add all params
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google Maps API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
