/**
 * معالجة رسائل كل عميل بالترتيب.
 * الرد البطيء كان يتداخل مع الرسالة التالية فيضيع الاختيار (مرحبا ثم 1)
 * أو يُحذف. هنا تُنفَّذ واحدة ثم التي بعدها، ويُتجاهل تكرار نفس النص
 * ما دام الرد عليه لم يكتمل.
 */
const states = new Map();
const MAX_CHATS = 500;
const MAX_SEEN_IDS = 80;

function ensure(key) {
  const id = String(key || "unknown");
  let state = states.get(id);
  if (!state) {
    state = {
      id,
      pending: [],
      inflight: null,
      running: false,
      seenIds: new Set(),
      usedAt: Date.now(),
    };
    states.set(id, state);
    if (states.size > MAX_CHATS) pruneIdle();
  }
  state.usedAt = Date.now();
  return state;
}

function pruneIdle() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, state] of states) {
    if (state.running || state.pending.length) continue;
    if (state.usedAt < cutoff) states.delete(id);
  }
  if (states.size <= MAX_CHATS) return;
  const idle = [...states.entries()]
    .filter(([, state]) => !state.running && !state.pending.length)
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  while (states.size > MAX_CHATS && idle.length) {
    states.delete(idle.shift()[0]);
  }
}

function rememberId(state, messageId) {
  state.seenIds.add(messageId);
  if (state.seenIds.size <= MAX_SEEN_IDS) return;
  const oldest = state.seenIds.values().next().value;
  state.seenIds.delete(oldest);
}

/**
 * @param {string} key رقم العميل أو معرّف المحادثة
 * @param {{ body?: string, messageId?: string }} meta
 * @param {() => Promise<unknown>} fn
 */
function enqueueTurn(key, meta, fn) {
  const state = ensure(key);
  const body = String(meta?.body || "");
  const messageId = meta?.messageId ? String(meta.messageId) : "";

  if (messageId && state.seenIds.has(messageId)) {
    return Promise.resolve({ skipped: "duplicate_id" });
  }
  if (messageId) rememberId(state, messageId);

  if (body && state.pending.some((job) => job.body === body)) {
    return Promise.resolve({ skipped: "duplicate_pending" });
  }
  if (body && state.inflight && state.inflight.body === body) {
    return Promise.resolve({ skipped: "duplicate_inflight" });
  }

  let resolve;
  let reject;
  const done = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  state.pending.push({ body, fn, resolve, reject });
  drain(state);
  return done;
}

async function drain(state) {
  if (state.running) return;
  state.running = true;
  try {
    while (state.pending.length) {
      const job = state.pending.shift();
      state.inflight = job;
      try {
        const result = await job.fn();
        job.resolve(result);
      } catch (err) {
        job.reject(err);
      } finally {
        if (state.inflight === job) state.inflight = null;
      }
    }
  } finally {
    state.running = false;
    if (state.pending.length) drain(state);
  }
}

module.exports = {
  enqueueTurn,
};
