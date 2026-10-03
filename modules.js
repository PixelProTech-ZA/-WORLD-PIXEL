// Registry of World Pixel labels. Only 'live' modules have routes and UI.
// 'planned' entries reserve the architecture and are never rendered as pages or buttons.
export const MODULES = Object.freeze([
  { id: 'near-me',           number: '01', label: 'NEAR ME',           route: '#/near', status: 'live' },
  { id: 'places',            number: '02', label: 'PLACES',            route: null, status: 'planned' },
  { id: 'computer-schools',  number: '03', label: 'COMPUTER SCHOOLS',  route: null, status: 'planned' },
  { id: 'courses',           number: '04', label: 'COURSES',           route: null, status: 'planned' },
  { id: 'search-pixel',      number: '05', label: 'SEARCH PIXEL',      route: null, status: 'planned' },
  { id: 'providers',         number: '06', label: 'PROVIDERS',         route: null, status: 'planned' },
  { id: 'world',             number: '07', label: 'WORLD',             route: null, status: 'planned' }
]);

export const liveModules = () => MODULES.filter((m) => m.status === 'live');
