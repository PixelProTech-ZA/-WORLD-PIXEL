// Provider data service layer. The UI only talks to this module, so the data source can change
// (static JSON today, an API later) without touching the interface.
import { CONFIG } from './config.js';
import { isValidCoord } from './distance.js';

export class DataError extends Error {
  /** code: 'network' | 'http' | 'format' */
  constructor(code, message) {
    super(message || code);
    this.name = 'DataError';
    this.code = code;
  }
}

const clean = (v) => (typeof v === 'string' ? v.trim() || null : null);
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

export function safeHttpUrl(value) {
  const s = clean(value);
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.includes('.') ? u.href : null;
  } catch {
    return null;
  }
}

export function telHref(phone) {
  const s = clean(phone);
  if (!s) return null;
  const d = s.replace(/[^\d+]/g, '');
  const digits = d.replace(/\D/g, '');
  return digits.length >= 7 && d.lastIndexOf('+') <= 0 ? `tel:${d}` : null;
}

const isoDate = (v) => {
  const s = clean(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const day = s.slice(0, 10);
  return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? null : day;
};

const STATUS = {
  verified: 'verified', unverified: 'unverified', inactive: 'inactive',
  'needs review': 'needs-review', 'needs-review': 'needs-review', needs_review: 'needs-review'
};

/** Returns a normalised provider, or null when the record has no id or name. */
export function normaliseProvider(raw, { isTest = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id == null ? '' : String(raw.id));
  const name = clean(raw.name);
  if (!id || !name) return null;

  const lat = num(raw.latitude), lon = num(raw.longitude);
  const website = safeHttpUrl(raw.officialWebsite);
  const phone = clean(raw.phone);
  const email = clean(raw.email);

  return {
    id, name,
    category: clean(raw.category),
    description: clean(raw.description),
    country: clean(raw.country), province: clean(raw.province), district: clean(raw.district),
    municipality: clean(raw.municipality), city: clean(raw.city), suburb: clean(raw.suburb),
    address: clean(raw.address),
    coords: isValidCoord(lat, lon) ? { lat, lon } : null,
    phone, phoneHref: telHref(phone),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    website, websiteHost: website ? new URL(website).hostname.replace(/^www\./, '') : null,
    courses: Array.isArray(raw.courses) ? raw.courses.map(clean).filter(Boolean) : [],
    source: clean(raw.source),
    note: clean(raw.note),
    // 'area' = the position is the middle of the named area, not the building.
    precision: raw.locationPrecision === 'area' ? 'area' : 'exact',
    verificationStatus: STATUS[String(raw.verificationStatus || '').toLowerCase()] || 'unverified',
    lastVerified: isoDate(raw.lastVerified),
    active: raw.active !== false,
    isTest: isTest || raw.isTest === true
  };
}

/**
 * "Verified" is only ever shown when the record earns it:
 * a verification date that is not in the future, a recorded source, coordinates,
 * and at least one contact channel. Otherwise a record claiming it is shown as Unverified.
 */
export function effectiveVerification(p, now = new Date()) {
  if (!p.active || p.verificationStatus === 'inactive') {
    return { status: 'inactive', label: 'Inactive', downgraded: false, reasons: [] };
  }
  if (p.verificationStatus === 'verified') {
    const reasons = [];
    if (!p.lastVerified) reasons.push('no verification date');
    else if (Date.parse(`${p.lastVerified}T00:00:00Z`) > now.getTime()) reasons.push('a verification date in the future');
    if (!p.source) reasons.push('no recorded source');
    if (!p.coords) reasons.push('no coordinates');
    if (!(p.website || p.phone || p.email || p.address)) reasons.push('no contact details');
    return reasons.length
      ? { status: 'unverified', label: 'Unverified', downgraded: true, reasons }
      : { status: 'verified', label: 'Verified', downgraded: false, reasons: [] };
  }
  if (p.verificationStatus === 'needs-review') {
    return { status: 'needs-review', label: 'Needs review', downgraded: false, reasons: [] };
  }
  return { status: 'unverified', label: 'Unverified', downgraded: false, reasons: [] };
}

export function isStale(p, now = new Date(), staleAfterDays = CONFIG.verification.staleAfterDays) {
  if (!p.lastVerified) return false;
  return (now.getTime() - Date.parse(`${p.lastVerified}T00:00:00Z`)) / 86400000 > staleAfterDays;
}

/** Pure: builds the index from parsed JSON. Test records are dropped unless allowTest is true. */
export function buildIndex(prod, { test = null, allowTest = false } = {}) {
  if (!prod || !Array.isArray(prod.providers)) throw new DataError('format', 'providers array missing');
  const rows = prod.providers.map((r) => normaliseProvider(r, { isTest: prod.dataset?.isTest === true }));
  if (allowTest && test && Array.isArray(test.providers)) {
    rows.push(...test.providers.map((r) => normaliseProvider(r, { isTest: true })));
  }
  const valid = rows.filter(Boolean).filter((p) => allowTest || !p.isTest);
  return {
    providers: valid,
    meta: {
      name: prod.dataset?.name || 'World Pixel provider index',
      generatedAt: isoDate(prod.dataset?.generatedAt),
      hasTestRecords: valid.some((p) => p.isTest)
    },
    invalidCount: rows.length - rows.filter(Boolean).length
  };
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new DataError('network', e.message);
  }
  if (!res.ok) throw new DataError('http', `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new DataError('format', 'invalid JSON');
  }
}

export async function loadProviderIndex({ testMode = false } = {}) {
  const prod = await fetchJson(CONFIG.data.providersUrl);
  const test = testMode ? await fetchJson(CONFIG.data.testProvidersUrl).catch(() => null) : null;
  return buildIndex(prod, { test, allowTest: testMode });
}
