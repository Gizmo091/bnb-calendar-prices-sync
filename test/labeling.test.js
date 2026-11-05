import { test } from 'node:test';
import assert from 'node:assert/strict';
import './setup.js';
import { labelDay, ruleKey, labelYear, describeRuleKey, parseRuleKey, neighbours, dayTypeOf } from '../src/core/labeling.js';
import { contextFor } from './helpers.js';

const ctx = contextFor(2026);

test('une nuit de février en zone A seule', () => {
    const label = labelDay('2026-02-09', ctx);
    assert.equal(label.season, 'hiver');
    assert.deepEqual(label.zones, ['A']);
    assert.equal(ruleKey(label), 'hiver|A|wk');
});

test('semaine commune à deux zones', () => {
    const label = labelDay('2026-02-16', ctx);
    assert.equal(label.season, 'hiver');
    assert.deepEqual(label.zones, ['A', 'B']);
});

test('hors vacances : période définie par les vacances qui l\'encadrent', () => {
    assert.equal(ruleKey(labelDay('2026-01-10', ctx)), 'none|noel>hiver|sat');
    assert.equal(ruleKey(labelDay('2026-01-09', ctx)), 'none|noel>hiver|wk', 'le vendredi est un jour comme les autres');
    assert.equal(ruleKey(labelDay('2026-03-20', ctx)), 'none|hiver>printemps|wk');
    assert.equal(ruleKey(labelDay('2026-06-10', ctx)), 'none|ascension>ete|wk');
    assert.equal(ruleKey(labelDay('2026-10-14', ctx)), 'none|ete>toussaint|wk');
    assert.equal(ruleKey(labelDay('2026-12-01', ctx)), 'none|toussaint>noel|wk');
});

test('une nuit de vacances connaît les vacances voisines', () => {
    const label = labelDay('2026-02-16', ctx);
    assert.equal(label.gap, null);
    assert.equal(label.before, 'noel');
    assert.equal(label.after, 'printemps');
    assert.deepEqual(neighbours('2026-01-10', ctx.schoolPeriods), { before: 'noel', after: 'hiver' });
});

test('jour férié hors vacances devient une saison à part, par mois', () => {
    const label = labelDay('2026-11-11', ctx);
    assert.equal(label.season, 'ferie');
    assert.equal(label.publicHoliday, '11 novembre');
    assert.equal(ruleKey(label), 'ferie|toussaint>noel|wk');
});

test('le 14 juillet reste une nuit d\'été', () => {
    assert.equal(labelDay('2026-07-14', ctx).season, 'ete');
});

test('labelYear couvre 365 jours', () => {
    assert.equal(labelYear(2026, ctx).size, 365);
});

test('describeRuleKey et parseRuleKey', () => {
    assert.equal(describeRuleKey('hiver|AB|sat'), "Vacances d'hiver · zones A+B · samedi");
    assert.equal(describeRuleKey('none|noel>hiver|wk'), 'Hors vacances · entre Noël et hiver · autres jours');
    assert.deepEqual(parseRuleKey('none|hiver>printemps|wk'), { season: 'none', zones: [], gap: 'hiver>printemps', dayType: 'wk' });
    assert.deepEqual(parseRuleKey('hiver|A|sat'), { season: 'hiver', zones: ['A'], gap: null, dayType: 'sat' });
});

test('les jours à tarif propre sont réglables', () => {
    assert.equal(dayTypeOf('2026-01-10'), 'sat', 'samedi par défaut');
    assert.equal(dayTypeOf('2026-01-11'), 'wk', 'le dimanche est un jour comme les autres par défaut');
    assert.equal(dayTypeOf('2026-01-11', [6, 0]), 'sun');
    assert.equal(dayTypeOf('2026-01-10', []), 'wk', 'sans jour à tarif propre, tout est « autres jours »');
    assert.equal(ruleKey(labelDay('2026-01-09', ctx, { specialDays: [5, 6] })), 'none|noel>hiver|fri');
    assert.equal(describeRuleKey('none|noel>hiver|fri'), 'Hors vacances · entre Noël et hiver · vendredi');
    assert.equal(labelYear(2026, ctx, { specialDays: [0] }).get('2026-01-11').dayType, 'sun');
});
