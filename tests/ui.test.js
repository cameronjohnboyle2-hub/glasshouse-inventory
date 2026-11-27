// Lightweight UI/controller smoke tests. These do not replace a visual browser check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../assets/core.js';
import { webcrypto } from 'node:crypto';

async function app(existingStorage) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', hidden: false, elements: {},
      close() { this.open = false; }, showModal() { this.open = true; } });
    return nodes.get(selector);
  };
  const storage = existingStorage || new Map();
  const listeners = new Map();
  const document = { querySelector: node, querySelectorAll: () => [],
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]) };
  class FormData { constructor(form) { return Object.entries(form.values); } }
  const context = { core, document, window: { addEventListener() {} }, FormData, Date, Intl, Number, String, Math, JSON, Set, Object, Array,
    crypto: webcrypto, structuredClone, setTimeout() {}, clearTimeout() {}, setInterval() {},
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } };
  context.globalThis = context;
  let source = await readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
  source = source.replace(/^import \{([^}]+)\} from '.\/core.js';/, 'const {$1} = core;');
  source = source.replace(/\}\)\(\);\s*$/, `globalThis.api={get state(){return state},get draft(){return orderDraft},setView(v){view=v;render()},submitForm,undo,openDialog};})();`);
  vm.runInNewContext(source, context, { filename: 'app.js' });
  const submit = (type, values, id = '') => context.api.submitForm({ preventDefault() {}, target: {
    id: 'actionForm', dataset: { type, id, revision: context.api.state.revision }, values } });
  return { api: context.api, node, submit, storage, listeners };
}

test('inventory and order screens initialize with age totals and oldest-ready suggestions', async () => {
  const { api, node } = await app();
  assert.equal(api.state.batches.reduce((n,p)=>n+p.qty,0),544);
  assert(node('#content').innerHTML.includes('Ready to sell'));
  assert(node('#table').innerHTML.includes('Age / planted week'));
  assert(node('#table').innerHTML.includes('Old'));
  api.setView('orders');
  assert(node('#content').innerHTML.includes('Confirm picking & deduct stock'));
  assert(node('#orderPlan').innerHTML.includes('GH-109'));
  assert(!node('#orderPlan').innerHTML.includes('GH-110'));
  assert.equal(node('#confirmOrder').disabled,false);
});

test('planting, sale limits, moves, edits, undo, and reload preserve age-driven inventory', async () => {
  const { api, node, submit, storage } = await app();
  const values = { name: 'Test <plant>', variety: 'Test', category: 'Herbs', pot: '4-inch', plantedWeek: core.plantingWeek(),
    qty: '25', price: '2.50', threshold: '0', location: 'l1', note: '' };
  submit('plant',values);
  const fresh=api.state.batches.at(-1);
  assert.equal(fresh.lot,'GH-113');
  assert.equal(core.maturity(fresh).category,'Young');
  assert(node('#table').innerHTML.includes('Test &lt;plant&gt;'));
  assert(!node('#table').innerHTML.includes('Test <plant>'));
  submit('sale',{source:fresh.id,qty:'26',price:'2.50',note:''});
  assert.equal(api.state.batches.at(-1).qty,25);
  submit('move',{source:fresh.id,qty:'5',destination:'l2',note:''});
  const moved=api.state.batches.find(p=>p.lot==='GH-113'&&p.location==='l2');
  assert.equal(moved.qty,5);
  assert.equal(moved.plantedWeek,fresh.plantedWeek);
  submit('edit',{...values,plantedWeek:core.weeksAgo(4)},fresh.id);
  assert.equal(core.maturity(api.state.batches.find(p=>p.id===fresh.id)).category,'Ready');
  api.undo();
  assert.equal(core.maturity(api.state.batches.find(p=>p.id===fresh.id)).category,'Young');
  const reloaded=await app(storage);
  assert.equal(reloaded.api.state.batches.find(p=>p.id===moved.id).qty,5);
  assert.equal(reloaded.api.state.batches.find(p=>p.id===fresh.id).threshold,0);
});

test('order form confirmation persists stock and order history together and undo restores both', async () => {
  const { api, node, listeners, storage } = await app();
  api.setView('orders');
  const before=api.state.batches.find(p=>p.id==='p9').qty;
  for (const handler of listeners.get('submit')) handler({ preventDefault() {}, target: { id:'orderForm' } });
  assert.equal(api.state.orders.length,1);
  assert.equal(api.state.orders[0].qty,24);
  assert.equal(api.state.batches.find(p=>p.id==='p9').qty,before-24);
  assert(node('#content').innerHTML.includes('View picks'));
  assert.equal((await app(storage)).api.state.orders.length,1);
  api.undo();
  assert.equal(api.state.orders.length,0);
  assert.equal(api.state.batches.find(p=>p.id==='p9').qty,before);
});
