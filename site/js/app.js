/* ============================================================
   app.js —— 路由 + 渲染 + 实验执行 + 关底测试

   路由(hash 路由,不需要服务端配合):
     #/map          关卡地图
     #/lv/L03       某一关
     #/arch         系统架构图
     #/skills       能力总览
   ============================================================ */

const App = (() => {

  let manifest = null;
  const levelCache = new Map();
  let lang = localStorage.getItem('tongxin.lang') || 'py';
  let tools = {};

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ---------------------------------------------------------- 工具 */

  function toast(msg, win) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (win ? ' win' : '');
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(() => t.hidden = true, win ? 3200 : 2200);
  }

  const LANG_NAME = { cpp: 'C++', c: 'C', py: 'Python', go: 'Go',
                      bash: 'Shell', http: 'HTTP', json: 'JSON',
                      nginx: 'Nginx', yaml: 'YAML', sql: 'SQL', text: '' };

  /* XP → 段位 */
  const RANKS = [
    [0,    '见习'],
    [120,  '会写 socket'],
    [300,  '懂 TCP 的人'],
    [520,  '能写服务器'],
    [800,  '后端工程师'],
    [1150, '会做架构'],
    [1500, '分布式选手'],
    [1900, '系统设计者'],
  ];
  function rankOf(xp) {
    let r = RANKS[0][1];
    for (const [need, name] of RANKS) if (xp >= need) r = name;
    return r;
  }

  /* 某一关是否解锁:第 1 关永远开;之后要求前一关通关 */
  function unlocked(idx) {
    if (idx === 0) return true;
    return Store.isDone(manifest.levels[idx - 1].id);
  }
  function maxUnlockedNum() {
    let n = 1;
    manifest.levels.forEach((lv, i) => { if (unlocked(i)) n = i + 1; });
    return n;
  }

  /* ---------------------------------------------------------- HUD / 侧栏 */

  function renderHud() {
    const xp = Store.xp;
    const total = manifest.levels.length;
    const done = Store.doneCount();
    $('#hud-rank').textContent = rankOf(xp);
    $('#hud-xp').textContent = xp + ' XP';
    $('#hud-sub').textContent = `${done} / ${total} 关   ·   解锁到第 ${maxUnlockedNum()} 关`;
    // 进度条按关卡数算,比按 XP 更直观
    $('#hud-bar').style.width = (done / total * 100).toFixed(1) + '%';
  }

  function renderNav(activeId) {
    const acts = {};
    manifest.levels.forEach((lv, i) => {
      (acts[lv.act] = acts[lv.act] || []).push([lv, i]);
    });

    let h = '';
    manifest.acts.forEach(act => {
      const list = acts[act.id] || [];
      if (!list.length) return;
      h += `<div class="nav-act">${MD.esc(act.title)} <span>· ${MD.esc(act.goal)}</span></div>`;
      list.forEach(([lv, i]) => {
        const ok = Store.isDone(lv.id);
        const lock = !unlocked(i);
        h += `<a class="nav-item ${lv.id === activeId ? 'on' : ''} ${lock ? 'locked' : ''}"
                 ${lock ? '' : `href="#/lv/${lv.id}"`}>
                <span class="nav-num">${String(i + 1).padStart(2, '0')}</span>
                <span>${MD.esc(lv.title)}</span>
                <span class="nav-tick ${ok ? 'ok' : ''}">${ok ? '✓' : lock ? '🔒' : ''}</span>
              </a>`;
      });
    });
    $('#nav').innerHTML = h;
  }

  /* ---------------------------------------------------------- 块渲染 */

  /* 代码块。支持 { code, lang, file, label } */
  function blkCode(b) {
    return MD.codeBlock(b.code || '', {
      lang: b.lang || 'text', file: b.file || '',
      label: b.label || LANG_NAME[b.lang] || '',
      kind: b.kind || (b.lang === 'term' || b.term ? 'term' : 'code'),
    });
  }

  /* 多语言对照。variants: { cpp: {...}, py: {...}, go: {...} } */
  function blkPoly(b, uid) {
    const keys = Object.keys(b.variants || {});
    if (!keys.length) return '';
    const active = keys.includes(lang) ? lang : keys[0];
    const tabs = keys.map(k =>
      `<button type="button" data-poly="${uid}" data-k="${k}"
        class="${k === active ? 'on' : ''}">${LANG_NAME[k] || k}</button>`).join('');
    const bodies = keys.map(k => {
      const v = b.variants[k];
      return `<div data-polybody="${uid}" data-k="${k}"
                   ${k === active ? '' : 'hidden'}>${
        MD.codeBlock(v.code || '', { lang: k === 'cpp' ? 'cpp' : k, file: v.file || '' })
      }${v.note ? `<div class="poly-note">${MD.render(v.note)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="poly">
      ${b.title ? `<h3 class="sub3">${MD.esc(b.title)}</h3>` : ''}
      <div class="poly-tabs">${tabs}</div>
      <div class="poly-body">${bodies}</div>
    </div>`;
  }

  const NOTE_T = { key: '关键认知', trap: '这是个坑', warn: '注意',
                   biz: '工作里长什么样', info: '补充' };

  function blkNote(b) {
    const k = b.kind || 'info';
    return `<div class="note ${k}">
      <div class="note-t">${MD.esc(b.title || NOTE_T[k] || '')}</div>
      ${MD.render(b.body || '')}
    </div>`;
  }

  function blkFig(b, uid) {
    return `<div class="fig">
      <div class="fig-box" data-fig="${uid}" data-kind="${MD.esc(b.fig)}"></div>
      ${b.cap ? `<div class="fig-cap">${MD.esc(b.cap)}</div>` : ''}
    </div>`;
  }

  /* 实验卡 */
  function blkLab(b, lvId, uid) {
    const done = Store.labDone(lvId, b.id);
    const canRun = !!b.script;
    const missing = (b.needs || []).filter(t => tools[t] === false);
    return `<div class="lab" data-lab="${uid}" data-lvid="${lvId}"
                 data-labid="${MD.esc(b.id)}" data-script="${MD.esc(b.script || '')}"
                 data-xp="${b.xp || 20}">
      <div class="lab-head">
        <span class="lab-tag">实验</span>
        <h4>${MD.esc(b.title || '')}</h4>
        <span class="lab-xp">${done ? '<span style="color:#56d364">✓ 已完成</span>'
                                    : '+' + (b.xp || 20) + ' XP'}</span>
      </div>
      <div class="lab-body">
        ${MD.render(b.intro || '')}
        ${b.ask ? `<div class="lab-ask">先猜一下:${MD.esc(b.ask)}</div>` : ''}
        ${b.cmd ? MD.codeBlock(b.cmd, { lang: 'bash', label: '这个实验会跑' }) : ''}
        ${missing.length ? `<div class="note warn"><div class="note-t">缺工具</div>
           <p>本机没装 <code>${missing.join('</code> <code>')}</code>,这个实验跑不了。
              读下面的预期输出也能懂。</p></div>` : ''}
        <div class="lab-run">
          ${canRun && !missing.length
            ? `<button class="btn go" data-run="${uid}" type="button">▶ 在本机真跑一遍</button>`
            : ''}
          ${b.expect ? `<button class="btn ghost" data-peek="${uid}" type="button">看预期输出</button>` : ''}
          <span class="lab-hint" data-hint="${uid}">${
            canRun && !missing.length ? `labs/${MD.esc(b.script)}.sh` : ''}</span>
        </div>
        <div class="lab-out" data-out="${uid}"></div>
        <div data-explain="${uid}" hidden>
          ${b.explain ? `<h3 class="sub3">发生了什么</h3>${MD.render(b.explain)}` : ''}
        </div>
      </div>
    </div>`;
  }

  function blkTable(b) {
    let md = '| ' + b.head.join(' | ') + ' |\n|' + b.head.map(() => '---').join('|') + '|\n';
    b.rows.forEach(r => md += '| ' + r.join(' | ') + ' |\n');
    return (b.title ? `<h3 class="sub3">${MD.esc(b.title)}</h3>` : '') + MD.render(md);
  }

  function renderBlocks(blocks, lvId) {
    let h = '';
    (blocks || []).forEach((b, i) => {
      const uid = lvId + '-' + i;
      switch (b.t) {
        case 'h':     h += `<h2 class="sec">${MD.esc(b.text)}</h2>`; break;
        case 'p':     h += MD.render(b.text); break;
        case 'hook':  h += `<div class="hook"><div class="hook-tag">${
                        MD.esc(b.tag || '场景')}</div>${MD.render(b.text)}</div>`; break;
        case 'note':  h += blkNote(b); break;
        case 'code':  h += blkCode(b); break;
        case 'poly':  h += blkPoly(b, uid); break;
        case 'fig':   h += blkFig(b, uid); break;
        case 'lab':   h += blkLab(b, lvId, uid); break;
        case 'table': h += blkTable(b); break;
        case 'hr':    h += '<hr>'; break;
        default:      h += MD.render(b.text || '');
      }
    });
    return h;
  }

  /* ---------------------------------------------------------- Boss */

  function renderBoss(lv) {
    const qs = lv.boss || [];
    if (!qs.length) return '';
    const scored = Store.bossScore(lv.id);
    return `<div class="boss" data-boss="${lv.id}">
      <div class="boss-head">
        <span class="lab-tag">关底</span>
        <h3>${MD.esc(lv.bossTitle || '通关测试')}</h3>
      </div>
      <p class="boss-lead">全部答对才算通关,解锁下一关。答错会告���你为什么 ——
         错一次比背十遍有用。${scored ? `(上次:${scored}/${qs.length})` : ''}</p>
      ${qs.map((q, i) => `
        <div class="q" data-q="${i}">
          <div class="q-txt"><span class="qn">Q${i + 1}</span>${MD.inline(MD.esc(q.q))}</div>
          ${q.opts.map((o, j) => `
            <label class="opt" data-opt="${j}">
              <input type="radio" name="${lv.id}-q${i}" value="${j}">
              <span>${MD.inline(MD.esc(o))}</span>
            </label>`).join('')}
          <div class="q-why" data-why="${i}" hidden></div>
        </div>`).join('')}
      <div class="lab-run" style="margin-top:22px">
        <button class="btn go" data-submit="${lv.id}" type="button">提交答案</button>
        <span class="lab-hint" data-bosshint></span>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------- 页面:关卡 */

  async function loadLevel(id) {
    if (levelCache.has(id)) return levelCache.get(id);
    const r = await fetch(`/content/levels/${id}.json`);
    if (!r.ok) throw new Error('关卡内容缺失: ' + id);
    const data = await r.json();
    levelCache.set(id, data);
    return data;
  }

  async function viewLevel(id) {
    const idx = manifest.levels.findIndex(l => l.id === id);
    if (idx < 0) return viewMap();
    if (!unlocked(idx)) {
      $('#view').innerHTML = `<div class="empty">这一关还锁着。先通过第 ${idx} 关。</div>`;
      return;
    }

    const meta = manifest.levels[idx];
    const act = manifest.acts.find(a => a.id === meta.act) || {};
    let lv;
    try { lv = await loadLevel(id); }
    catch (e) {
      $('#view').innerHTML = `<div class="empty">${MD.esc(e.message)}</div>`;
      return;
    }

    const prev = idx > 0 ? manifest.levels[idx - 1] : null;
    const next = idx + 1 < manifest.levels.length ? manifest.levels[idx + 1] : null;
    const isDone = Store.isDone(id);

    $('#crumb').textContent =
      `${act.title || ''} / 第 ${idx + 1} 关 / ${meta.title}`;

    $('#view').innerHTML = `
      <div class="lv-head">
        <div class="lv-kicker">第 ${String(idx + 1).padStart(2, '0')} 关 · ${MD.esc(act.title || '')}</div>
        <h1>${MD.esc(lv.title || meta.title)}</h1>
        ${lv.subtitle ? `<div class="sub">${MD.inline(MD.esc(lv.subtitle))}</div>` : ''}
      </div>
      ${renderBlocks(lv.blocks, id)}
      ${renderBoss(lv)}
      ${lv.unlocks ? `<div class="unlocked">
         <div class="note-t">通关后你的架构图会长出</div>
         ${MD.render(lv.unlocks)}</div>` : ''}
      <div class="lv-foot">
        ${prev ? `<a class="btn ghost" href="#/lv/${prev.id}">← ${MD.esc(prev.title)}</a>` : '<span></span>'}
        <span class="grow"></span>
        ${isDone && next
          ? `<a class="btn go" href="#/lv/${next.id}">下一关:${MD.esc(next.title)} →</a>`
          : next ? `<span class="lab-hint">通过关底测试解锁「${MD.esc(next.title)}」</span>`
                 : `<span class="lab-hint">这是最后一关</span>`}
      </div>`;

    mountFigs();
    window.scrollTo(0, 0);
  }

  /* 把 fig 占位符换成真图 */
  function mountFigs() {
    $$('[data-fig]').forEach(hostEl => {
      if (hostEl.dataset.mounted) return;
      hostEl.dataset.mounted = '1';
      const kind = hostEl.dataset.kind;
      const fn = Diagrams[kind];
      if (typeof fn !== 'function') {
        hostEl.innerHTML = `<div class="lab-hint">未知图示: ${MD.esc(kind)}</div>`;
        return;
      }
      try {
        fn(hostEl, kind === 'architecture' ? { upto: maxUnlockedNum() } : {});
      } catch (e) {
        hostEl.innerHTML = `<div class="lab-hint">图示出错: ${MD.esc(e.message)}</div>`;
      }
    });
  }

  /* ---------------------------------------------------------- 页面:地图 */

  function viewMap() {
    $('#crumb').textContent = '关卡地图';
    const done = Store.doneCount();
    const total = manifest.levels.length;

    let h = `<div class="map-hero">
      <h1>从两台主机,到一套现代后端</h1>
      <p>${MD.inline(MD.esc(manifest.intro || ''))}</p>
    </div>`;

    if (done === 0) {
      h += `<div class="hook"><div class="hook-tag">怎么用这个站</div>
        <p>每一关都是同一个结构:<strong>先给你一个业务场景</strong>(为什么需要这个东西)
        → <strong>底层原理</strong> → <strong>三种语言怎么写</strong> →
        <strong>在你本机真跑一个实验</strong> → <strong>关底测试</strong>。</p>
        <p>关底测试全对才解锁下一关。左下角有一张
        <a href="#/arch">系统架构图</a>,你每通一关它长出一块 —— 那就是你要建立的
        「整个系统认知」的具体形状。</p></div>`;
    }

    manifest.acts.forEach(act => {
      const list = manifest.levels
        .map((lv, i) => [lv, i])
        .filter(([lv]) => lv.act === act.id);
      if (!list.length) return;

      h += `<div class="act">
        <div class="act-bar">
          <span class="act-n">第 ${MD.esc(act.id)} 幕</span>
          <h2>${MD.esc(act.title)}</h2>
          <span class="act-goal">${MD.esc(act.goal)}</span>
        </div>
        <div class="cards">`;

      list.forEach(([lv, i]) => {
        const ok = Store.isDone(lv.id);
        const lock = !unlocked(i);
        const now = !ok && !lock;
        h += `<${lock ? 'div' : 'a'} class="card ${ok ? 'done' : ''} ${lock ? 'locked' : ''} ${now ? 'now' : ''}"
                ${lock ? '' : `href="#/lv/${lv.id}"`}>
          ${ok ? '<span class="c-badge">✓ 通关</span>'
               : now ? '<span class="c-badge">进行中</span>' : ''}
          <div class="c-top">
            <span class="c-n">${String(i + 1).padStart(2, '0')}</span>
            <h3>${MD.esc(lv.title)}</h3>
          </div>
          <p>${MD.esc(lv.blurb || '')}</p>
          <div class="c-foot">
            ${lock ? '🔒 未解锁' : `+${lv.xp || 0} XP`}
            ${lv.labs ? ` · ${lv.labs} 个实验` : ''}
          </div>
        </${lock ? 'div' : 'a'}>`;
      });
      h += `</div></div>`;
    });

    h += `<div class="act">
      <div class="act-bar"><h2>你的系统现在长这样</h2>
      <span class="act-goal">${done}/${total} 关</span></div>
      <div class="fig"><div class="fig-box" data-fig="map-arch"
        data-kind="architecture"></div></div></div>`;

    $('#view').innerHTML = h;
    mountFigs();
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------- 页面:架构图 */

  function viewArch() {
    $('#crumb').textContent = '系统架构图';
    const n = maxUnlockedNum();
    $('#view').innerHTML = `
      <div class="lv-head">
        <div class="lv-kicker">全局视图</div>
        <h1>系统架构图</h1>
        <div class="sub">这张图会随你的进度生长。当前解锁到<strong>第 ${n} 关</strong>,
          亮着的部分就是你已经懂的。虚线框是后面的关卡。</div>
      </div>
      <div class="arch-wrap"><div class="fig-box" data-fig="arch-main"
        data-kind="architecture" style="border:0;background:none"></div></div>
      <div class="arch-legend">
        <span><i style="background:#4fc3d9"></i>客户端</span>
        <span><i style="background:#e3b341"></i>流量入口</span>
        <span><i style="background:#56d364"></i>应用层</span>
        <span><i style="background:#f47067"></i>缓存</span>
        <span><i style="background:#a98bf5"></i>存储</span>
        <span><i style="background:#f778ba"></i>异步</span>
      </div>
      <h2 class="sec">一个请求的完整路径</h2>
      <p>上面那张图是<strong>空间</strong>上的结构。下面这张是<strong>时间</strong>上的:
        同一个请求依次经过了什么,每一步花多久。两张图合起来才是完整的心智模型。</p>
      <div class="fig"><div class="fig-box" data-fig="arch-path"
        data-kind="requestpath"></div></div>`;
    mountFigs();
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------- 页面:能力 */

  function viewSkills() {
    $('#crumb').textContent = '能力总览';
    const rows = [];
    manifest.levels.forEach((lv, i) => {
      (lv.skills || []).forEach(sk => rows.push({
        ...sk, lvNum: i + 1, lvId: lv.id, got: Store.isDone(lv.id),
      }));
    });
    const got = rows.filter(r => r.got).length;

    $('#view').innerHTML = `
      <div class="lv-head">
        <div class="lv-kicker">技能树</div>
        <h1>能力总览</h1>
        <div class="sub">这一栏回答「学完能干什么」。已点亮 <strong>${got}/${rows.length}</strong>。
          每条都是可以写进简历、也能在面试里讲清楚的具体能力。</div>
      </div>
      <div class="skills">${rows.map(r => `
        <div class="skill ${r.got ? 'got' : ''}">
          <h4>${r.got ? '✓ ' : ''}${MD.esc(r.name)}</h4>
          <p>${MD.esc(r.desc)}</p>
          <div class="s-lv"><a href="#/lv/${r.lvId}">第 ${r.lvNum} 关</a></div>
        </div>`).join('')}</div>`;
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------- 实验执行 */

  async function runLab(uid) {
    const card = document.querySelector(`[data-lab="${uid}"]`);
    const btn  = document.querySelector(`[data-run="${uid}"]`);
    const out  = document.querySelector(`[data-out="${uid}"]`);
    const hint = document.querySelector(`[data-hint="${uid}"]`);
    const script = card.dataset.script;
    const lvId = card.dataset.lvid, labId = card.dataset.labid;
    const xp = +card.dataset.xp || 20;

    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> 跑着…';
    hint.textContent = '实验里有 sleep 和端口操作,可能要十几秒';
    out.innerHTML = '';

    let res;
    try {
      const r = await fetch('/api/lab/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: script }),
      });
      res = await r.json();
    } catch (e) {
      out.innerHTML = `<div class="lab-verdict fail">跑不起来:${MD.esc(e.message)}
        <br>确认 <code>python3 serve.py</code> 还在运行。</div>`;
      btn.disabled = false; btn.textContent = '▶ 再试一次';
      return;
    }

    btn.disabled = false;
    btn.textContent = '▶ 再跑一遍';

    if (res.error) {
      out.innerHTML = `<div class="lab-verdict fail">${MD.esc(res.error)}</div>`;
      hint.textContent = '';
      return;
    }

    hint.textContent = `${res.seconds}s · 退出码 ${res.exit}` +
      (res.timedOut ? ' · 超时被中断' : '');

    out.innerHTML = MD.codeBlock(res.output || '(没有输出)', {
      kind: 'term', label: '你本机的真实输出',
      file: `labs/${script}.sh`,
    });

    // 展开解释
    const ex = document.querySelector(`[data-explain="${uid}"]`);
    if (ex) ex.hidden = false;

    const fresh = Store.markLab(lvId, labId);
    if (fresh) {
      Store.addXp(xp);
      renderHud();
      card.querySelector('.lab-xp').innerHTML =
        '<span style="color:#56d364">✓ 已完成</span>';
      toast(`实验完成  +${xp} XP`, true);
    }
  }

  function peekExpect(uid) {
    const card = document.querySelector(`[data-lab="${uid}"]`);
    const out = document.querySelector(`[data-out="${uid}"]`);
    const lvId = card.dataset.lvid;
    const lv = levelCache.get(lvId);
    const labId = card.dataset.labid;
    const blk = (lv.blocks || []).find(b => b.t === 'lab' && b.id === labId);
    if (!blk || !blk.expect) return;
    out.innerHTML = MD.codeBlock(blk.expect, {
      kind: 'term', label: '预期输出(参考机器上的实测)',
    });
    const ex = document.querySelector(`[data-explain="${uid}"]`);
    if (ex) ex.hidden = false;
  }

  /* ---------------------------------------------------------- Boss 判卷 */

  function submitBoss(lvId) {
    const lv = levelCache.get(lvId);
    const qs = lv.boss || [];
    const wrap = document.querySelector(`[data-boss="${lvId}"]`);
    const hint = wrap.querySelector('[data-bosshint]');

    let right = 0, unanswered = 0;

    qs.forEach((q, i) => {
      const qEl = wrap.querySelector(`[data-q="${i}"]`);
      const chosen = qEl.querySelector('input:checked');
      const why = qEl.querySelector(`[data-why="${i}"]`);

      qEl.querySelectorAll('.opt').forEach(o => {
        o.classList.remove('right', 'wrong');
        o.classList.add('locked');
      });

      if (!chosen) { unanswered++; return; }
      const pick = +chosen.value;
      const ans = q.a;

      qEl.querySelector(`[data-opt="${ans}"]`).classList.add('right');
      if (pick === ans) right++;
      else qEl.querySelector(`[data-opt="${pick}"]`).classList.add('wrong');

      if (q.why) {
        why.hidden = false;
        why.innerHTML = (pick === ans ? '' : '<strong>正确答案已标绿。</strong> ') +
          MD.inline(MD.esc(q.why));
      }
    });

    if (unanswered) {
      hint.textContent = `还有 ${unanswered} 题没选`;
      // 没答完就允许重选
      wrap.querySelectorAll('.opt').forEach(o => o.classList.remove('locked'));
      return;
    }

    Store.setBoss(lvId, right);

    if (right === qs.length) {
      hint.innerHTML = `<span style="color:#56d364">全对 ${right}/${qs.length}</span>`;
      const idx = manifest.levels.findIndex(l => l.id === lvId);
      const meta = manifest.levels[idx];
      const fresh = Store.markDone(lvId);
      if (fresh) {
        Store.addXp(meta.xp || 40);
        toast(`第 ${idx + 1} 关通过!  +${meta.xp || 40} XP  ·  ${
          idx + 1 < manifest.levels.length
            ? '解锁「' + manifest.levels[idx + 1].title + '」'
            : '全部关卡完成'}`, true);
      }
      renderHud(); renderNav(lvId);
      // 重绘尾部,把"下一关"按钮放出来
      viewLevel(lvId);
    } else {
      hint.innerHTML = `<span style="color:#f47067">${right}/${qs.length}
        —— 看一下解释,然后再来一次</span>`;
      // 允许重答
      setTimeout(() => {
        wrap.querySelectorAll('.opt').forEach(o => o.classList.remove('locked'));
      }, 400);
    }
  }

  /* ---------------------------------------------------------- 语言切换 */

  function setLang(l) {
    lang = l;
    localStorage.setItem('tongxin.lang', l);
    $$('#langpick button').forEach(b => b.classList.toggle('on', b.dataset.lang === l));
    // 所有 poly 块跟着切(有该语言就切,没有就保持)
    $$('.poly').forEach(p => {
      const tab = p.querySelector(`.poly-tabs button[data-k="${l}"]`);
      if (tab) tab.click();
    });
  }

  /* ---------------------------------------------------------- 路由 */

  function route() {
    const h = location.hash || '#/map';
    const m = /^#\/lv\/([A-Za-z0-9_]+)/.exec(h);
    if (m) { renderNav(m[1]); return viewLevel(m[1]); }
    renderNav(null);
    if (h.startsWith('#/arch'))   return viewArch();
    if (h.startsWith('#/skills')) return viewSkills();
    return viewMap();
  }

  /* ---------------------------------------------------------- 事件 */

  function wire() {
    // 事件委托:内容是动态生成的,不能逐个挂
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-run],[data-peek],[data-submit],[data-poly]');
      if (!t) return;
      if (t.dataset.run)    return runLab(t.dataset.run);
      if (t.dataset.peek)   return peekExpect(t.dataset.peek);
      if (t.dataset.submit) return submitBoss(t.dataset.submit);
      if (t.dataset.poly) {
        const uid = t.dataset.poly, k = t.dataset.k;
        document.querySelectorAll(`[data-poly="${uid}"]`)
          .forEach(b => b.classList.toggle('on', b.dataset.k === k));
        document.querySelectorAll(`[data-polybody="${uid}"]`)
          .forEach(b => b.hidden = b.dataset.k !== k);
      }
    });

    $$('#langpick button').forEach(b =>
      b.onclick = () => setLang(b.dataset.lang));

    $('#btn-reset').onclick = async () => {
      if (!confirm('清空所有进度、XP 和实验记录?')) return;
      await Store.reset();
      renderHud(); route();
      toast('进度已清空');
    };

    window.addEventListener('hashchange', route);
  }

  /* ---------------------------------------------------------- 启动 */

  async function boot() {
    try {
      const [mf] = await Promise.all([
        fetch('/content/manifest.json').then(r => r.json()),
        Store.load(),
      ]);
      manifest = mf;
      try {
        const t = await fetch('/api/tools').then(r => r.json());
        tools = t.tools || {};
      } catch (_) { tools = {}; }
    } catch (e) {
      $('#boot').innerHTML = `加载失败:${MD.esc(e.message)}<br><br>
        <span style="color:#8b98a8">确认在项目根目录运行 python3 serve.py</span>`;
      return;
    }

    $('#boot').hidden = true;
    $('#shell').hidden = false;
    setLang(lang);
    wire();
    renderHud();
    route();
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', App.boot);
