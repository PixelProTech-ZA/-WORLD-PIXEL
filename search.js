// Nearby search. Pure functions: ranks by real great-circle distance and expands the radius
// in clearly reported steps. It never mixes distant results into a closer tier.
import { haversineKm } from './distance.js';

export const DEFAULT_RADII_KM = [10, 25, 50, 100];

/**
 * @param providers normalised providers (see providers.js)
 * @param origin    { lat, lon }
 * @param opts.radii   ascending list of radii in km
 * @param opts.startKm first radius to try (must be one of radii)
 * @returns {
 *   status: 'empty-index' | 'none' | 'found',
 *   radiusKm, startKm, ladder: [{ km, state }], results: [{ provider, distanceKm }], nextRadiusKm
 * }
 * ladder state: 'empty' (searched, nothing) | 'shown' | 'unsearched'
 */
export function nearbySearch(providers, origin, { radii = DEFAULT_RADII_KM, startKm = radii[0] } = {}) {
  const searchable = providers.filter((p) => p.active && p.coords);
  const ladder = radii.map((km) => ({ km, state: 'unsearched' }));
  const base = { startKm, ladder, results: [], radiusKm: null, nextRadiusKm: null };

  if (searchable.length === 0) return { ...base, status: 'empty-index' };

  const ranked = searchable
    .map((provider) => ({ provider, distanceKm: haversineKm(origin, provider.coords) }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.provider.name.localeCompare(b.provider.name));

  const startIdx = Math.max(0, radii.indexOf(startKm));
  for (let i = startIdx; i < radii.length; i++) {
    const radiusKm = radii[i];
    const within = ranked.filter((r) => r.distanceKm <= radiusKm);
    if (within.length === 0) {
      ladder[i].state = 'empty';
      continue;
    }
    ladder[i].state = 'shown';
    const next = radii.slice(i + 1).find((km) => ranked.some((r) => r.distanceKm > radiusKm && r.distanceKm <= km));
    return { ...base, status: 'found', radiusKm, results: within, nextRadiusKm: next ?? null };
  }
  return { ...base, status: 'none', radiusKm: radii[radii.length - 1] };
}
