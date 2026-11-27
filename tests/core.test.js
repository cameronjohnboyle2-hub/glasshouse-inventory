import test from 'node:test';
import assert from 'node:assert/strict';
import { plantingWeek, weekStart, weeksAgo, maturity, productKey, planOrder, fulfillOrder, migrateState, validState } from '../assets/core.js';

const now = new Date('2026-11-26T18:00:00.000Z');
const batch = (id, weeks, qty, extra = {}) => ({ id, lot: `GH-${id}`, name: 'Golden pothos', variety: 'Aureum', category: 'Houseplants',
  pot: '4-inch', qty, plantedWeek: weeksAgo(weeks, now), location: 'bench-a', price: 12, threshold: 5, ...extra });
const stock = [batch('young', 2, 100), batch('ready5', 5, 20), batch('old10', 10, 40), batch('ready8', 8, 10), batch('ready4', 4, 15)];
const lines = qty => [{ productKey: productKey(stock[0]), qty }];
const state = () => ({ version: 2, revision: 'initial', counter: 1, locations: [{ id: 'bench-a', house: 'Greenhouse 1', bench: 'A' }],
  batches: structuredClone(stock), orders: [], events: [] });

test('planting weeks start on Monday, including Sunday-to-Monday transitions', () => {
  assert.equal(plantingWeek('2026-11-22'), '2026-W47');
  assert.equal(plantingWeek('2026-11-23'), '2026-W48');
  assert.equal(plantingWeek('2026-11-29'), '2026-W48');
  assert.equal(plantingWeek('2026-11-30'), '2026-W49');
});
test('ISO week-years are correct at the calendar year boundary', () => {
  assert.equal(plantingWeek('2027-01-01'), '2026-W53');
  assert.equal(plantingWeek('2027-01-04'), '2027-W01');
  assert.equal(weekStart('2026-W53'), Date.UTC(2026, 11, 28));
  assert(Number.isNaN(weekStart('2025-W53')));
});
test('invalid weeks, malformed dates, and future weeks are excluded', () => {
  for (const invalid of ['2026-W00', '2026-W54', '2026-W1', '', null]) assert(Number.isNaN(weekStart(invalid)));
  assert.equal(plantingWeek('2026-02-30'), null);
  assert.equal(maturity({ plantedWeek: '2027-W10' }, now).category, 'Unknown');
  assert.equal(maturity({}, now).category, 'Unknown');
});
test('ages 0–3 are young, 4–8 are ready, and 9+ are old', () => {
  for (const [weeks, category] of [[0,'Young'],[1,'Young'],[3,'Young'],[4,'Ready'],[7,'Ready'],[8,'Ready'],[9,'Old'],[20,'Old']]) {
    assert.deepEqual(maturity(batch('a', weeks, 1), now), { weeks, category, plantedWeek: weeksAgo(weeks, now) });
  }
});
test('age changes from Sunday to Monday without a saved stage or date edit', () => {
  const p = { plantedWeek: '2026-W45' };
  assert.equal(maturity(p, '2026-11-29').category, 'Young');
  assert.equal(maturity(p, '2026-11-30').category, 'Ready');
});
test('week age remains correct across daylight saving time', () => {
  assert.equal(maturity({ plantedWeek: '2026-W43' }, '2026-11-02').weeks, 2);
  assert.equal(maturity({ plantedWeek: '2026-W09' }, '2026-03-09').weeks, 2);
});
test('allocation takes the oldest ready batches first across locations', () => {
  const plan = planOrder(stock, lines(25), { now });
  assert.equal(plan.complete, true);
  assert.deepEqual(plan.picks.map(p => [p.batchId,p.qty]), [['ready8',10],['ready5',15]]);
  assert.equal(plan.total, 300);
});
test('suggesting a pick does not mutate or reserve inventory', () => {
  const before = structuredClone(stock);
  planOrder(stock, lines(40), { now });
  assert.deepEqual(stock, before);
});
test('young and old stock do not hide a shortage in ready stock', () => {
  const plan = planOrder(stock, lines(50), { now });
  assert.equal(plan.complete, false);
  assert.equal(plan.allocated, 45);
  assert.deepEqual([plan.summaries[0].shortfall,plan.summaries[0].old,plan.summaries[0].young],[5,40,100]);
  assert(plan.picks.every(p => p.ageCategory === 'Ready'));
});
test('old stock is used only when allowed and only after ready stock', () => {
  const plan = planOrder(stock, lines(55), { now, includeOld: true });
  assert.equal(plan.complete, true);
  assert.deepEqual(plan.picks.map(p => [p.batchId,p.qty]), [['ready8',10],['ready5',20],['ready4',15],['old10',10]]);
  assert(plan.picks.every(p => p.ageCategory !== 'Young'));
});
test('duplicate product lines are combined before allocation', () => {
  const plan = planOrder(stock, [...lines(30),...lines(30)], { now });
  assert.equal(plan.requested, 60);
  assert.equal(plan.allocated, 45);
  assert.equal(plan.summaries[0].shortfall, 15);
});
test('varieties and pot sizes stay separate and cannot fill one another', () => {
  const other = [batch('different-pot',8,100,{pot:'6-inch'}),batch('different-variety',8,100,{variety:'Marble Queen'})];
  const plan = planOrder([...stock,...other], lines(50), { now });
  assert.equal(plan.allocated,45);
});
test('zero stock and future planting weeks are never allocated', () => {
  const plan = planOrder([batch('zero',8,0),batch('future',-1,40)], lines(1), { now,includeOld:true });
  assert.equal(plan.allocated,0);
  assert.equal(plan.complete,false);
});
test('invalid, empty and fractional quantities cannot be fulfilled', () => {
  for (const qty of [0,-1,1.5,'',NaN,Infinity,1_000_001]) assert.equal(planOrder(stock,lines(qty),{now}).complete,false);
  assert.equal(planOrder(stock,[],{now}).complete,false);
  assert.equal(planOrder(stock,[{productKey:'missing',qty:1}],{now}).complete,false);
});
test('fulfillment deducts all picks, adds an order, and logs its sale atomically', () => {
  const initial = state();
  const result = fulfillOrder(initial, { ref:'ORDER-101',lines:lines(25),includeOld:false }, {now,id:'order1'});
  assert.equal(result.state.batches.find(p=>p.id==='ready8').qty,0);
  assert.equal(result.state.batches.find(p=>p.id==='ready5').qty,5);
  assert.equal(initial.batches.find(p=>p.id==='ready8').qty,10);
  assert.equal(initial.orders.length,0);
  assert.equal(result.state.orders.length,1);
  assert.equal(result.state.events[0].total,300);
  assert.equal(result.order.picks[0].locationLabel,'Greenhouse 1 / A');
  assert.equal(result.order.picks[0].ageWeeks,8);
});
test('fulfillment recalculates live stock and rejects a stale suggestion', () => {
  const initial = state();
  assert(planOrder(initial.batches,lines(40),{now}).complete);
  initial.batches.find(p=>p.id==='ready8').qty=0;
  const snapshot=structuredClone(initial);
  assert.throws(()=>fulfillOrder(initial,{lines:lines(40)},{now}),/not enough/);
  assert.deepEqual(initial,snapshot);
});
test('repeated fulfillment IDs are rejected', () => {
  const first=fulfillOrder(state(),{lines:lines(1)},{now,id:'same'}).state;
  assert.throws(()=>fulfillOrder(first,{lines:lines(1)},{now,id:'same'}),/already/);
});
test('an order shortage leaves every product and history untouched', () => {
  const initial=state(),before=structuredClone(initial);
  assert.throws(()=>fulfillOrder(initial,{lines:[...lines(50)]},{now}));
  assert.deepEqual(initial,before);
});
test('old prototype data migrates while preserving quantities, IDs and history', () => {
  const old={version:1,revision:'old',counter:4,locations:state().locations,batches:[{...stock[0],plantedWeek:undefined,date:'2026-10-26',stage:'Growing'}],events:[{id:'old-log'}]};
  const migrated=migrateState(old);
  assert.equal(migrated.version,2);
  assert.equal(migrated.batches[0].plantedWeek,'2026-W44');
  assert.equal(migrated.batches[0].qty,100);
  assert.equal(migrated.batches[0].stage,undefined);
  assert.deepEqual(migrated.events,old.events);
  assert.deepEqual(migrated.orders,[]);
  assert(validState(migrated));
});
test('state serialization preserves fulfilled pick history and planting weeks', () => {
  const completed=fulfillOrder(state(),{lines:lines(12)},{now,id:'durable'}).state;
  const restored=migrateState(JSON.parse(JSON.stringify(completed)));
  assert(validState(restored));
  assert.deepEqual(restored,completed);
  assert.equal(restored.orders[0].picks[0].ageWeeks,8);
});
