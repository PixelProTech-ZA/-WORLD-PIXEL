// Rendering. Every function returns DOM built from data with text nodes only.
import { h } from './dom.js';
import { icon } from './icons.js';
import { formatDistance, haversineKm } from './distance.js';
import { effectiveVerification, isStale } from './providers.js';
import { TEST_MODE } from './config.js';

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export const directionsHref = (p) => {
  if (p.precision === 'area' && p.address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.name}, ${p.address}`)}`;
  }
  return p.coords ? `https://www.google.com/maps/dir/?api=1&destination=${p.coords.lat},${p.coords.lon}` : null;
};

const placeLine = (p) =>
  [...new Set([p.suburb, p.city].filter(Boolean))].join(', ') ||
  [...new Set([p.municipality, p.province].filter(Boolean))].join(', ') || null;

// ---------- small parts ----------
function chip(kind, text, iconName) {
  return h('span', { class: `chip chip--${kind}` }, iconName ? icon(iconName, { size: 14 }) : null, text);
}

function verificationChip(p) {
  const v = effectiveVerification(p);
  return chip(v.status, v.label, v.status === 'verified' ? 'shield' : v.status === 'needs-review' ? 'alert' : null);
}

function action(href, label, iconName, { external = false, primary = false } = {}) {
  return h('a', {
    class: `btn ${primary ? 'btn--primary' : 'btn--line'} btn--sm`, href,
    target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null
  }, icon(iconName, { size: 18 }), label, external ? h('span', { class: 'sr-only' }, ' (opens in a new tab)') : null);
}

function providerActions(p) {
  const dir = directionsHref(p);
  return h('div', { class: 'actions' },
    p.website ? action(p.website, 'Visit website', 'globe', { external: true }) : null,
    p.phoneHref ? action(p.phoneHref, 'Call', 'phone') : null,
    dir ? action(dir, 'Directions', 'directions', { external: true }) : null);
}

// ---------- messages / loading ----------
export function message({ kind = 'error', title, body, actions = [] }) {
  return h('section', { class: `notice notice--${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert' : 'pin', { size: 22 }),
    h('div', { class: 'notice__body' },
      h('h2', { class: 'notice__title', tabindex: '-1', 'data-focus': '' }, title),
      body ? h('p', null, body) : null,
      actions.length
        ? h('div', { class: 'actions' }, actions.map((a) => a.href
            ? h('a', { class: `btn ${a.primary ? 'btn--primary' : 'btn--line'} btn--sm`, href: a.href }, a.label)
            : h('button', { type: 'button', class: `btn ${a.primary ? 'btn--primary' : 'btn--line'} btn--sm`, onClick: a.onClick }, a.label)))
        : null));
}

export function loading({ title, body, onCancel, cancelLabel }) {
  return h('section', { class: 'loading', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'loading__head' }, icon('loading', { size: 22, className: 'spin' }),
      h('h2', { class: 'loading__title', tabindex: '-1', 'data-focus': '' }, title)),
    body ? h('p', { class: 'muted' }, body) : null,
    h('ul', { class: 'skeletons', 'aria-hidden': 'true' },
      [0, 1, 2].map(() => h('li', { class: 'skeleton' }, h('span', { class: 'skeleton__n' }), h('span', { class: 'skeleton__l' })))),
    onCancel ? h('button', { type: 'button', class: 'btn btn--line btn--sm', onClick: onCancel }, cancelLabel) : null);
}

// ---------- home ----------
export function home({ notice, fieldError, onNearMe, onSearch, onUseTestOrigin }) {
  const input = h('input', {
    id: 'place', name: 'place', type: 'search', class: 'field__input', autocomplete: 'off',
    autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'search',
    placeholder: 'Soweto, Pretoria, Springs…',
    'aria-describedby': fieldError ? 'place-error place-hint' : 'place-hint', 'aria-invalid': fieldError ? 'true' : null
  });
  const form = h('form', { class: 'finder', novalidate: true, onSubmit: (e) => { e.preventDefault(); onSearch(input.value); } },
    h('label', { class: 'field__label', for: 'place' }, 'Or type a town or suburb'),
    h('div', { class: 'finder__row' }, input,
      h('button', { type: 'submit', class: 'btn btn--line' }, icon('search', { size: 20 }), 'Search')),
    fieldError ? h('p', { id: 'place-error', class: 'field__error' }, fieldError) : null,
    h('p', { id: 'place-hint', class: 'muted small' }, 'Gauteng cities are found instantly on your device. Any other South African place is looked up on OpenStreetMap, and only the place name is sent.'));

  return h('div', { class: 'home' },
    h('div', { class: 'home__intro' },
      h('p', { class: 'eyebrow' }, h('span', { class: 'eyebrow__px', 'aria-hidden': 'true' }), 'Gauteng edition'),
      h('h1', { class: 'wordmark', tabindex: '-1', 'data-focus': '' }, 'WORLD', h('br'), 'PIXEL'),
      h('p', { class: 'lede' }, 'Where Gauteng learns computers.'),
      h('p', { class: 'sublede' }, 'Pick your city. See the nearest computer school, how far away it is, and where we found it.'),
      h('p', { id: 'home-stats', class: 'stats', 'aria-live': 'polite' }),
      h('div', { id: 'pixel-map', class: 'pxmap-slot' })),
    h('div', { class: 'home__panel' },
      TEST_MODE ? h('div', { class: 'testbar' }, h('p', null, h('strong', null, 'Test mode. '), 'Synthetic records are loaded. They are not real providers.'),
        h('button', { type: 'button', class: 'btn btn--line btn--sm', onClick: onUseTestOrigin }, 'Use test origin (0°, 0°)')) : null,
      notice ? message({ ...notice, kind: notice.kind || 'error' }) : null,
      h('button', { type: 'button', class: 'btn btn--primary btn--lg', onClick: onNearMe }, icon('locate', { size: 24 }), 'Near me'),
      h('p', { class: 'muted small' }, 'Your browser will ask for permission. Your location is used for this search only and is not stored.'),
      h('div', { class: 'divider' }, h('span', null, 'or pick a city')),
      h('div', { id: 'city-chips', class: 'chips-grid' }),
      h('div', { class: 'divider' }, h('span', null, 'or')),
      form,
      h('details', { class: 'how' },
        h('summary', null, 'How your location is used'),
        h('p', null, 'Distances are calculated on your device. If you use your device location, its coordinates are rounded to about 1 km and sent to OpenStreetMap only to name your area. Nothing is saved after you leave this page.'))));
}

const GAUTENG = { latMax: -25.3, latMin: -26.85, lonMin: 27.3, lonMax: 28.55 };
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/** Providers within `km` of a place, using the same distance maths as the search. */
export const countNear = (place, providers, km = 20) =>
  providers.filter((p) => p.active && p.coords && haversineKm({ lat: place.latitude, lon: place.longitude }, p.coords) <= km).length;

/**
 * Fills the home page once data has loaded: stats line, quick-pick chips, and the Gauteng pixel map.
 * The map is a visual extra (aria-hidden); the chips are the accessible equivalent.
 */
export function fillHome({ providers, places, meta, onPickCity }) {
  const active = providers.filter((p) => p.active && p.coords);
  const verified = active.filter((p) => effectiveVerification(p).status === 'verified').length;
  const stats = document.getElementById('home-stats');
  if (stats) {
    stats.textContent = active.length
      ? `${active.length} places indexed · ${verified} confirmed on the provider’s own site${meta.generatedAt ? ` · checked ${fmtDate(meta.generatedAt)}` : ''}`
      : '';
  }

  const gp = places.filter((p) => p.province === 'Gauteng' || !p.province);
  const counted = gp.map((p) => ({ ...p, near: countNear(p, active) }));

  const chips = document.getElementById('city-chips');
  if (chips) {
    const mk = (p) => h('button', { type: 'button', class: 'pxchip', onClick: () => onPickCity(p.name) },
      h('span', { class: 'pxchip__n' }, p.name),
      h('span', { class: `pxchip__c${p.near ? '' : ' is-zero'}` }, p.near ? String(p.near) : 'nearest'),
      h('span', { class: 'sr-only' }, p.near ? ` ${p.near} ${p.near === 1 ? 'place' : 'places'} within 20 km` : ' no place within 20 km, nearest will be shown'));
    const featured = counted.filter((p) => p.featured);
    const rest = counted.filter((p) => !p.featured).sort((a, b) => a.name.localeCompare(b.name));
    chips.replaceChildren(
      ...featured.map(mk),
      rest.length ? h('details', { class: 'how pxmore' }, h('summary', null, `${rest.length} more towns and townships`), h('div', { class: 'chips-grid' }, rest.map(mk))) : null);
  }

  const slot = document.getElementById('pixel-map');
  if (!slot || !counted.length) return;
  const W = 360, H = 480;
  const px = (lon) => ((lon - GAUTENG.lonMin) / (GAUTENG.lonMax - GAUTENG.lonMin)) * (W - 40) + 20;
  const py = (lat) => ((GAUTENG.latMax - lat) / (GAUTENG.latMax - GAUTENG.latMin)) * (H - 40) + 20;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pxmap', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgEl('defs');
  const pat = svgEl('pattern', { id: 'pxgrid', width: 12, height: 12, patternUnits: 'userSpaceOnUse' });
  pat.append(svgEl('rect', { x: 0, y: 0, width: 2, height: 2, class: 'pxmap__dot' }));
  defs.append(pat);
  svg.append(defs, svgEl('rect', { width: W, height: H, fill: 'url(#pxgrid)' }));
  const readout = h('p', { class: 'pxmap__read', 'aria-hidden': 'true' }, 'Tap a square to search that city.');
  for (const p of counted.sort((a, b) => a.near - b.near)) {
    const size = p.near ? Math.min(20, 8 + p.near * 2) : 8;
    const x = px(p.longitude) - size / 2, y = py(p.latitude) - size / 2;
    const g = svgEl('g', { class: `pxmap__city${p.near ? ' has' : ''}` });
    g.append(svgEl('rect', { x: x - 4, y: y - 4, width: size + 8, height: size + 8, fill: 'transparent' }));
    g.append(svgEl('rect', { x, y, width: size, height: size, class: 'pxmap__sq' }));
    g.addEventListener('click', () => onPickCity(p.name));
    g.addEventListener('pointerenter', () => { readout.textContent = `${p.name}: ${p.near ? `${p.near} ${p.near === 1 ? 'place' : 'places'} within 20 km` : 'nearest place will be shown'}`; });
    svg.append(g);
  }
  slot.replaceChildren(svg, readout);
}

// ---------- results ----------
export const MISSED_HREF = 'mailto:pixelprotechsolutions@proton.me?subject=' + encodeURIComponent('WORLD PIXEL: a computer school you missed');

function results_area_note(search) {
  return search.results.some((r) => r.provider.precision === 'area')
    ? h('p', { class: 'muted small' }, '≈ means the position is the middle of the area, not the building, so distances are approximate. Use the address and Directions to find the door.')
    : null;
}

function ladder(search) {
  const label = { empty: 'no providers', shown: 'providers shown', unsearched: 'not searched' };
  return h('ol', { class: 'ladder', 'aria-label': 'Search radius steps' },
    search.ladder.map((s) => h('li', { class: `ladder__step is-${s.state}` },
      h('span', { class: 'ladder__node', 'aria-hidden': 'true' }),
      h('span', { class: 'ladder__km' }, `${s.km} km`),
      h('span', { class: 'sr-only' }, `: ${label[s.state]}`))));
}

// Positions are area centres, so a gap under 2 km is below what the data can tell apart.
const distanceText = (km, approx) => (approx && km < 2 ? { value: '< 2', unit: 'km', lt: true } : formatDistance(km));

const signalLevel = (km) => (km <= 10 ? 4 : km <= 25 ? 3 : km <= 50 ? 2 : 1);
const signal = (km) => h('span', { class: `signal signal--${signalLevel(km)}`, 'aria-hidden': 'true' },
  h('i'), h('i'), h('i'), h('i'));

function resultRow({ provider: p, distanceKm }) {
  const approx = p.precision === 'area';
  const d = distanceText(distanceKm, approx);
  const where = placeLine(p);
  return h('li', { class: 'row' },
    h('article', { class: 'row__in', 'aria-labelledby': `n-${p.id}` },
      h('p', { class: 'dist' },
        h('span', { class: 'dist__v' }, approx && !d.lt ? '≈' : null, d.value),
        h('span', { class: 'dist__u' }, `${d.unit} away`),
        signal(distanceKm)),
      h('div', { class: 'row__main' },
        h('h3', { class: 'row__name', id: `n-${p.id}` }, p.name),
        p.category ? h('p', { class: 'row__cat' }, p.category) : null,
        where ? h('p', { class: 'row__where' }, icon('pin', { size: 16 }), where) : null,
        h('p', { class: 'chips' }, p.isTest ? chip('test', 'Test data') : null, verificationChip(p)),
        h('div', { class: 'actions' },
          h('a', { class: 'btn btn--primary btn--sm', href: `#/provider/${encodeURIComponent(p.id)}` },
            'View provider', h('span', { class: 'sr-only' }, ` ${p.name}`), icon('arrow-right', { size: 18 })),
          p.website ? action(p.website, 'Website', 'globe', { external: true }) : null,
          p.phoneHref ? action(p.phoneHref, 'Call', 'phone') : null,
          directionsHref(p) ? action(directionsHref(p), 'Directions', 'directions', { external: true }) : null))));
}

export function results({ origin, search, alternatives, meta, onBack, onWiden, onPick }) {
  const where = origin.label || (origin.source === 'device' ? 'your location' : 'the entered place');
  const sourceText = { device: 'Location detected by your device', entered: 'Place entered by you', test: 'Synthetic test origin' }[origin.source];

  const head = h('header', { class: 'results__head' },
    h('button', { type: 'button', class: 'back', onClick: onBack }, icon('back', { size: 18 }), 'New search'),
    h('h1', { class: 'results__title', tabindex: '-1', 'data-focus': '' }, 'Near ', h('span', { id: 'origin-label' }, where)),
    h('p', { class: 'muted small' }, icon('locate', { size: 14 }), sourceText),
    alternatives?.length
      ? h('details', { class: 'how' }, h('summary', null, `Not the right place? ${alternatives.length} other ${alternatives.length === 1 ? 'match' : 'matches'}`),
          h('ul', { class: 'alts' }, alternatives.map((a) => h('li', null,
            h('button', { type: 'button', class: 'linkbtn', onClick: () => onPick(a) }, a.label)))))
      : null,
    meta.hasTestRecords ? h('p', { class: 'testbar testbar--inline' }, h('strong', null, 'Test mode. '), 'Results are synthetic records, not real providers.') : null);

  if (search.status === 'empty-index') {
    return h('div', { class: 'results' }, head, message({
      kind: 'empty', title: 'The provider index is empty right now.',
      body: 'There is nothing to show yet. No results are made up to fill the gap.',
      actions: [{ label: 'Try another place', onClick: onBack, primary: true }] }));
  }
  if (search.status === 'none') {
    return h('div', { class: 'results' }, head, ladder(search), message({
      kind: 'empty', title: `Nothing indexed within ${search.radiusKm} km of ${where}.`,
      body: 'World Pixel covers Gauteng first. If you are inside Gauteng and know a computer school we missed, tell us and it goes in with its source.',
      actions: [{ label: 'Try another place', onClick: onBack, primary: true }, { label: 'Tell us about a school', href: MISSED_HREF }] }));
  }

  const first = search.ladder[0].km;
  const expanded = search.radiusKm !== first && search.startKm === first;
  const n = search.results.length;
  const summary = expanded
    ? [`No providers found within ${first} km.`, ` Showing providers within ${search.radiusKm} km.`]
    : [`${n} ${n === 1 ? 'provider' : 'providers'} within ${search.radiusKm} km.`];

  return h('div', { class: 'results' }, head, ladder(search),
    h('p', { class: 'summary', role: 'status' }, summary),
    h('ol', { class: 'rows' }, search.results.map(resultRow)),
    search.nextRadiusKm
      ? h('div', { class: 'more' }, h('button', { type: 'button', class: 'btn btn--line', onClick: () => onWiden(search.nextRadiusKm) },
          `Show providers within ${search.nextRadiusKm} km`, icon('arrow-right', { size: 18 })))
      : null,
    results_area_note(search),
    h('p', { class: 'muted small foot' }, meta.generatedAt ? `Provider index updated ${fmtDate(meta.generatedAt)}.` : 'Provider index has no recorded update date.'));
}

// ---------- provider detail ----------
export function providerDetail({ provider: p, distanceKm, onBack }) {
  const v = effectiveVerification(p);
  const stale = isStale(p);
  const d = distanceKm == null ? null : distanceText(distanceKm, p.precision === 'area');
  const locationParts = [p.suburb, p.city, p.municipality, p.district, p.province, p.country].filter(Boolean);
  const row = (term, value) => value ? [h('dt', null, term), h('dd', null, value)] : null;

  return h('div', { class: 'detail' },
    h('button', { type: 'button', class: 'back', onClick: onBack }, icon('back', { size: 18 }), 'Back'),
    h('header', null,
      h('h1', { class: 'detail__name', tabindex: '-1', 'data-focus': '' }, p.name),
      p.category ? h('p', { class: 'row__cat' }, p.category) : null,
      h('p', { class: 'chips' }, p.isTest ? chip('test', 'Test data') : null, verificationChip(p))),
    p.isTest ? h('p', { class: 'testbar testbar--inline' }, h('strong', null, 'Test record. '), 'This is synthetic data used to exercise the engine. It is not a real provider.') : null,
    p.description ? h('p', { class: 'detail__desc' }, p.description) : null,
    providerActions(p),
    h('dl', { class: 'facts' },
      d ? row('Distance', `${p.precision === 'area' && !d.lt ? 'About ' : ''}${d.value} ${d.unit} from the place you searched`) : null,
      row('Location', locationParts.length ? [...new Set(locationParts)].join(', ') : null),
      row('Address', p.address),
      p.phone ? row('Phone', p.phoneHref ? h('a', { href: p.phoneHref }, p.phone) : p.phone) : null,
      p.email ? row('Email', h('a', { href: `mailto:${p.email}` }, p.email)) : null,
      p.website ? row('Official website', h('a', { href: p.website, target: '_blank', rel: 'noopener noreferrer' }, p.websiteHost, h('span', { class: 'sr-only' }, ' (opens in a new tab)'))) : null,
      p.courses.length ? row('Courses', h('ul', { class: 'plain' }, p.courses.map((c) => h('li', null, c)))) : null,
      p.note ? row('Good to know', p.note) : null),
    h('section', { class: 'verify', 'aria-labelledby': 'verify-h' },
      h('h2', { id: 'verify-h', class: 'verify__h' }, 'Verification'),
      h('p', null, verificationChip(p),
        p.lastVerified ? h('span', { class: 'verify__date' }, icon('clock', { size: 16 }), `Last checked: ${fmtDate(p.lastVerified)}`) : h('span', { class: 'muted' }, ' Never checked.')),
      stale ? h('p', { class: 'muted small' }, 'This record was last checked more than a year ago and may be out of date.') : null,
      v.downgraded ? h('p', { class: 'muted small' }, `This record is marked verified in the data, but it has ${v.reasons.join(', ')}, so it is shown as Unverified.`) : null,
      p.source ? h('p', { class: 'muted small' }, `Source: ${p.source}`) : null));
}
