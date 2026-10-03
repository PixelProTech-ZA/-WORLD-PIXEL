// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haversineKm, formatDistance, isValidCoord } from './distance.js';
import { nearbySearch } from './search.js';
import { buildIndex, normaliseProvider, effectiveVerification, isStale, safeHttpUrl, telHref } from './providers.js';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const prod = json('./providers.json');
const fixtures = json('./providers.test.json');
const ORIGIN = { lat: 0, lon: 0 };

test('haversine: known real-world distance (Johannesburg to Pretoria ~ 54 km)', () => {
  const d = haversineKm({ lat: -26.2041, lon: 28.0473 }, { lat: -25.7479, lon: 28.2293 });
  assert.ok(d > 50 && d < 58, `got ${d}`);
});
test('haversine: zero and symmetric', () => {
  const a = { lat: -27.35, lon: 32.07 }, b = { lat: -26.2, lon: 28.05 };
  assert.equal(haversineKm(a, a), 0);
  assert.equal(haversineKm(a, b), haversineKm(b, a));
});
test('coordinate validation', () => {
  assert.ok(isValidCoord(-27, 32));
  for (const bad of [[91, 0], [0, 181], [NaN, 1], ['1', 2], [null, null]]) assert.ok(!isValidCoord(...bad));
});
test('distance formatting', () => {
  assert.deepEqual(formatDistance(0.42), { value: '420', unit: 'm' });
  assert.deepEqual(formatDistance(4.83), { value: '4.8', unit: 'km' });
  assert.deepEqual(formatDistance(140.4), { value: '140', unit: 'km' });
});

test('production index: real, sourced, Gauteng-only, no test records', () => {
  const idx = buildIndex(prod, { allowTest: false });
  assert.ok(idx.providers.length >= 20, 'the index must not ship empty');
  assert.equal(prod.dataset.isTest, false);
  assert.equal(idx.invalidCount, 0);
  const ids = new Set(idx.providers.map((p) => p.id));
  assert.equal(ids.size, idx.providers.length, 'ids are unique');
  for (const p of idx.providers) {
    assert.ok(!p.isTest, p.id);
    assert.ok(p.source, `${p.id} has a recorded source`);
    assert.ok(p.lastVerified, `${p.id} has a checked date`);
    assert.ok(p.address, `${p.id} has an address`);
    assert.equal(p.precision, 'area', `${p.id} is honest that its position is an area centre`);
    assert.equal(p.province, 'Gauteng');
    assert.ok(p.coords.lat < -25.2 && p.coords.lat > -27.0 && p.coords.lon > 27.2 && p.coords.lon < 28.7, `${p.id} sits inside Gauteng`);
  }
});
test('production index: "verified" is only shown when earned, and is the minority', () => {
  const { providers } = buildIndex(prod, { allowTest: false });
  for (const p of providers) assert.equal(effectiveVerification(p).downgraded, false, `${p.id} is not claiming more than it has`);
  const verified = providers.filter((p) => effectiveVerification(p).status === 'verified');
  assert.ok(verified.length >= 5 && verified.length < providers.length);
  for (const p of verified) assert.ok(p.website || p.phone, `${p.id} verified records carry a contact`);
});
test('test records can never enter a production index', () => {
  const idx = buildIndex(prod, { test: fixtures, allowTest: false });
  assert.equal(idx.providers.length, prod.providers.length);
  assert.ok(idx.providers.every((p) => !p.isTest));
  const idxTest = buildIndex(prod, { test: fixtures, allowTest: true });
  assert.ok(idxTest.providers.filter((p) => p.isTest).length > 0);
  assert.ok(idxTest.providers.filter((p) => p.id.startsWith('TEST-')).every((p) => p.isTest));
});
test('every Gauteng place in the gazetteer finds a provider within 100 km, none is invented', () => {
  const places = json('./locations.json').places;
  const { providers } = buildIndex(prod, { allowTest: false });
  assert.ok(places.length >= 30);
  for (const pl of places) {
    const s = nearbySearch(providers, { lat: pl.latitude, lon: pl.longitude });
    assert.equal(s.status, 'found', `${pl.name} found nothing`);
    assert.ok(s.results.length > 0 && s.radiusKm <= 100, pl.name);
    const nearest = s.results[0];
    assert.ok(nearest.distanceKm <= s.radiusKm, pl.name);
  }
});
test('the main cities have a school close by (within 25 km)', () => {
  const places = json('./locations.json').places.filter((p) => p.featured);
  const { providers } = buildIndex(prod, { allowTest: false });
  const far = places.filter((pl) => {
    const s = nearbySearch(providers, { lat: pl.latitude, lon: pl.longitude });
    return s.results[0].distanceKm > 25;
  }).map((p) => p.name);
  assert.deepEqual(far, ['Krugersdorp'].filter((n) => far.includes(n)), `unexpected far cities: ${far}`);
});
test('fixtures: distances in the data match the engine', () => {
  const { providers } = buildIndex(prod, { test: fixtures, allowTest: true });
  const expected = { 'TEST-001': 3.2, 'TEST-002': 7.9, 'TEST-003': 18.4, 'TEST-004': 31.0, 'TEST-006': 44.6, 'TEST-007': 72.5, 'TEST-008': 96.0, 'TEST-009': 140.0 };
  for (const [id, km] of Object.entries(expected)) {
    const p = providers.find((x) => x.id === id);
    assert.ok(Math.abs(haversineKm(ORIGIN, p.coords) - km) < 0.01, id);
  }
});

const idx = buildIndex(prod, { test: fixtures, allowTest: true });

test('search: empty index reports empty-index, never fake results', () => {
  const s = nearbySearch([], ORIGIN);
  assert.equal(s.status, 'empty-index');
  assert.equal(s.results.length, 0);
});
test('search: first tier (10 km) ordered by real distance, inactive excluded', () => {
  const s = nearbySearch(idx.providers, ORIGIN);
  assert.equal(s.status, 'found');
  assert.equal(s.radiusKm, 10);
  assert.deepEqual(s.results.map((r) => r.provider.id), ['TEST-001', 'TEST-002']); // TEST-005 is inactive and 5 km away
  assert.equal(s.nextRadiusKm, 25);
  assert.deepEqual(s.ladder.map((l) => l.state), ['shown', 'unsearched', 'unsearched', 'unsearched']);
});
test('search: expands 10 -> 25 -> 50 and reports empty tiers', () => {
  const far = idx.providers.filter((p) => ['TEST-004', 'TEST-006'].includes(p.id)); // 31 km and 44.6 km
  const s = nearbySearch(far, ORIGIN);
  assert.equal(s.radiusKm, 50);
  assert.deepEqual(s.ladder.map((l) => l.state), ['empty', 'empty', 'shown', 'unsearched']);
  assert.equal(s.results.length, 2);
  assert.equal(s.nextRadiusKm, null);
});
test('search: nothing within 100 km -> none (record at 140 km is not shown)', () => {
  const s = nearbySearch(idx.providers.filter((p) => p.id === 'TEST-009'), ORIGIN);
  assert.equal(s.status, 'none');
  assert.equal(s.results.length, 0);
});
test('search: manual widen keeps tiers separate', () => {
  const s = nearbySearch(idx.providers, ORIGIN, { startKm: 25 });
  assert.equal(s.radiusKm, 25);
  assert.deepEqual(s.results.map((r) => r.provider.id), ['TEST-001', 'TEST-002', 'TEST-003']);
  assert.ok(s.results.every((r) => r.distanceKm <= 25));
});
test('search: record without coordinates is excluded, not given a made-up location', () => {
  assert.ok(!nearbySearch(idx.providers, ORIGIN, { startKm: 100 }).results.some((r) => r.provider.id === 'TEST-010'));
  assert.equal(idx.providers.find((p) => p.id === 'TEST-010').coords, null);
});

test('verification: earned vs downgraded vs passthrough', () => {
  const by = (id) => idx.providers.find((p) => p.id === id);
  const now = new Date('2026-10-03T00:00:00Z');
  assert.equal(effectiveVerification(by('TEST-001'), now).status, 'verified');
  const claimed = effectiveVerification(by('TEST-008'), now);
  assert.equal(claimed.status, 'unverified');
  assert.ok(claimed.downgraded && claimed.reasons.includes('no recorded source') && claimed.reasons.includes('no verification date'));
  assert.equal(effectiveVerification(by('TEST-006'), now).status, 'needs-review');
  assert.equal(effectiveVerification(by('TEST-005'), now).status, 'inactive');
});
test('verification: future date is not accepted', () => {
  const p = normaliseProvider({ id: 'x', name: 'x', latitude: 1, longitude: 1, officialWebsite: 'example.org', source: 's', verificationStatus: 'verified', lastVerified: '2099-01-01' });
  assert.equal(effectiveVerification(p, new Date('2026-10-03')).status, 'unverified');
});
test('staleness', () => {
  const now = new Date('2026-10-03T00:00:00Z');
  assert.ok(isStale(idx.providers.find((p) => p.id === 'TEST-007'), now));
  assert.ok(!isStale(idx.providers.find((p) => p.id === 'TEST-001'), now));
});
test('url and phone safety', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,hi'), null);
  assert.equal(safeHttpUrl('localhost'), null);
  assert.equal(safeHttpUrl('example.org'), 'https://example.org/');
  assert.equal(telHref('+27 11 555 0000'), 'tel:+27115550000');
  assert.equal(telHref('call me'), null);
  assert.equal(telHref(null), null);
});
test('records without id or name are dropped', () => {
  assert.equal(normaliseProvider({ name: 'x' }), null);
  assert.equal(normaliseProvider({ id: '1' }), null);
  assert.equal(normaliseProvider(null), null);
});
test('missing optional fields stay null (no invented defaults)', () => {
  const p = idx.providers.find((x) => x.id === 'TEST-002');
  assert.equal(p.phone, null); assert.equal(p.phoneHref, null);
  assert.equal(idx.providers.find((x) => x.id === 'TEST-003').website, null);
  assert.equal(idx.providers.find((x) => x.id === 'TEST-004').address, null);
});
