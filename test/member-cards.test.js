import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initMembers } from '../public/members.js';

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => {},
    };
  }

  get firstElementChild() { return this.children[0]; }
  get childElementCount() { return this.children.length; }
  setAttribute() {}
  addEventListener() {}
  getAnimations() { return []; }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  replaceWith(node) {
    const parent = this.parent;
    const index = parent.children.indexOf(this);
    this.remove();
    node.remove();
    node.parent = parent;
    parent.children.splice(index, 0, node);
  }

  replaceChildren(...nodes) {
    for (const node of [...this.children]) node.remove();
    this.append(...nodes);
  }

  insertBefore(node, reference) {
    node.remove();
    node.parent = this;
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index, 0, node);
  }

  querySelectorAll(selector) {
    const name = selector.slice(1);
    return this.children.flatMap(child => [
      ...(child.className.split(' ').includes(name) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

test('member refresh preserves cards and effects; delayed and early-arriving drops still animate', async t => {
  const document = globalThis.document;
  const fetch = globalThis.fetch;
  const setInterval = globalThis.setInterval;
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.setInterval = (...args) => setInterval(...args).unref();
  let response;
  globalThis.fetch = async (_url, options) => {
    const body = await new Promise((resolve, reject) => {
      response = resolve;
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    return { ok: true, status: 200, json: async () => body };
  };
  const container = new Element('div');
  const status = new Element('div');
  const ui = initMembers({ container, status, authHeader: () => ({}), onUnauthorized: () => {} });
  t.after(() => {
    ui.clear();
    globalThis.document = document;
    globalThis.fetch = fetch;
    globalThis.setInterval = setInterval;
  });
  const wait = () => new Promise(resolve => setTimeout(resolve, 130));
  const member = { username: 'Test Player', stats: { MINING: { level: 9, xp: 1035 } },
    updatedAt: Date.now() };
  const drop = (id, username = member.username, delay = 0) => ({
    id, username, skill: 'MINING', amount: 35, receivedAt: Date.now() - delay,
  });
  const send = drops => response({
    reset: false, cursor: 'test:1', serverTime: Date.now(), drops,
  });

  ui.update([member], 'live');
  response({ reset: true, cursor: 'test:0', serverTime: Date.now(), drops: [] });
  await wait();
  send([drop('delayed', member.username, 6000), drop('early', 'New Player')]);
  await wait();
  const original = container.firstElementChild;
  const effects = original.querySelectorAll('.player-xp-effects')[0];
  assert.equal(effects.childElementCount, 1, 'A six-second-delayed event must still animate');
  const effect = effects.firstElementChild;
  const activity = original.querySelectorAll('.player-training')[0];
  const label = activity.firstElementChild;

  ui.update([member, { ...member, username: 'New Player' }], 'live');
  assert.equal(container.firstElementChild, original, 'Snapshot refresh must not replace the card');
  assert.equal(effects.firstElementChild, effect, 'In-flight animations must remain attached');
  assert.equal(activity.firstElementChild, label, 'Unchanged activity must not be rebuilt');
  assert.equal(container.children[1].querySelectorAll('.player-xp-effects')[0].childElementCount, 1,
    'A drop arriving before its first member snapshot must animate when the card appears');

  send([drop('expired', member.username, 16000)]);
  await wait();
  assert.equal(effects.childElementCount, 1, 'Old events must not replay as live animations');
  ui.clear();
  assert.equal(container.childElementCount, 0);
});
