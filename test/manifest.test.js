import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

const exists = (path) => existsSync(resolve(root, path));

/** Au moins un fichier répond au motif, où `*` vaut pour un segment ou un nom. */
function anyMatch(pattern) {
    let candidates = [root];
    for (const part of pattern.split('/')) {
        const escaped = part.replace(/[.+^$(){}|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const re = new RegExp(`^${escaped}$`);
        candidates = candidates.flatMap((dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [])
            .filter((entry) => re.test(entry.name))
            .map((entry) => resolve(dir, entry.name)));
    }
    return candidates.length > 0;
}

test('le manifeste est en version 3 et déclare le panneau latéral', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.permissions.includes('sidePanel'));
    assert.ok(manifest.permissions.includes('storage'));
    assert.ok(manifest.side_panel?.default_path);
});

test('chaque fichier référencé par le manifeste existe', () => {
    assert.ok(exists(manifest.background.service_worker), manifest.background.service_worker);
    assert.ok(exists(manifest.side_panel.default_path), manifest.side_panel.default_path);
    for (const script of manifest.content_scripts.flatMap((cs) => cs.js)) {
        assert.ok(exists(script), script);
    }
    for (const pattern of manifest.web_accessible_resources.flatMap((r) => r.resources)) {
        assert.ok(anyMatch(pattern), pattern);
    }
});

test('les hôtes des sites pris en charge sont autorisés', () => {
    for (const host of ['airbnb.fr', 'abritel.fr']) {
        assert.ok(manifest.host_permissions.some((p) => p.includes(host)), host);
        assert.ok(manifest.content_scripts.some((cs) => cs.matches.some((m) => m.includes(host))), host);
    }
});
