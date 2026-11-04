import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRanges, toWeekdayRanges, priceForDate, describeOp } from '../src/core/ranges.js';
import { planUpdates } from '../src/core/plan.js';
import { detectBasePrice } from '../src/core/basePrice.js';
import { validateExport, createExport, scalePrices } from '../src/core/schema.js';

test('toRanges fusionne les nuits contiguës de même prix', () => {
    const ranges = toRanges({ '2027-02-06': 220, '2027-02-07': 220, '2027-02-08': 220, '2027-02-10': 220, '2027-02-11': 300 });
    assert.deepEqual(ranges, [
        { from: '2027-02-06', to: '2027-02-08', price: 220, nights: 3 },
        { from: '2027-02-10', to: '2027-02-10', price: 220, nights: 1 },
        { from: '2027-02-11', to: '2027-02-11', price: 300, nights: 1 },
    ]);
});

test('planUpdates n\'écrase pas les prix personnalisés', () => {
    const current = {
        '2027-02-06': { price: 150, custom: false },
        '2027-02-07': { price: 150 },
        '2027-02-08': { price: 199, custom: true },
        '2027-02-09': { price: 199 },
        '2027-02-10': { price: 220 },
        '2027-02-12': { price: 150, reserved: true },
    };
    const proposed = Object.fromEntries(Object.keys(current).concat('2027-02-11').map((d) => [d, { price: 220 }]));
    const plan = planUpdates(current, proposed, { basePrice: 150 });
    assert.deepEqual(plan.ops, [{ from: '2027-02-06', to: '2027-02-07', price: 220, nights: 2 }]);
    assert.equal(plan.unchanged, 1);
    assert.deepEqual(plan.skipped.map((s) => `${s.date}:${s.reason}`), ['2027-02-08:custom', '2027-02-09:custom', '2027-02-12:reserved', '2027-02-11:unknown']);
    const forced = planUpdates(current, proposed, { basePrice: 150, overwriteCustom: true });
    assert.equal(forced.changed, 4, 'une nuit réservée reste exclue même en écrasant les prix personnalisés');
    const dated = planUpdates(current, proposed, { basePrice: 150, notBefore: '2027-02-07' });
    assert.equal(dated.past, 1, 'le 6 février est écarté');
    assert.deepEqual(dated.ops, [{ from: '2027-02-07', to: '2027-02-07', price: 220, nights: 1 }]);
});

test('detectBasePrice regarde au-delà de l\'horizon', () => {
    const days = {};
    for (let i = 0; i < 30; i++) days[`2026-12-${String(i + 1).padStart(2, '0')}`] = { price: 260 };
    for (let i = 0; i < 20; i++) days[`2028-06-${String(i + 1).padStart(2, '0')}`] = { price: 150 };
    days['2028-06-21'] = { price: 170 };
    const base = detectBasePrice(days, { from: '2026-11-04' });
    assert.equal(base.price, 150);
    assert.equal(base.samples, 21);
    assert.ok(base.share > 0.9);
});

test('validateExport et scalePrices', () => {
    const doc = createExport({ site: 'airbnb', listingId: '1', days: { '2027-01-01': { price: 100 } } });
    assert.deepEqual(validateExport(doc), []);
    assert.ok(validateExport({ version: 1, days: { '2027-02-30': { price: 1 } } }).length);
    assert.ok(validateExport({ version: 1, days: { '2027-01-01': { price: -1 } } }).length);
    assert.equal(scalePrices(doc.days, 1.07, 5)['2027-01-01'].price, 105);
});

test('toWeekdayRanges regroupe une période à motif hebdomadaire constant', () => {
    // du lundi 5 au dimanche 18 juillet 2027 : semaine 178, samedi 355 ; puis 19-20 à 95
    const prices = {};
    const days = ['2027-07-05', '2027-07-06', '2027-07-07', '2027-07-08', '2027-07-09', '2027-07-10', '2027-07-11',
        '2027-07-12', '2027-07-13', '2027-07-14', '2027-07-15', '2027-07-16', '2027-07-17', '2027-07-18'];
    for (const d of days) prices[d] = d === '2027-07-10' || d === '2027-07-17' ? 355 : 178;
    prices['2027-07-19'] = 95;
    prices['2027-07-20'] = 95;
    const ops = toWeekdayRanges(prices);
    assert.equal(ops.length, 2);
    assert.equal(ops[0].from, '2027-07-05');
    assert.equal(ops[0].to, '2027-07-18');
    assert.equal(ops[0].nights, 14);
    assert.equal(ops[0].price, null);
    assert.deepEqual(ops[0].byWeekday, { monday: 178, tuesday: 178, wednesday: 178, thursday: 178, friday: 178, saturday: 355, sunday: 178 });
    assert.deepEqual(ops[1], { from: '2027-07-19', to: '2027-07-20', nights: 2, price: 95 });
    assert.equal(priceForDate(ops[0], '2027-07-17'), 355);
    assert.equal(priceForDate(ops[0], '2027-07-12'), 178);
    assert.equal(priceForDate(ops[1], '2027-07-19'), 95);
    assert.equal(describeOp(ops[0]), 'lun/mar/mer/jeu/ven/dim 178 · sam 355');
    assert.equal(describeOp(ops[1]), '95');
});

test('toWeekdayRanges coupe quand un jour de la semaine change de prix', () => {
    const prices = { '2027-07-05': 100, '2027-07-06': 100, '2027-07-12': 100, '2027-07-13': 120 };
    const ops = toWeekdayRanges(prices);
    assert.equal(ops.length, 2, 'rupture de contiguïté entre le 6 et le 12');
    const weekly = toWeekdayRanges({ '2027-07-05': 100, '2027-07-06': 100, '2027-07-07': 100, '2027-07-08': 100, '2027-07-09': 100, '2027-07-10': 100, '2027-07-11': 100, '2027-07-12': 100, '2027-07-13': 120 });
    assert.equal(weekly.length, 2, 'le mardi 13 à 120 contredit le mardi 6 à 100');
    assert.equal(weekly[1].from, '2027-07-13');
});
