const GEOLOCATION_TIMEOUT = 5000;
const GEOLOCATION_RETRY_DELAY = 1000;

function requestPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => resolve(null),
      { timeout: GEOLOCATION_TIMEOUT, enableHighAccuracy: false }
    );
  });
}

export async function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  const first = await requestPosition();
  if (first) return first;
  await new Promise((r) => setTimeout(r, GEOLOCATION_RETRY_DELAY));
  return requestPosition();
}

export function formatCoordsAsString(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
