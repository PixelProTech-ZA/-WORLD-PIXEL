// Place lookup behind one interface so the source can be swapped without touching the UI.
//   geocode(query)           -> { source, results: [{ label, lat, lon }] }
//   reverseLabel(lat, lon)   -> string | null
// Adapters: 'gazetteer' (local locations.json) then 'nominatim' (OpenStreetMap).
import { CONFIG } from './config.js';
import { isValidCoord } from './distance.js';

export class GeocodeError extends Error {
  /** code: 'network' | 'format' */
  constructor(code, message) {
    super(message || code);
    this.name = 'GeocodeError';
    this.code = code;
  }
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// ---------- local gazetteer ----------
let gazetteerPromise = null;
function loadGazetteer() {
  gazetteerPromise ??= fetch(CONFIG.data.locationsUrl)
    .then((r) => (r.ok ? r.json() : { places: [] }))
    .catch(() => ({ places: [] }));
  return gazetteerPromise;
}

/** Valid gazetteer places, for quick-pick chips and the Gauteng pixel map. Never throws. */
export async function loadPlaces() {
  const { places = [] } = await loadGazetteer();
  return places.filter((p) => p && typeof p.name === 'string' && isValidCoord(p.latitude, p.longitude));
}

const gazetteer = {
  async search(query) {
    const { places = [] } = await loadGazetteer();
    const q = norm(query);
    const names = (p) => [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].filter((n) => typeof n === 'string');
    return places
      .filter((p) => p && typeof p.name === 'string' && isValidCoord(p.latitude, p.longitude))
      .filter((p) => names(p).some((n) => norm(n).startsWith(q)))
      .slice(0, CONFIG.geocoder.nominatim.limit)
      .map((p) => ({
        label: [p.name, p.province].filter(Boolean).join(', '),
        lat: p.latitude,
        lon: p.longitude
      }));
  }
};

// ---------- OpenStreetMap Nominatim ----------
async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new GeocodeError('network', `HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof GeocodeError) throw e;
    throw new GeocodeError('network', e.message);
  } finally {
    clearTimeout(timer);
  }
}

function shortLabel(item) {
  const a = item.address || {};
  const place =
    item.name || a.suburb || a.village || a.town || a.city || a.municipality || a.county || '';
  const region = a.state || a.province || a.country || '';
  const label = [place, region].filter((v, i, arr) => v && arr.indexOf(v) === i).join(', ');
  return label || String(item.display_name || '').split(',').slice(0, 2).join(',').trim();
}

const nominatim = {
  async search(query) {
    const c = CONFIG.geocoder.nominatim;
    const params = new URLSearchParams({
      q: query, format: 'jsonv2', addressdetails: '1', limit: String(c.limit),
      'accept-language': c.language
    });
    if (c.countryCodes) params.set('countrycodes', c.countryCodes);
    const data = await fetchJson(`${c.baseUrl}/search?${params}`, c.timeoutMs);
    if (!Array.isArray(data)) throw new GeocodeError('format');
    const seen = new Set();
    const out = [];
    for (const item of data) {
      const lat = Number(item.lat), lon = Number(item.lon);
      if (!isValidCoord(lat, lon)) continue;
      const label = shortLabel(item);
      const key = `${label}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
      if (!label || seen.has(key)) continue;
      seen.add(key);
      out.push({ label, lat, lon });
    }
    return out;
  },
  async reverse(lat, lon) {
    const c = CONFIG.geocoder.nominatim;
    const d = CONFIG.geocoder.reverseCoordDecimals;
    const params = new URLSearchParams({
      lat: lat.toFixed(d), lon: lon.toFixed(d), format: 'jsonv2', zoom: '10',
      addressdetails: '1', 'accept-language': c.language
    });
    const data = await fetchJson(`${c.baseUrl}/reverse?${params}`, c.timeoutMs);
    if (!data || data.error) return null;
    return shortLabel(data) || null;
  }
};

const adapters = { gazetteer, nominatim };

export async function geocode(query) {
  const q = String(query || '').trim();
  let lastError = null;
  for (const id of CONFIG.geocoder.order) {
    try {
      const results = await adapters[id].search(q);
      if (results.length) return { source: id, results };
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) throw lastError; // every adapter that answered was empty, but one failed to answer
  return { source: null, results: [] };
}

/** Best-effort name for coordinates. Never throws; returns null when it cannot be resolved. */
export async function reverseLabel(lat, lon) {
  try {
    return await nominatim.reverse(lat, lon);
  } catch {
    return null;
  }
}
