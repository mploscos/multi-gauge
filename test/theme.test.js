import test from 'node:test';
import assert from 'node:assert/strict';
import { SEMANTIC_KINDS } from '../src/index.js';
import { DEFAULT_THEME } from '../src/theme.js';

test('public semantic kinds match built-in theme colors', () => {
    assert.deepEqual(SEMANTIC_KINDS, [
        'normal',
        'warning',
        'critical',
        'inactive',
        'target'
    ]);
    for (const kind of SEMANTIC_KINDS) {
        assert.equal(typeof DEFAULT_THEME[kind], 'string');
    }
    assert.ok(Object.isFrozen(SEMANTIC_KINDS));
});
