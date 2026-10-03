# WORLD PIXEL: Gauteng edition (Near Me)

Where Gauteng learns computers. A static, dependency-free PWA that finds real computer-training
places near a user, ordered by true geographic distance.

**Data.** `providers.json` ships 23 real Gauteng records checked on 3 October 2026, each with its
source and checked date. 6 are marked *verified* (the provider's own site confirms the address and a
computer/IT offering). The 17 TVET college campuses are *unverified*: the address comes from the
college's own site, but whether that campus teaches IT is not confirmed. Positions are area centres
(`locationPrecision: "area"`), so distances show as approximate and Directions route by name and
address. Known gaps: no record yet for Krugersdorp, Randfontein, Carletonville, Heidelberg, Brakpan,
Alberton or Centurion, so those searches show the nearest school with its real distance.
The app never invents providers, addresses, phone numbers, websites, ratings, courses, distances or
verification badges. Where there is no data it says so.

## Run it

```bash
python3 -m http.server 8000      # any static server works
# open http://localhost:8000
```

Geolocation and service workers need **HTTPS** (or `localhost`). Deploy to any static host
(GitHub Pages, Netlify, Cloudflare Pages). All paths are relative, so sub-folder hosting works.

Tests:

```bash
node --test core.test.mjs  # distance, search, verification, data-safety rules (19 tests)
```

## Layout (flat: every file sits in this one folder)

```text
index.html  offline.html  manifest.webmanifest  sw.js  styles.css  README.md

config.js      radii, geocoder, data URLs, test-mode guard   (configuration)
location.js    navigator.geolocation wrapper                 (location)
geocoding.js   place search + reverse label, swappable       (geocoding)
providers.js   data service layer, validation, verification  (provider data)
distance.js    Haversine + formatting                        (distance)
search.js      radius expansion, ranking                     (search)
ui.js  dom.js  icons.js   rendering, DOM helper, bundled SVG icons   (UI)
pwa.js         service worker, install prompt, offline banner (PWA)
modules.js     registry of the 7 World Pixel labels
app.js         state, router, Near Me flow

providers.json        REAL provider data (23 Gauteng records) <- data
locations.json        Gauteng place centres (quick-pick chips + pixel map) <- data
providers.test.json   synthetic fixtures, development only  <- test data (never loaded in production)

icon.svg  icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png  favicon-32.png
core.test.mjs
```

## Real data vs application code

Application code never contains provider records. The UI is driven entirely by `providers.json`;
replace that file (or point `CONFIG.data.providersUrl` at an API) without touching any JS.

### Provider schema

`id, name, category, description, country, province, district, municipality, city, suburb, address,
latitude, longitude, locationPrecision ('area' | omitted), phone, email, officialWebsite, courses[],
source, note, verificationStatus, lastVerified (YYYY-MM-DD), active`

Only `id` and `name` are required. A record without valid coordinates is kept but **excluded from
distance search** (it is never given a guessed location). Missing optional fields simply don't render:
no phone → no Call button, no website → no Website button, no coordinates → no Directions.

### Verification rules

`verificationStatus` is one of `verified`, `unverified`, `needs_review`, `inactive`.
A record is displayed as **Verified** only if it also has a non-future `lastVerified` date, a `source`,
coordinates, and at least one contact channel. Otherwise it is shown as **Unverified** and the detail
page explains why. Records not checked for 365 days (`CONFIG.verification.staleAfterDays`) get an
"may be out of date" note. Inactive providers never appear in search.

### Test mode

Synthetic fixtures load only when the host is `localhost`/`127.0.0.1` **and** the URL has `?test=1`.
They are anchored at 0°N 0°E (open ocean), named `TEST RECORD …`, badged "Test data", and filtered out
of any non-test index in code (covered by unit tests). Use the "Use test origin" button on the home screen.

## Location and search

- **Near me** → `navigator.geolocation` (denied, unavailable, timeout, unsupported and insecure-context
  states each have their own message). Manual town/city search is always available.
- Manual search uses OpenStreetMap **Nominatim** through `geocoding.js`, restricted to `za`
  (`CONFIG.geocoder.nominatim.countryCodes`; set to `''` for worldwide). There is no autocomplete
  and no hard-coded city list. If a local gazetteer (`locations.json → places`) is filled in,
  it is searched first.
- Search starts at 10 km and expands to 25, 50, then 100 km, stating when it expanded. Tiers are never
  mixed: results show only providers within the tier that first had any, with a button to widen.
- Nominatim's public instance has a usage policy (about 1 request/second, no bulk use). Fine for Drop 01
  traffic; for production scale swap in a hosted geocoder by adding an adapter in `geocoding.js`.

### Privacy

Location lives in memory for the current session only and is cleared when the user starts over.
Nothing is written to storage. Distances are computed on the device. Device coordinates are rounded to
~1 km before being sent to Nominatim, and only to name the area.

## PWA

Manifest (standalone, `WORLD PIXEL`), icons incl. maskable, service worker and offline page.
The service worker caches the **app shell only**. Provider data and geocoding are never cached, so
offline the interface opens, a banner says finding providers needs a connection, and searches fail
honestly. The install button appears only when the browser offers installation.

## Palette (from the PixelProTech corporate profile)

| Token | Hex | Use | Contrast on `#07070A` |
|---|---|---|---|
| bg | `#07070A` | page | – |
| text | `#F1EEFA` | headings | 17.6 |
| body | `#C7C1DA` | body | 11.6 |
| muted | `#9A90B8` | secondary text | 6.8 |
| teal | `#00D4AA` | the one action colour, Verified | 10.5 |
| gold | `#D8B96A` | needs review, errors, test data | 10.6 |
| violet-text | `#B79CFF` | Unverified (lightened from brand violet `#7B2FFF`, 3.5:1) | 8.8 |
| edge | `#6F6890` | control borders | 3.9 (3.3 on surfaces) |
| faint | `#524B6A` | decorative lines only, 2.5:1, never text | – |

## Future labels

`modules.js` reserves 02 PLACES, 03 COMPUTER SCHOOLS, 04 COURSES, 05 SEARCH PIXEL, 06 PROVIDERS,
07 WORLD as `planned`. They have no routes, pages or buttons until built.

## What was tested

Automated (Chromium, 51 browser checks + 19 unit tests): permission granted/denied/unavailable/timeout/
unsupported; production empty index; test-mode tiers, ordering, inactive/no-coordinate/beyond-100 km
exclusion; missing phone/website/address; verification downgrade and stale notice; manual search,
unknown place, geocoder failure; provider-not-found; manifest, icons, service worker, offline shell;
no horizontal scroll at 320/390/768/1280/1920 px; 44 px touch targets; skip link, focus ring, keyboard search.

**Not yet verified, check before launch:**
- A real phone's GPS prompt and a real Nominatim query (the sandbox had no internet; the geocoder was stubbed).
- Install flow on Android/iOS and a Lighthouse PWA run on the deployed HTTPS URL.
- Screen-reader pass (NVDA/VoiceOver). Semantics and labels are in place but were not tested with one.
- Real provider records: none have been added or verified.

Filter and Menu icons were left out on purpose: there is no filter or menu feature in Drop 01, and the
brief forbids dead buttons.
