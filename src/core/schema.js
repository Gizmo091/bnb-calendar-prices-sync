import { isISODate } from './dates.js';

export const FORMAT_VERSION = 1;

/**
 * Format d'échange, commun à tous les sites :
 * {
 *   version: 1, site: 'airbnb', listingId: '…', listingName: '…', currency: 'EUR',
 *   exportedAt: ISO 8601, basePrice: 150,
 *   days: { 'YYYY-MM-DD': { price: 180, custom: true, available: true } }
 * }
 */
export function createExport({ site, listingId, listingName = null, currency = 'EUR', basePrice = null, days }) {
    return {
        version: FORMAT_VERSION,
        site,
        listingId,
        listingName,
        currency,
        exportedAt: new Date().toISOString(),
        basePrice,
        days,
    };
}

export function validateExport(obj) {
    const errors = [];
    if (!obj || typeof obj !== 'object') {
        return ['Document JSON attendu'];
    }
    if (obj.version !== FORMAT_VERSION) {
        errors.push(`Version ${obj.version} non prise en charge`);
    }
    if (!obj.days || typeof obj.days !== 'object') {
        errors.push('Champ "days" manquant');
        return errors;
    }
    for (const [date, day] of Object.entries(obj.days)) {
        if (!isISODate(date)) {
            errors.push(`Date invalide : ${date}`);
        }
        else if (typeof day?.price !== 'number' || day.price < 0) {
            errors.push(`Prix invalide pour ${date}`);
        }
        if (errors.length > 10) {
            errors.push('…');
            break;
        }
    }
    return errors;
}

/** Applique un coefficient (ex. pour une autre plateforme) et arrondit. */
export function scalePrices(days, factor, rounding = 1) {
    const out = {};
    for (const [date, day] of Object.entries(days)) {
        out[date] = { ...day, price: Math.round((day.price * factor) / rounding) * rounding };
    }
    return out;
}

/**
 * Nom de fichier d'un export : `prix-<site>-<annonce>-<année>.bnbprices`,
 * l'annonce étant son nom simplifié (sans accent ni ponctuation, en
 * minuscules, 60 caractères au plus), à défaut son identifiant.
 */
export function exportFileName({ site, listingId, listingName, year, extension }) {
    const slug = (listingName ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '');
    const listing = slug || (listingId ? String(listingId).replace(/[^a-z0-9]+/gi, '-') : '');
    return ['prix', site, listing, year].filter(Boolean).join('-') + extension;
}
