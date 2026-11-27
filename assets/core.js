// Calendar and allocation rules shared by the UI and the dependency-free tests.
const DAY = 86_400_000;
const WEEK = 7 * DAY;
export const AGE_CATEGORIES = ['Young', 'Ready', 'Old'];

function localDay(value = new Date()) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return value;
}

function dayStamp(value) {
  const text = localDay(value);
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
  const [year, month, date] = text.split('-').map(Number);
  if (year < 1900 || year > 9999) return NaN;
  const stamp = Date.UTC(year, month - 1, date);
  return new Date(stamp).toISOString().slice(0, 10) === text ? stamp : NaN;
}

function monday(stamp) {
  return stamp - ((new Date(stamp).getUTCDay() + 6) % 7) * DAY;
}

function weekAtStamp(stamp) {
  if (!Number.isFinite(stamp)) return null;
  const thursday = new Date(monday(stamp) + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const first = monday(Date.UTC(year, 0, 4));
  return `${year}-W${String(Math.round((monday(stamp) - first) / WEEK) + 1).padStart(2, '0')}`;
}

export function plantingWeek(value = new Date()) {
  return weekAtStamp(dayStamp(value));
}

export function weekStart(value) {
  if (typeof value !== 'string' || !/^\d{4}-W\d{2}$/.test(value)) return NaN;
  const [year, week] = value.split('-W').map(Number);
  if (year < 1900 || year > 9999 || week < 1 || week > 53) return NaN;
  const stamp = monday(Date.UTC(year, 0, 4)) + (week - 1) * WEEK;
  return weekAtStamp(stamp) === value ? stamp : NaN;
}

export function weeksAgo(weeks, now = new Date()) {
  return weekAtStamp(monday(dayStamp(now)) - weeks * WEEK);
}

export function maturity(batch, now = new Date()) {
  const plantedWeek = batch.plantedWeek || (batch.date ? plantingWeek(batch.date) : null);
  const start = weekStart(plantedWeek);
  const current = weekStart(plantingWeek(now));
  const weeks = Math.round((current - start) / WEEK);
  if (!Number.isFinite(weeks) || weeks < 0) return { weeks: null, category: 'Unknown', plantedWeek };
  return { weeks, category: weeks < 4 ? 'Young' : weeks <= 8 ? 'Ready' : 'Old', plantedWeek };
}

const canonical = value => String(value || '').trim().toLowerCase();
export const productKey = batch => JSON.stringify([batch.name, batch.variety, batch.pot, batch.category].map(canonical));

export function catalog(batches) {
  const products = new Map();
  for (const batch of batches) {
    const key = productKey(batch);
    if (!products.has(key)) products.set(key, { key, name: batch.name, variety: batch.variety, pot: batch.pot, category: batch.category });
  }
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export function planOrder(batches, lines, { includeOld = false, now = new Date() } = {}) {
  const requested = new Map();
  const products = new Map(catalog(batches).map(p => [p.key, p]));
  const errors = [];
  if (!Array.isArray(lines) || !lines.length) errors.push('Add at least one plant to this order.');
  for (const line of lines || []) {
    const qty = Number(line.qty);
    if (!products.has(line.productKey)) { errors.push('Select a plant for every order line.'); continue; }
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1_000_000) { errors.push('Use whole quantities between 1 and 1,000,000.'); continue; }
    requested.set(line.productKey, (requested.get(line.productKey) || 0) + qty);
  }
  const picks = [];
  const summaries = [];
  if (!errors.length) for (const [key, qty] of requested) {
    const matches = batches.filter(p => productKey(p) === key && Number.isSafeInteger(p.qty) && p.qty > 0)
      .map(p => ({ ...p, ...maturity(p, now) }));
    const eligible = matches.filter(p => p.category === 'Ready' || (includeOld && p.category === 'Old'))
      .sort((a, b) => (a.category === 'Ready' ? 0 : 1) - (b.category === 'Ready' ? 0 : 1)
        || weekStart(a.plantedWeek) - weekStart(b.plantedWeek) || a.lot.localeCompare(b.lot) || a.id.localeCompare(b.id));
    let remaining = qty;
    for (const p of eligible) {
      if (!remaining) break;
      const take = Math.min(p.qty, remaining);
      picks.push({ batchId: p.id, lot: p.lot, productKey: key, name: p.name, variety: p.variety, pot: p.pot, location: p.location,
        qty: take, available: p.qty, ageWeeks: p.weeks, ageCategory: p.category, plantedWeek: p.plantedWeek, price: p.price });
      remaining -= take;
    }
    const stock = category => matches.filter(p => p.category === category).reduce((sum, p) => sum + p.qty, 0);
    summaries.push({ ...products.get(key), requested: qty, shortfall: remaining, ready: stock('Ready'), old: stock('Old'), young: stock('Young') });
  }
  return { errors: [...new Set(errors)], picks, summaries, complete: !errors.length && summaries.length > 0 && summaries.every(p => !p.shortfall),
    requested: [...requested.values()].reduce((a, b) => a + b, 0), allocated: picks.reduce((a, p) => a + p.qty, 0),
    total: Math.round(picks.reduce((a, p) => a + Math.round(p.price * 100) * p.qty, 0)) / 100 };
}

export function fulfillOrder(state, request, { now = new Date(), id = `order-${Date.now()}` } = {}) {
  // Recompute from live stock. Displayed recommendations never reserve inventory.
  const plan = planOrder(state.batches, request.lines, { now, includeOld: request.includeOld === true });
  if (!plan.complete) throw new Error(plan.errors[0] || 'There is not enough eligible stock to fulfill this order.');
  if ((state.orders || []).some(o => o.id === id)) throw new Error('This order has already been fulfilled.');
  const next = structuredClone(state);
  const picks = plan.picks.map(p => {
    const location = state.locations.find(l => l.id === p.location);
    return { ...p, locationLabel: location ? `${location.house} / ${location.bench}` : p.location };
  });
  for (const pick of picks) next.batches.find(p => p.id === pick.batchId).qty -= pick.qty;
  const order = { id, ref: String(request.ref || '').trim().slice(0, 80) || `Order ${next.orders.length + 1}`,
    time: now.toISOString(), status: 'Fulfilled', includeOld: request.includeOld === true,
    lines: plan.summaries.map(p => ({ productKey: p.key, name: p.name, variety: p.variety, pot: p.pot, qty: p.requested })),
    picks, qty: plan.allocated, total: plan.total };
  next.orders.unshift(order);
  next.events.unshift({ id: `${id}-event`, type: 'order', title: `${order.ref} fulfilled`,
    detail: `${order.qty} plants · ${picks.length} batch picks · ${order.total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
    note: request.includeOld ? 'Staff allowed old stock; ready plants were selected first.' : 'Ready stock only · oldest ready batches first',
    time: order.time, total: order.total });
  return { state: next, order };
}

export function migrateState(saved) {
  if (![1, 2].includes(saved?.version) || !Array.isArray(saved.batches)) throw new Error('Unsupported saved data.');
  const next = structuredClone(saved);
  if (next.version === 1) {
    next.version = 2;
    next.batches = next.batches.map(({ stage, date, ...p }) => ({ ...p, plantedWeek: p.plantedWeek || plantingWeek(date) }));
    next.orders = [];
  }
  next.counter = Math.max(Number(next.counter) || 0, ...next.batches.map(p => Number(String(p.lot).replace('GH-', '')) || 0));
  return next;
}

export function validState(s) {
  return s?.version === 2 && typeof s.revision === 'string' && Number.isSafeInteger(s.counter)
    && Array.isArray(s.locations) && Array.isArray(s.batches) && Array.isArray(s.events) && Array.isArray(s.orders)
    && new Set(s.locations.map(l => l.id)).size === s.locations.length
    && new Set(s.batches.map(p => p.id)).size === s.batches.length
    && s.locations.every(l => typeof l.id === 'string' && typeof l.house === 'string' && typeof l.bench === 'string')
    && s.batches.every(p => typeof p.id === 'string' && typeof p.lot === 'string' && typeof p.name === 'string'
      && typeof p.category === 'string' && typeof p.pot === 'string' && typeof p.variety === 'string'
      && Number.isSafeInteger(p.qty) && p.qty >= 0 && Number.isFinite(p.price) && p.price >= 0
      && Number.isSafeInteger(p.threshold) && p.threshold >= 0 && Number.isFinite(weekStart(p.plantedWeek))
      && s.locations.some(l => l.id === p.location));
}
