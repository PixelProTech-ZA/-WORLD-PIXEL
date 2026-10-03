// Service worker registration, install prompt, and honest offline messaging.
import { h } from './dom.js';
import { icon } from './icons.js';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* app still works without it */ });
  });
}

export function setupInstallButton(slot) {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    slot.replaceChildren(h('button', { type: 'button', class: 'linkbtn', onClick: async () => {
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      slot.replaceChildren();
    } }, icon('install', { size: 16 }), 'Install app'));
  });
  window.addEventListener('appinstalled', () => slot.replaceChildren());
}

export function setupNetworkBanner(banner) {
  const sync = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}
