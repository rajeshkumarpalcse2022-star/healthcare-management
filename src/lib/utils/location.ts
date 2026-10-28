export interface MapCoordinates {
  latitude: number | null;
  longitude: number | null;
}

export function hasMapLocation(
  value: MapCoordinates | null | undefined,
): value is { latitude: number; longitude: number } {
  return (
    typeof value?.latitude === "number" && typeof value?.longitude === "number"
  );
}

export function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}
