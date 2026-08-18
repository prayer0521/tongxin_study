/* ============================================================
   store.js —— 进度存档

   双写:localStorage(立即生效) + 服务端 .progress.json(换浏览器也在)。
   服务端是权威源,启动时以它为准。

   数据结构:
     xp     总经验
     done   { "L03": true }        通关的关卡
     labs   { "L03:sticky": true } 做过的实验
     boss   { "L03": 2 }           关底测试答对几题
   ============================================================ */

const Store = (() => {

  const LS = 'tongxin.progress.v1';
  const empty = () => ({ xp: 0, done: {}, labs: {}, boss: {}, notes: {} });

  let state = empty();
  let syncTimer = null;

  function normalize(d) {
    const e = empty();
    if (!d || typeof d !== 'object') return e;
    return {
      xp: Number(d.xp) || 0,
      done: (d.done && typeof d.done === 'object') ? d.done : {},
      labs: (d.labs && typeof d.labs === 'object') ? d.labs : {},
      boss: (d.boss && typeof d.boss === 'object') ? d.boss : {},
      notes: (d.notes && typeof d.notes === 'object') ? d.notes : {},
    };
  }

  async function load() {
    // 服务端优先
    try {
      const r = await fetch('/api/progress');
      if (r.ok) {
        state = normalize(await r.json());
        localStorage.setItem(LS, JSON.stringify(state));
        return state;
      }
    } catch (_) { /* 服务器没起也能用,退回本地 */ }

    try {
      state = normalize(JSON.parse(localStorage.getItem(LS)));
    } catch (_) { state = empty(); }
    return state;
  }

  function flush() {
    localStorage.setItem(LS, JSON.stringify(state));
    clearTimeout(syncTimer);
    // 合并 300ms 内的多次写,少打扰服务器
    syncTimer = setTimeout(() => {
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }).catch(() => {});
    }, 300);
  }

  return {
    load,
    get all() { return state; },
    get xp() { return state.xp; },

    /* 加经验。同一个 key 只算一次 —— 靠调用方先查 has() */
    addXp(n) { state.xp += n; flush(); },

    isDone(lv)      { return !!state.done[lv]; },
    markDone(lv)    { if (!state.done[lv]) { state.done[lv] = true; flush(); return true; } return false; },
    doneCount()     { return Object.keys(state.done).length; },

    labKey(lv, id)  { return lv + ':' + id; },
    labDone(lv, id) { return !!state.labs[this.labKey(lv, id)]; },
    markLab(lv, id) {
      const k = this.labKey(lv, id);
      if (!state.labs[k]) { state.labs[k] = true; flush(); return true; }
      return false;
    },

    bossScore(lv)      { return state.boss[lv] || 0; },
    setBoss(lv, n)     { if (n > (state.boss[lv] || 0)) { state.boss[lv] = n; flush(); } },

    async reset() {
      state = empty();
      localStorage.removeItem(LS);
      try { await fetch('/api/progress/reset', { method: 'POST' }); } catch (_) {}
    },
  };
})();
