// Central configuration. Nothing here is provider data.
const hasLocation = typeof location !== 'undefined';

export const IS_DEV_HOST =
  hasLocation && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

// Test mode needs BOTH a local dev host AND ?test=1. It can never switch on in production.
export const TEST_MODE =
  IS_DEV_HOST && new URLSearchParams(location.search).get('test') === '1';

export const CONFIG = Object.freeze({
  appName: 'WORLD PIXEL',
  radiiKm: [10, 25, 50, 100],
  geolocation: { timeoutMs: 12000, maximumAgeMs: 30000, enableHighAccuracy: false },
  geocoder: {
    // Adapters are tried in this order. See geocoding.js to add or swap one.
    order: ['gazetteer', 'nominatim'],
    nominatim: {
      baseUrl: 'https://nominatim.openstreetmap.org',
      countryCodes: 'za', // set to '' to search worldwide
      language: 'en',
      limit: 5,
      timeoutMs: 10000
    },
    // Coordinates are rounded to this many decimals (~1 km) before reverse lookup.
    reverseCoordDecimals: 2
  },
  data: {
    providersUrl: 'providers.json',
    locationsUrl: 'locations.json',
    testProvidersUrl: 'providers.test.json'
  },
  verification: { staleAfterDays: 365 },
  test: { origin: { lat: 0, lon: 0, label: 'Test origin (0°, 0°)' } }
});
