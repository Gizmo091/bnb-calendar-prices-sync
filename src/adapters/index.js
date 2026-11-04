import airbnb from './airbnb.js';
import abritel from './abritel.js';

export const ADAPTERS = [airbnb, abritel];

export function pickAdapter(hostname) {
    return ADAPTERS.find((a) => a.matches(hostname)) ?? null;
}
