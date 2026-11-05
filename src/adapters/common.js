/** Utilitaires partagés par les adaptateurs : attente d'éléments et temporisation. */
import { t } from '../core/i18n.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(selector, { root = document, timeout = 10000, interval = 100 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const el = root.querySelector(selector);
        if (el) {
            return el;
        }
        await sleep(interval);
    }
    throw new Error(t('err_element_missing', selector));
}

/** Saisie dans un champ contrôlé par React : setter natif puis événements. */
export function setInputValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    input.focus();
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Prix affiché dans un bloc de texte multi-ligne : on ne retient que la ligne
 * qui porte le symbole €, pour ne jamais coller le numéro du jour au prix.
 */
export function priceInText(text) {
    for (const line of String(text).split(/\n/)) {
        const m = line.match(/(\d[\d\u202f\u00a0 ]*(?:[.,]\d+)?)\s*€/);
        if (m) {
            return parsePrice(m[1]);
        }
    }
    return null;
}

export function parsePrice(text) {
    const cleaned = String(text).replace(/\s| | /g, '').replace(',', '.').replace(/[^\d.]/g, '');
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
}

export function notCalibrated(site, feature) {
    return new Error(t('err_uncalibrated', site, feature));
}
