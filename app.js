// Orchestration: state, routing, and the Near Me flow.
import { CONFIG, TEST_MODE } from './config.js';
import { liveModules } from './modules.js';
import { getDeviceLocation, LocationError } from './location.js';
import { geocode, reverseLabel, loadPlaces, GeocodeError } from './geocoding.js';
import { loadProviderIndex } from './providers.js';
import { nearbySearch } from './search.js';
import { haversineKm } from './distance.js';
import * as ui from './ui.js';
import { registerServiceWorker, setupInstallButton, setupNetworkBanner } from './pwa.js';

const view = document.getElementById('view');
const live = document.getElementById('live');

const state = {
  origin: null,        // { lat, lon, label, source: 'device' | 'entered' | 'test' } — memory only, never persisted
  alternatives: [],
  startKm: CONFIG.radiiKm[0],
  index: null,
  indexPromise: null,
  geoToken: 0
};

const announce = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };

let firstPaint = true; // don't steal focus on first load, so keyboard users can still reach the skip link
function mount(node, title) {
  view.replaceChildren(node);
  document.title = title ? `${title} · WORLD PIXEL` : 'WORLD PIXEL · Where Gauteng learns computers.';
  if (!firstPaint) view.querySelector('[data-focus]')?.focus({ preventScroll: false });
  firstPaint = false;
  window.scrollTo(0, 0);
}

function ensureIndex() {
  state.indexPromise ??= loadProviderIndex({ testMode: TEST_MODE })
    .then((idx) => (state.index = idx))
    .catch((e) => { state.indexPromise = null; throw e; });
  return state.indexPromise;
}

function setOrigin(origin, alternatives = []) {
  state.origin = origin;
  state.alternatives = alternatives;
  state.startKm = CONFIG.radiiKm[0];
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---------- home ----------
function showHome({ notice = null, fieldError = null } = {}) {
  state.origin = null; // nothing about the user's location is kept once they start over
  state.alternatives = [];
  mount(ui.home({ notice, fieldError, onNearMe: startDeviceLocation, onSearch: startManualSearch, onUseTestOrigin: useTestOrigin }), null);
  if (fieldError) document.getElementById('place')?.focus();
  // Quick-pick cities and the Gauteng pixel map need the data; the page is already usable without them.
  Promise.all([ensureIndex(), loadPlaces()])
    .then(([idx, places]) => {
      if (!document.getElementById('pixel-map')) return; // user already moved on
      ui.fillHome({ providers: idx.providers, places, meta: idx.meta, onPickCity: startManualSearch });
    })
    .catch(() => { /* the search box still works; nothing is faked */ });
}

const LOCATION_NOTICES = {
  denied: { title: 'Location access was denied.', body: 'Enter your town or city to continue. To use your device location instead, allow location for this site in your browser settings and try again.' },
  unavailable: { title: 'Your location could not be detected.', body: 'Your device could not work out where you are. Enter your town or city to continue.' },
  timeout: { title: 'Finding your location took too long.', body: 'Try again, or enter your town or city to continue.' },
  unsupported: { title: 'This browser cannot share its location.', body: 'Enter your town or city to continue.' },
  insecure: { title: 'Location needs a secure connection.', body: 'Open World Pixel over HTTPS to use your device location, or enter your town or city to continue.' }
};

async function startDeviceLocation() {
  const token = ++state.geoToken;
  mount(ui.loading({
    title: 'Finding your location…',
    body: 'If your browser asks for permission, choose Allow to see providers near you.',
    cancelLabel: 'Enter a town or city instead',
    onCancel: () => { state.geoToken++; showHome(); }
  }), 'Finding your location');
  try {
    const pos = await getDeviceLocation();
    if (token !== state.geoToken) return;
    setOrigin({ lat: pos.lat, lon: pos.lon, label: null, source: 'device' });
    announce('Location detected.');
    reverseLabel(pos.lat, pos.lon).then((label) => {
      if (!label || state.origin?.source !== 'device' || token !== state.geoToken) return;
      state.origin.label = label;
      const el = document.getElementById('origin-label');
      if (el) el.textContent = label;
    });
    navigate('#/near');
  } catch (e) {
    if (token !== state.geoToken) return;
    const code = e instanceof LocationError ? e.code : 'unavailable';
    showHome({ notice: { kind: 'error', ...LOCATION_NOTICES[code] } });
  }
}

async function startManualSearch(raw) {
  const query = String(raw || '').trim();
  if (query.length < 2) return showHome({ fieldError: 'Enter at least two characters of a town or city.' });
  state.geoToken++;
  mount(ui.loading({ title: `Looking up ${query}…` }), 'Looking up place');
  try {
    const { results } = await geocode(query);
    if (!results.length) {
      return showHome({ notice: { kind: 'error', title: `No place matching “${query}” was found.`, body: 'Check the spelling, or pick a Gauteng city from the list.' } });
    }
    const [best, ...rest] = results;
    setOrigin({ lat: best.lat, lon: best.lon, label: best.label, source: 'entered' }, rest);
    navigate('#/near');
  } catch (e) {
    const network = e instanceof GeocodeError ? e.code === 'network' : true;
    mount(ui.message({
      kind: 'error',
      title: network ? 'World Pixel couldn’t reach the location service.' : 'The location service sent an unreadable answer.',
      body: 'Nothing was searched. Check your connection and try again.',
      actions: [{ label: 'Try again', primary: true, onClick: () => startManualSearch(query) }, { label: 'Back', onClick: () => showHome() }]
    }), 'Location service unavailable');
  }
}

function useTestOrigin() {
  const t = CONFIG.test.origin;
  setOrigin({ lat: t.lat, lon: t.lon, label: t.label, source: 'test' });
  navigate('#/near');
}

// ---------- results ----------
async function showResults() {
  if (!state.origin) return navigate('#/');
  mount(ui.loading({ title: 'Finding providers near you…' }), 'Finding providers');
  try {
    const idx = await ensureIndex();
    if (!state.origin) return;
    const search = nearbySearch(idx.providers, state.origin, { radii: CONFIG.radiiKm, startKm: state.startKm });
    mount(ui.results({
      origin: state.origin, search, alternatives: state.alternatives, meta: idx.meta,
      onBack: () => navigate('#/'),
      onWiden: (km) => { state.startKm = km; showResults(); },
      onPick: (a) => { setOrigin({ lat: a.lat, lon: a.lon, label: a.label, source: 'entered' }, state.alternatives.filter((x) => x !== a)); showResults(); }
    }), 'Providers near you');
  } catch {
    mount(ui.message({
      kind: 'error', title: 'World Pixel couldn’t reach the live provider data.',
      body: 'Check your connection and try again. No providers are shown until the data loads.',
      actions: [{ label: 'Try again', primary: true, onClick: showResults }, { label: 'Back', onClick: () => navigate('#/') }]
    }), 'Provider data unavailable');
  }
}

// ---------- provider ----------
async function showProvider(id) {
  mount(ui.loading({ title: 'Loading provider…' }), 'Loading provider');
  const back = () => (state.origin ? navigate('#/near') : navigate('#/'));
  try {
    const idx = await ensureIndex();
    const provider = idx.providers.find((p) => p.id === id);
    if (!provider) throw new Error('not found');
    const distanceKm = state.origin && provider.coords ? haversineKm(state.origin, provider.coords) : null;
    mount(ui.providerDetail({ provider, distanceKm, onBack: back }), provider.name);
  } catch {
    mount(ui.message({
      kind: 'error', title: 'This provider’s information could not be loaded.',
      body: 'The record may have been removed, or the data could not be reached.',
      actions: [{ label: 'Back', primary: true, onClick: back }]
    }), 'Provider unavailable');
  }
}

// ---------- router ----------
function route() {
  const hash = location.hash || '#/';
  const near = liveModules().find((m) => m.id === 'near-me').route;
  if (hash === near) return showResults();
  const m = hash.match(/^#\/provider\/(.+)$/);
  if (m) return showProvider(decodeURIComponent(m[1]));
  return showHome();
}

window.addEventListener('hashchange', route);
setupNetworkBanner(document.getElementById('net-banner'));
setupInstallButton(document.getElementById('install-slot'));
registerServiceWorker();
route();
