import { haversineDistance, filterJobsByRadius } from './haversine';

describe('haversineDistance', () => {
  test('returns 0 for identical coordinates', () => {
    expect(haversineDistance(32.08, 34.78, 32.08, 34.78)).toBe(0);
  });

  test('Tel Aviv → Jerusalem is ~55 km', () => {
    const d = haversineDistance(32.0853, 34.7818, 31.7683, 35.2137);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(60);
  });

  test('Tel Aviv → Haifa is ~88 km', () => {
    const d = haversineDistance(32.0853, 34.7818, 32.7940, 34.9896);
    expect(d).toBeGreaterThan(80);
    expect(d).toBeLessThan(100);
  });

  test('Tel Aviv → Eilat is ~275 km', () => {
    const d = haversineDistance(32.0853, 34.7818, 29.5577, 34.9519);
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(300);
  });

  test('is symmetric (A→B equals B→A)', () => {
    const d1 = haversineDistance(32.08, 34.78, 31.76, 35.21);
    const d2 = haversineDistance(31.76, 35.21, 32.08, 34.78);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.0001);
  });

  test('returns positive distance for different points', () => {
    const d = haversineDistance(0, 0, 1, 1);
    expect(d).toBeGreaterThan(0);
  });
});

describe('filterJobsByRadius', () => {
  const jobs = [
    { id: '1', location: { lat: 32.0853, lng: 34.7818, label: 'Tel Aviv' } },
    { id: '2', location: { lat: 31.7683, lng: 35.2137, label: 'Jerusalem' } },
    { id: '3', location: { lat: 29.5577, lng: 34.9519, label: 'Eilat' } },
  ];

  const userLat = 32.0853;
  const userLng = 34.7818;

  test('radius=0 returns all jobs (nationwide)', () => {
    expect(filterJobsByRadius(jobs, userLat, userLng, 0)).toHaveLength(3);
  });

  test('small radius returns only nearby jobs', () => {
    const result = filterJobsByRadius(jobs, userLat, userLng, 5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  test('100km radius includes Tel Aviv and Jerusalem', () => {
    const result = filterJobsByRadius(jobs, userLat, userLng, 100);
    expect(result).toHaveLength(2);
    expect(result.map((j) => j.id)).toContain('1');
    expect(result.map((j) => j.id)).toContain('2');
  });

  test('nationwide (0) includes all cities', () => {
    const result = filterJobsByRadius(jobs, userLat, userLng, 0);
    expect(result.map((j) => j.id)).toContain('3');
  });

  test('returns empty array when input is empty', () => {
    expect(filterJobsByRadius([], userLat, userLng, 50)).toHaveLength(0);
  });

  test('returns empty array when no jobs in radius', () => {
    // User is in the Mediterranean Sea — no jobs nearby
    const result = filterJobsByRadius(jobs, 31.5, 34.0, 1);
    expect(result).toHaveLength(0);
  });
});
