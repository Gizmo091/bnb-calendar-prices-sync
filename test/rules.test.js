import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mode, inferRules, resolvePrice, generateYear } from '../src/core/rules.js';
import { labelYear, labelDay } from '../src/core/labeling.js';
import { eachDay } from '../src/core/dates.js';
import { contextFor } from './helpers.js';

const BASE = 150;
const ctx2026 = contextFor(2026);
const ctx2027 = contextFor(2027);

/**
 * Année 2026 tarifée à la main : base 150, janvier hors vacances 200, Noël 260,
 * hiver 220 à 300 selon zones, été 180, samedi hors vacances 190.
 */
function pricedYear2026() {
    const days = {};
    for (const d of eachDay('2026-01-01', '2026-12-31')) {
        const label = labelDay(d, ctx2026);
        let price = BASE;
        if (label.season === 'none' && label.dayType === 'sat') price = 190;
        if (label.season === 'none' && label.gap === 'noel>hiver') price = 200;
        if (label.season === 'noel') price = 260;
        if (label.season === 'hiver') price = label.zones.length > 1 ? 300 : 220;
        if (label.season === 'ete') price = 180;
        days[d] = { price, custom: price !== BASE };
    }
    return days;
}

test('mode : valeur la plus fréquente, la plus haute en cas d\'égalité', () => {
    assert.deepEqual(mode([1, 2, 2, 3]), { value: 2, count: 2 });
    assert.deepEqual(mode([5, 7]), { value: 7, count: 1 });
});

test('inferRules retrouve la grille saisie', () => {
    const rules = inferRules(pricedYear2026(), labelYear(2026, ctx2026));
    assert.equal(rules['none|ete>toussaint|wk'].price, BASE);
    assert.equal(rules['none|ete>toussaint|sat'].price, 190);
    assert.equal(rules['none|noel>hiver|wk'].price, 200);
    assert.equal(rules['noel|ABC|wk'].price, 260);
    assert.equal(rules['hiver|A|wk'].price, 220);
    assert.equal(rules['hiver|AB|wk'].price, 300);
    assert.equal(rules['ete|ABC|sat'].price, 180);
    assert.equal(rules['hiver|A|wk'].share, 1);
});

test('resolvePrice replie sur la saison la plus proche puis le hors-vacances voisin puis la base', () => {
    const rules = {
        'hiver|A|wk': { price: 220, samples: 5 },
        'hiver|AB|wk': { price: 300, samples: 5 },
        'none|noel>hiver|wk': { price: 200, samples: 20 },
        'none|hiver>printemps|wk': { price: 140, samples: 20 },
        'none|hiver>printemps|sat': { price: 190, samples: 4 },
        'none|ete>toussaint|wk': { price: 100, samples: 30 },
    };
    const lbl = (season, zones, dayType, before, after) => ({
        season, zones, dayType, before, after,
        gap: season === 'none' || season === 'ferie' ? `${before}>${after}` : null,
    });
    assert.equal(resolvePrice(lbl('hiver', ['A'], 'wk', 'noel', 'printemps'), rules, 1).source, 'exact');
    const bc = resolvePrice(lbl('hiver', ['B', 'C'], 'wk', 'noel', 'printemps'), rules, 1);
    assert.equal(bc.price, 300, 'deux zones : la règle à deux zones est la plus proche');
    assert.equal(resolvePrice(lbl('hiver', ['C'], 'sat', 'noel', 'printemps'), rules, 1).source, 'season');
    const printemps = resolvePrice(lbl('printemps', ['A'], 'sat', 'hiver', 'ascension'), rules, 1);
    assert.equal(printemps.rule, 'none|hiver>printemps|sat', 'vacances sans règle : hors-vacances qui les précède, même type de jour');
    const ferie = resolvePrice(lbl('ferie', [], 'wk', 'noel', 'hiver'), rules, 1);
    assert.equal(ferie.rule, 'none|noel>hiver|wk', 'férié sans règle : hors-vacances de la même période');
    const inconnu = resolvePrice(lbl('none', [], 'wk', 'toussaint', 'noel'), rules, 1);
    assert.equal(inconnu.rule, 'none|ete>toussaint|wk', 'période absente : la plus fournie faute de bornes communes');
    const voisin = resolvePrice(lbl('none', [], 'wk', 'hiver', 'ascension'), rules, 1);
    assert.equal(voisin.rule, 'none|hiver>printemps|wk', 'période absente : mêmes vacances précédentes');
    assert.equal(resolvePrice(lbl('toussaint', ['A'], 'sat', 'ete', 'noel'), {}, 99).price, 99);
});

test('generateYear projette 2026 sur 2027 en suivant les vacances de 2027', () => {
    const rules = inferRules(pricedYear2026(), labelYear(2026, ctx2026));
    const next = generateYear(2027, rules, ctx2027, BASE);
    assert.equal(Object.keys(next).length, 365);
    const hiverA = ctx2027.schoolPeriods.find((p) => p.season === 'hiver' && p.zone === 'A');
    assert.ok(hiverA, 'vacances d\'hiver 2027 zone A connues');
    assert.equal(next[hiverA.start].price >= 220, true);
    assert.equal(next['2027-01-13'].price, 200, 'janvier hors vacances suit janvier');
    assert.equal(next['2027-10-13'].price, BASE);
    assert.equal(next['2027-10-16'].price, 190, 'samedi hors vacances');
    assert.equal(next['2027-10-15'].price, BASE, 'vendredi au prix de semaine');
    assert.equal(next['2027-01-02'].price, 260, 'fin des vacances de Noël 2026-2027');
    assert.equal(next['2027-12-24'].price, 260, 'Noël 2027-2028');
});
