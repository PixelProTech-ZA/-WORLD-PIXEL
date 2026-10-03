// Device location via the real Geolocation API. Nothing is stored.
import { CONFIG } from './config.js';

export class LocationError extends Error {
  /** code: 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout' */
  constructor(code, message) {
    super(message || code);
    this.name = 'LocationError';
    this.code = code;
  }
}

export function getDeviceLocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return reject(new LocationError('unsupported'));
    }
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
      return reject(new LocationError('insecure'));
    }
    const { timeoutMs, maximumAgeMs, enableHighAccuracy } = CONFIG.geolocation;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy
        }),
      (err) => {
        const map = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
        reject(new LocationError(map[err.code] || 'unavailable', err.message));
      },
      { enableHighAccuracy, timeout: timeoutMs, maximumAge: maximumAgeMs }
    );
  });
}
