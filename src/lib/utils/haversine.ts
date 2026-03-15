const R = 6371; // Earth radius in km

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterJobsByRadius<T extends { location: { lat: number; lng: number } }>(
  jobs: T[],
  userLat: number,
  userLng: number,
  radiusKm: number // 0 = nationwide (no filter)
): T[] {
  if (radiusKm === 0) return jobs;
  return jobs.filter(
    (j) => haversineDistance(userLat, userLng, j.location.lat, j.location.lng) <= radiusKm
  );
}
