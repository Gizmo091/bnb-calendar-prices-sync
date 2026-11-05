/**
 * Textes de l'interface. Un catalogue chargé par `setMessages` ou
 * `useLanguage` (langue choisie dans les réglages, aperçu, tests) prime ;
 * sinon Chrome fournit la langue et les messages
 * (`_locales/<langue>/messages.json`). Les messages utilisent `$1`, `$2`…
 * pour leurs valeurs.
 */
let messages = null;
let forcedLocale = null;

const hasChrome = () => typeof globalThis.chrome?.i18n?.getMessage === 'function';

export function setMessages(dict, locale = null) {
    messages = dict;
    forcedLocale = locale;
}

/** Langue de l'interface, au format BCP 47 (« fr », « en-US »). */
export function currentLocale() {
    if (forcedLocale) {
        return forcedLocale;
    }
    if (hasChrome()) {
        return chrome.i18n.getUILanguage();
    }
    return globalThis.navigator?.language ?? 'en';
}

export function t(key, ...subs) {
    const values = subs.map((v) => String(v));
    const entry = messages?.[key];
    if (entry) {
        return entry.message.replace(/\$(\d)/g, (_, n) => values[Number(n) - 1] ?? '');
    }
    if (hasChrome()) {
        const text = chrome.i18n.getMessage(key, values);
        if (text) {
            return text;
        }
    }
    return key;
}

/**
 * Charge le catalogue d'une langue (« en », « fr ») et l'impose ; `auto` ou
 * vide rend la main à la langue de Chrome. Hors extension, le catalogue est
 * lu à côté des sources.
 */
export async function useLanguage(lang) {
    if (!lang || lang === 'auto') {
        setMessages(null, null);
        return;
    }
    const path = `_locales/${lang}/messages.json`;
    const url = globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : new URL(`../../${path}`, import.meta.url);
    setMessages(await (await fetch(url)).json(), lang);
}

/**
 * Traduit un fragment de DOM : `data-i18n` remplit le texte, `data-i18n-title`,
 * `data-i18n-aria-label`, `data-i18n-placeholder` et `data-i18n-empty`
 * (attribut `data-empty`, lu par le style du journal vide) les attributs.
 */
export function translateDom(root) {
    for (const el of root.querySelectorAll('[data-i18n]')) {
        el.textContent = t(el.dataset.i18n);
    }
    const attrs = { 'data-i18n-title': 'title', 'data-i18n-aria-label': 'aria-label', 'data-i18n-placeholder': 'placeholder', 'data-i18n-empty': 'data-empty' };
    for (const [source, target] of Object.entries(attrs)) {
        for (const el of root.querySelectorAll(`[${source}]`)) {
            el.setAttribute(target, t(el.getAttribute(source)));
        }
    }
}
