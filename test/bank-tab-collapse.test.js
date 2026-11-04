import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankTabCollapse } from '../public/bank-tab-collapse.js';

function button() {
  const events = new Map();
  return {
    title: 'Tab 1',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { events.set(name, callback); },
    dispatch(name, key = '', shiftKey = false) {
      let prevented = false;
      events.get(name)?.({ key, shiftKey, preventDefault() { prevented = true; } });
      return prevented;
    },
  };
}

test('right-click toggles per-member bank tabs and preserves state across re-renders', () => {
  const state = bankTabCollapse();
  let renders = 0;
  const bind = (owner = 'Player', tab = 1) => {
    const target = button();
    state.bind(target, owner, tab, () => renders++);
    return target;
  };
  const first = bind();
  assert.equal(first.attributes['aria-expanded'], 'true');
  assert.equal(first.dispatch('contextmenu'), true);
  assert.equal(state.isCollapsed('Player', 1), true);
  assert.equal(renders, 1);
  const refreshed = bind();
  assert.equal(refreshed.attributes['aria-expanded'], 'false');
  assert.match(refreshed.title, /expand/);
  assert.equal(state.isCollapsed('Other Player', 1), false);
  assert.equal(state.isCollapsed('Player', 2), false);
  refreshed.dispatch('contextmenu');
  assert.equal(state.isCollapsed('Player', 1), false);
  bind('Player', 0).dispatch('contextmenu');
  assert.equal(state.isCollapsed('Player', 0), true);
  state.clear();
  assert.equal(state.isCollapsed('Player', 0), false);
});

test('context-menu keyboard shortcuts toggle without changing ordinary left-click behavior', () => {
  const state = bankTabCollapse();
  let renders = 0;
  const target = button();
  state.bind(target, 'Player', 1, () => renders++);
  assert.equal(target.dispatch('keydown', 'Enter'), false);
  assert.equal(target.dispatch('click'), false);
  assert.equal(renders, 0);
  assert.equal(target.dispatch('keydown', 'F10', true), true);
  assert.equal(state.isCollapsed('Player', 1), true);
  assert.equal(target.dispatch('keydown', 'ContextMenu'), true);
  assert.equal(state.isCollapsed('Player', 1), false);
});
