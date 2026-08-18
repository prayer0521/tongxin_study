/* ============================================================
   diagrams.js —— 可交互 SVG 图示

   每个图是一个函数: fn(hostElement, options) -> void
   自己画 SVG、自己挂按钮。没有依赖任何绘图库。

   设计原则:图要能【动】和【被拨弄】。静态框线图讲不清时序,
   而时序恰恰是网络里最难凭空想象的部分。
   ============================================================ */

const Diagrams = (() => {

  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    line: '#253141', dim: '#667586', fg: '#d5dde7',
    cyan: '#4fc3d9', green: '#56d364', amber: '#e3b341',
    red: '#f47067', violet: '#a98bf5', pink: '#f778ba',
    panel: '#131a23',
  };

  function el(tag, attrs = {}, parent = null) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function svg(w, h, parent) {
    const s = el('svg', {
      viewBox: `0 0 ${w} ${h}`, width: w, height: h,
      style: 'max-width:100%;height:auto',
    }, parent);
    return s;
  }

  function txt(p, x, y, s, o = {}) {
    const t = el('text', {
      x, y, fill: o.fill || C.fg,
      'font-size': o.size || 11,
      'text-anchor': o.anchor || 'start',
      'font-weight': o.weight || 400,
    }, p);
    t.textContent = s;
    return t;
  }

  function box(p, x, y, w, h, label, o = {}) {
    const g = el('g', {}, p);
    el('rect', {
      x, y, width: w, height: h, rx: o.rx || 5,
      fill: o.fill || C.panel,
      stroke: o.stroke || C.line, 'stroke-width': o.sw || 1.2,
    }, g);
    if (label) {
      const lines = String(label).split('\n');
      const lh = o.size ? o.size + 3 : 13;
      const y0 = y + h / 2 - (lines.length - 1) * lh / 2 + (o.size || 11) / 3;
      lines.forEach((l, i) => txt(g, x + w / 2, y0 + i * lh, l, {
        anchor: 'middle', fill: o.tf || C.fg, size: o.size || 11,
        weight: i === 0 ? (o.weight || 500) : 400,
      }));
    }
    return g;
  }

  function arrowDefs(s) {
    const d = el('defs', {}, s);
    [['ar', C.cyan], ['ag', C.green], ['aa', C.amber],
     ['ard', C.red], ['adm', C.dim], ['av', C.violet]].forEach(([id, col]) => {
      const m = el('marker', {
        id, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse',
      }, d);
      el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: col }, m);
    });
    return d;
  }

  /* 控制条 */
  function controls(host, buttons) {
    const bar = document.createElement('div');
    bar.className = 'fig-ctl';
    buttons.forEach(([label, fn, cls]) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || 'ghost');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => fn(b);
      bar.appendChild(b);
    });
    host.appendChild(bar);
    return bar;
  }

  /* ============================================================
     1. TCP 三次握手 / 四次挥手 时序图

     可以逐步播放,并且左右两侧实时显示【状态机状态】。
     状态变化的时机是这张图真正的价值 —— 比如客户端在发出第 3 个
     ACK 时就已经 ESTABLISHED 了,而服务端还要等收到才是。
     ============================================================ */
  function handshake(host, opt = {}) {
    const withClose = opt.close !== false;
    const W = 640, H = withClose ? 500 : 290;
    const xc = 130, xs = 510;

    const steps = [
      { from: 'c', label: 'SYN  seq=x',            cs: 'SYN_SENT',    ss: 'LISTEN' },
      { from: 's', label: 'SYN+ACK  seq=y ack=x+1', cs: 'SYN_SENT',   ss: 'SYN_RCVD' },
      { from: 'c', label: 'ACK  ack=y+1',          cs: 'ESTABLISHED', ss: 'SYN_RCVD' },
      { from: 'x', label: '—— 连接建立,可以传数据 ——', cs: 'ESTABLISHED', ss: 'ESTABLISHED' },
    ];
    if (withClose) steps.push(
      { from: 'c', label: 'FIN',        cs: 'FIN_WAIT_1',  ss: 'ESTABLISHED', note: '主动关闭方' },
      { from: 's', label: 'ACK',        cs: 'FIN_WAIT_2',  ss: 'CLOSE_WAIT' },
      { from: 's', label: 'FIN',        cs: 'FIN_WAIT_2',  ss: 'LAST_ACK', note: 'CLOSE_WAIT 期间服务端还能发数据' },
      { from: 'c', label: 'ACK',        cs: 'TIME_WAIT',   ss: 'CLOSED', note: 'TIME_WAIT 要等 2×MSL ≈ 60s' },
      { from: 'x', label: '—— 60 秒后 ——', cs: 'CLOSED',   ss: 'CLOSED' },
    );

    const s = svg(W, H, host);
    arrowDefs(s);

    // 生命线
    box(s, xc - 62, 8, 124, 26, '客户端', { stroke: C.cyan, tf: C.cyan });
    box(s, xs - 62, 8, 124, 26, '服务端', { stroke: C.green, tf: C.green });
    el('line', { x1: xc, y1: 34, x2: xc, y2: H - 30, stroke: C.line,
                 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, s);
    el('line', { x1: xs, y1: 34, x2: xs, y2: H - 30, stroke: C.line,
                 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, s);

    const stC = txt(s, xc, 50, 'CLOSED', { anchor: 'middle', fill: C.dim, size: 10 });
    const stS = txt(s, xs, 50, 'CLOSED', { anchor: 'middle', fill: C.dim, size: 10 });

    const layer = el('g', {}, s);
    const y0 = 76, dy = (H - 110) / steps.length;
    let at = 0;

    function drawStep(i) {
      const st = steps[i];
      const y = y0 + i * dy + 14;

      if (st.from === 'x') {
        const t = txt(layer, (xc + xs) / 2, y, st.label,
          { anchor: 'middle', fill: C.amber, size: 10.5 });
        t.setAttribute('opacity', 0);
        el('animate', { attributeName: 'opacity', from: 0, to: 1,
                        dur: '.3s', fill: 'freeze' }, t);
      } else {
        const l2r = st.from === 'c';
        const x1 = l2r ? xc + 4 : xs - 4;
        const x2 = l2r ? xs - 8 : xc + 8;
        const col = l2r ? C.cyan : C.green;
        const mk = l2r ? 'ar' : 'ag';

        const ln = el('line', {
          x1, y1: y, x2: x1, y2: y + 16, stroke: col, 'stroke-width': 1.6,
          'marker-end': `url(#${mk})`,
        }, layer);
        el('animate', { attributeName: 'x2', from: x1, to: x2,
                        dur: '.45s', fill: 'freeze' }, ln);
        el('animate', { attributeName: 'y2', from: y, to: y + 16,
                        dur: '.45s', fill: 'freeze' }, ln);

        const t = txt(layer, (xc + xs) / 2, y + (l2r ? -5 : -5), st.label,
          { anchor: 'middle', fill: col, size: 10.5, weight: 500 });
        t.setAttribute('opacity', 0);
        el('animate', { attributeName: 'opacity', from: 0, to: 1,
                        dur: '.4s', begin: '.15s', fill: 'freeze' }, t);

        if (st.note) txt(layer, (xc + xs) / 2, y + 27, st.note,
          { anchor: 'middle', fill: C.dim, size: 9.5 });
      }

      stC.textContent = st.cs; stS.textContent = st.ss;
      stC.setAttribute('fill', st.cs === 'ESTABLISHED' ? C.green
        : st.cs === 'TIME_WAIT' ? C.amber : C.cyan);
      stS.setAttribute('fill', st.ss === 'ESTABLISHED' ? C.green : C.dim);
    }

    function reset() {
      layer.textContent = '';
      at = 0;
      stC.textContent = 'CLOSED'; stS.textContent = 'CLOSED';
      stC.setAttribute('fill', C.dim); stS.setAttribute('fill', C.dim);
    }

    let timer = null;
    controls(host, [
      ['▶ 播放', () => {
        clearInterval(timer); reset();
        timer = setInterval(() => {
          if (at >= steps.length) { clearInterval(timer); return; }
          drawStep(at++);
        }, 750);
      }, 'go'],
      ['下一步', () => { if (at < steps.length) drawStep(at++); }],
      ['重置', () => { clearInterval(timer); reset(); }],
    ]);
  }

  /* ============================================================
     2. 字节流 vs 数据报 —— 粘包可视化

     左边 TCP:5 个方块流进管道后边界消失,变成一条连续色带。
     右边 UDP:5 个方块各自独立到达。
     这是"TCP 是流"这句话最好的解释方式。
     ============================================================ */
  function stream(host) {
    const W = 660, H = 250;
    const s = svg(W, H, host);
    arrowDefs(s);

    const pkts = ['PKT-0', 'PKT-1', 'PKT-2', 'PKT-3', 'PKT-4'];
    const cols = [C.cyan, C.green, C.amber, C.violet, C.pink];

    function lane(y, title, isTcp) {
      const g = el('g', {}, s);
      txt(g, 8, y - 26, title, { fill: isTcp ? C.cyan : C.green, size: 12, weight: 600 });
      txt(g, 8, y - 11, isTcp ? 'send() ×5' : 'sendto() ×5',
        { fill: C.dim, size: 9.5 });

      // 管道
      el('rect', { x: 150, y: y - 6, width: 330, height: 34, rx: 4,
                   fill: '#0a0e14', stroke: C.line }, g);
      txt(g, 315, y + 44, isTcp ? '内核 socket 缓冲区(字节流,无边界)'
                                : '内核(每个数据报独立排队)',
        { anchor: 'middle', fill: C.dim, size: 9 });

      box(g, 500, y - 10, 150, 42,
        isTcp ? 'recv() ×1\n收到 30 字节' : 'recvfrom() ×5\n每次 6 字节',
        { stroke: isTcp ? C.red : C.green, size: 10,
          tf: isTcp ? C.red : C.green });
      return g;
    }

    const yT = 60, yU = 175;
    const gT = lane(yT, 'TCP  SOCK_STREAM', true);
    const gU = lane(yU, 'UDP  SOCK_DGRAM', false);

    function animate() {
      [gT, gU].forEach(g => g.querySelectorAll('.mv').forEach(n => n.remove()));

      pkts.forEach((p, i) => {
        // TCP:进管道后合并成一条带
        const gt = el('g', { class: 'mv' }, gT);
        const r = el('rect', { x: 60, y: yT, width: 56, height: 22, rx: 3,
          fill: cols[i], opacity: .85 }, gt);
        const tl = txt(gt, 88, yT + 15, p, { anchor: 'middle', fill: '#0a0e14', size: 9, weight: 700 });
        [r, tl].forEach(n => {
          const a = el('animateTransform', {
            attributeName: 'transform', type: 'translate',
            from: '0 0', to: `${100 + i * 57} 0`,
            dur: '1.1s', begin: `${i * .12}s`, fill: 'freeze',
          }, n);
        });
        // 到管道里后 label 淡出、方块拉平 —— 边界消失
        el('animate', { attributeName: 'opacity', from: 1, to: 0,
          dur: '.35s', begin: '1.2s', fill: 'freeze' }, tl);
        el('animate', { attributeName: 'height', from: 22, to: 22,
          dur: '.1s', begin: '1.2s', fill: 'freeze' }, r);
        el('animate', { attributeName: 'width', from: 56, to: 57,
          dur: '.3s', begin: '1.25s', fill: 'freeze' }, r);
        el('animate', { attributeName: 'rx', from: 3, to: 0,
          dur: '.3s', begin: '1.25s', fill: 'freeze' }, r);

        // UDP:整包独立飞过去,保持边界
        const gu = el('g', { class: 'mv' }, gU);
        const r2 = el('rect', { x: 60, y: yU, width: 56, height: 22, rx: 3,
          fill: cols[i], opacity: .85 }, gu);
        const t2 = txt(gu, 88, yU + 15, p, { anchor: 'middle', fill: '#0a0e14', size: 9, weight: 700 });
        [r2, t2].forEach(n => el('animateTransform', {
          attributeName: 'transform', type: 'translate',
          from: '0 0', to: '460 0',
          dur: '1.4s', begin: `${i * .22}s`, fill: 'freeze',
        }, n));
      });
    }

    controls(host, [
      ['▶ 发 5 个包', animate, 'go'],
      ['清空', () => [gT, gU].forEach(g =>
        g.querySelectorAll('.mv').forEach(n => n.remove()))],
    ]);
  }

  /* ============================================================
     3. 并发模型对比 —— 时间轴甘特图

     4 个模型处理同样 6 个请求(每个含 20ms IO 等待)。
     直观看到:串行是一条长龙;epoll 单线程却能几乎同时推进 ——
     因为等待 IO 的时间被复用了。
     ============================================================ */
  function concurrency(host) {
    const W = 660, H = 300;
    const s = svg(W, H, host);
    const x0 = 118, xw = 500;
    const N = 6;

    // [模型名, 说明, 每个请求 [起点比例, 长度比例], 颜色]
    const models = [
      ['串行 (accept 循环)', '一个一个来', C.red,
        Array.from({ length: N }, (_, i) => [i / N, 1 / N])],
      ['每连接一进程 fork', '并行,但 fork 很贵', C.amber,
        Array.from({ length: N }, (_, i) => [i * .02, .30 + i * .01])],
      ['每连接一线程', '轻一点,上万就崩', C.violet,
        Array.from({ length: N }, (_, i) => [i * .012, .26 + i * .006])],
      ['epoll 单线程事件循环', '一个线程全包', C.green,
        Array.from({ length: N }, (_, i) => [i * .006, .22])],
    ];

    txt(s, x0, 16, '0ms', { fill: C.dim, size: 9 });
    txt(s, x0 + xw, 16, '→ 时间', { fill: C.dim, size: 9, anchor: 'end' });

    const rows = [];
    models.forEach(([name, sub, col, bars], mi) => {
      const y = 34 + mi * 66;
      txt(s, 8, y + 12, name, { fill: col, size: 11, weight: 600 });
      txt(s, 8, y + 25, sub, { fill: C.dim, size: 9 });
      el('line', { x1: x0, y1: y + 40, x2: x0 + xw, y2: y + 40,
                   stroke: C.line, 'stroke-width': 1 }, s);
      const g = el('g', {}, s);
      rows.push({ g, y, col, bars });
    });

    function play() {
      rows.forEach(r => r.g.textContent = '');
      rows.forEach(({ g, y, col, bars }) => {
        bars.forEach(([st, len], i) => {
          const bx = x0 + st * xw;
          const bw = Math.max(6, len * xw);
          const by = y + 2 + (i % 3) * 11;
          const r = el('rect', {
            x: bx, y: by, width: 0, height: 9, rx: 2,
            fill: col, opacity: .7 + (i % 3) * .1,
          }, g);
          el('animate', { attributeName: 'width', from: 0, to: bw,
            dur: (len * 1.6) + 's', begin: (st * 1.6) + 's', fill: 'freeze' }, r);
        });
        // 总耗时刻度
        const end = Math.max(...bars.map(([st, len]) => st + len));
        const t = txt(g, x0 + end * xw + 6, y + 22,
          Math.round(end * 120) + 'ms', { fill: col, size: 9.5, weight: 600 });
        t.setAttribute('opacity', 0);
        el('animate', { attributeName: 'opacity', from: 0, to: 1,
          dur: '.3s', begin: (end * 1.6) + 's', fill: 'freeze' }, t);
      });
    }

    controls(host, [['▶ 同时处理 6 个请求', play, 'go']]);
    play();
  }

  /* ============================================================
     4. 负载均衡策略沙盘

     可以切换算法、把某个后端"打挂",看请求怎么重新分布。
     每个后端有不同的处理能力 —— 这样才能看出轮询和最少连接的差别。
     ============================================================ */
  function loadbalance(host) {
    const W = 660, H = 320;
    const s = svg(W, H, host);
    arrowDefs(s);

    const algos = ['轮询 RR', '加权轮询 WRR', '最少连接 LC', 'IP 哈希'];
    let algo = 0;

    // 三个后端能力不同:B2 是慢机器
    const backs = [
      { name: 'B1', w: 3, speed: 1.0, up: true, n: 0, load: 0 },
      { name: 'B2', w: 1, speed: 0.34, up: true, n: 0, load: 0 },
      { name: 'B3', w: 2, speed: 0.7, up: true, n: 0, load: 0 },
    ];

    box(s, 14, 130, 84, 40, 'Client', { stroke: C.cyan, tf: C.cyan });
    const lbG = box(s, 158, 122, 104, 56, 'LB', { stroke: C.amber, tf: C.amber, size: 12 });
    const algoT = txt(s, 210, 194, algos[algo], { anchor: 'middle', fill: C.amber, size: 10 });
    el('line', { x1: 100, y1: 150, x2: 152, y2: 150, stroke: C.cyan,
                 'stroke-width': 1.5, 'marker-end': 'url(#ar)' }, s);

    const bg = [];
    backs.forEach((b, i) => {
      const y = 48 + i * 84;
      const g = el('g', {}, s);
      const rect = el('rect', { x: 400, y, width: 118, height: 54, rx: 5,
        fill: C.panel, stroke: C.green, 'stroke-width': 1.3 }, g);
      txt(g, 459, y + 20, b.name, { anchor: 'middle', fill: C.green, size: 12, weight: 600 });
      const cnt = txt(g, 459, y + 36, '0 req', { anchor: 'middle', fill: C.dim, size: 9.5 });
      txt(g, 528, y + 16, `权重 ${b.w}`, { fill: C.dim, size: 9 });
      txt(g, 528, y + 30, b.speed === 1 ? '快' : b.speed > .5 ? '中' : '慢',
        { fill: b.speed > .5 ? C.dim : C.red, size: 9 });
      // 负载条
      el('rect', { x: 400, y: y + 44, width: 118, height: 5, fill: '#1e2833' }, g);
      const bar = el('rect', { x: 400, y: y + 44, width: 0, height: 5, fill: C.green }, g);
      el('line', { x1: 264, y1: 150, x2: 396, y2: y + 27, stroke: C.line,
        'stroke-width': 1.2, 'marker-end': 'url(#adm)' }, s);
      bg.push({ rect, cnt, bar, y });
    });

    let rr = 0, wrrSeq = [], wrrI = 0;
    backs.forEach((b, i) => { for (let k = 0; k < b.w; k++) wrrSeq.push(i); });

    function pick(clientIp) {
      const live = backs.map((b, i) => i).filter(i => backs[i].up);
      if (!live.length) return -1;
      if (algo === 0) { const i = live[rr % live.length]; rr++; return i; }
      if (algo === 1) {
        for (let k = 0; k < wrrSeq.length; k++) {
          const i = wrrSeq[(wrrI + k) % wrrSeq.length];
          if (backs[i].up) { wrrI = (wrrI + k + 1) % wrrSeq.length; return i; }
        }
        return live[0];
      }
      if (algo === 2) return live.reduce((a, b) =>
        backs[a].load <= backs[b].load ? a : b);
      // IP 哈希
      let h = 0;
      for (const ch of clientIp) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return live[h % live.length];
    }

    function redraw() {
      backs.forEach((b, i) => {
        bg[i].cnt.textContent = b.n + ' req';
        bg[i].rect.setAttribute('stroke', b.up ? C.green : C.red);
        bg[i].rect.setAttribute('opacity', b.up ? 1 : .45);
        const max = Math.max(1, ...backs.map(x => x.load));
        bg[i].bar.setAttribute('width', b.up ? Math.min(118, b.load / max * 118) : 0);
        bg[i].bar.setAttribute('fill', b.load / max > .8 ? C.red
          : b.load / max > .5 ? C.amber : C.green);
      });
      algoT.textContent = algos[algo];
    }

    function fire(k = 12) {
      let i = 0;
      const iv = setInterval(() => {
        if (i++ >= k) { clearInterval(iv); return; }
        const ip = '10.0.0.' + (1 + (i % 4));
        const t = pick(ip);
        if (t < 0) return;
        backs[t].n++;
        // 慢机器上负载堆得更快
        backs[t].load += 1 / backs[t].speed;
        // 飞一个点过去
        const dot = el('circle', { cx: 264, cy: 150, r: 4, fill: C.cyan }, s);
        const path = `M264,150 L396,${bg[t].y + 27}`;
        el('animateMotion', { path, dur: '.5s', fill: 'freeze' }, dot);
        el('animate', { attributeName: 'opacity', from: 1, to: 0,
          dur: '.2s', begin: '.45s', fill: 'freeze' }, dot);
        setTimeout(() => dot.remove(), 700);
        // 负载随时间消化
        setTimeout(() => { backs[t].load = Math.max(0, backs[t].load - 1 / backs[t].speed); redraw(); },
          900 / backs[t].speed);
        redraw();
      }, 170);
    }

    controls(host, [
      ['▶ 打 12 个请求', () => fire(12), 'go'],
      ['换算法', b => { algo = (algo + 1) % algos.length; redraw();
                       b.textContent = '换算法 → ' + algos[(algo + 1) % algos.length]; }],
      ['把 B2 打挂', b => {
        backs[1].up = !backs[1].up; backs[1].load = 0; redraw();
        b.textContent = backs[1].up ? '把 B2 打挂' : '把 B2 救活';
      }],
      ['清零', () => { backs.forEach(b => { b.n = 0; b.load = 0; }); redraw(); }],
    ]);
    redraw();
  }

  /* ============================================================
     5. 缓存流程 —— 命中 / 穿透 / 击穿
     ============================================================ */
  function cache(host) {
    const W = 660, H = 250;
    const s = svg(W, H, host);
    arrowDefs(s);

    box(s, 14, 100, 88, 44, 'Client', { stroke: C.cyan, tf: C.cyan });
    box(s, 150, 100, 100, 44, 'App', { stroke: C.fg });
    box(s, 300, 46, 110, 44, 'Redis\n缓存', { stroke: C.red, tf: C.red, size: 10.5 });
    box(s, 300, 158, 110, 44, 'MySQL\n数据库', { stroke: C.violet, tf: C.violet, size: 10.5 });

    el('line', { x1: 104, y1: 122, x2: 146, y2: 122, stroke: C.cyan,
      'stroke-width': 1.4, 'marker-end': 'url(#ar)' }, s);
    el('line', { x1: 252, y1: 112, x2: 296, y2: 76, stroke: C.line,
      'stroke-width': 1.3, 'marker-end': 'url(#adm)' }, s);
    el('line', { x1: 252, y1: 134, x2: 296, y2: 176, stroke: C.line,
      'stroke-width': 1.3, 'marker-end': 'url(#adm)' }, s);
    txt(s, 258, 92, '① 先查缓存', { fill: C.dim, size: 9 });
    txt(s, 256, 156, '② 未命中才查库', { fill: C.dim, size: 9 });
    el('path', { d: 'M 356 154 Q 400 122 356 94', fill: 'none',
      stroke: C.green, 'stroke-width': 1.2, 'stroke-dasharray': '3 3',
      'marker-end': 'url(#ag)' }, s);
    txt(s, 418, 126, '③ 回填', { fill: C.green, size: 9 });

    const stat = txt(s, 14, 226, '', { fill: C.dim, size: 10.5 });
    const hitT = txt(s, 470, 68, '', { fill: C.dim, size: 10 });
    const dbT = txt(s, 470, 180, '', { fill: C.dim, size: 10 });

    let hits = 0, miss = 0, dbq = 0;
    const store = new Set();

    function flash(node, col) {
      const r = node.querySelector('rect');
      const o = r.getAttribute('stroke');
      r.setAttribute('stroke', col); r.setAttribute('stroke-width', 2.4);
      setTimeout(() => { r.setAttribute('stroke', o); r.setAttribute('stroke-width', 1.3); }, 320);
    }

    function req(key, mode) {
      const redis = s.querySelectorAll('g')[2];
      const db = s.querySelectorAll('g')[3];

      if (mode === 'penetrate') {
        // 穿透:查一个数据库里也不存在的 key,缓存永远存不下来
        miss++; dbq++;
        flash(redis, C.amber); setTimeout(() => flash(db, C.red), 300);
      } else if (store.has(key)) {
        hits++; flash(redis, C.green);
      } else {
        miss++; dbq++;
        flash(redis, C.amber);
        setTimeout(() => { flash(db, C.violet); store.add(key); }, 300);
      }
      hitT.textContent = `命中 ${hits}  未命中 ${miss}`;
      dbT.textContent = `落库 ${dbq} 次`;
      const total = hits + miss;
      stat.textContent = total
        ? `命中率 ${(hits / total * 100).toFixed(0)}%   ——  数据库压力被削掉了 ${(hits / total * 100).toFixed(0)}%`
        : '';
    }

    controls(host, [
      ['正常请求 ×10', () => {
        let i = 0;
        const iv = setInterval(() => {
          if (i++ >= 10) return clearInterval(iv);
          req('user:' + (1 + i % 3), 'normal');
        }, 260);
      }, 'go'],
      ['缓存穿透 ×8', () => {
        let i = 0;
        const iv = setInterval(() => {
          if (i++ >= 8) return clearInterval(iv);
          req('user:-' + i, 'penetrate');
        }, 260);
      }],
      ['缓存全部失效', () => { store.clear(); flash(s.querySelectorAll('g')[2], C.red); }],
      ['清零', () => { hits = miss = dbq = 0; store.clear();
                      hitT.textContent = dbT.textContent = stat.textContent = ''; }],
    ]);
  }

  /* ============================================================
     6. 消息队列削峰
     ============================================================ */
  function mq(host) {
    const W = 660, H = 260;
    const s = svg(W, H, host);
    arrowDefs(s);

    box(s, 14, 96, 90, 46, '生产者\n(下单接口)', { stroke: C.cyan, tf: C.cyan, size: 10 });
    // 队列格子
    txt(s, 150, 76, '队列', { fill: C.amber, size: 11, weight: 600 });
    el('rect', { x: 150, y: 88, width: 300, height: 60, rx: 4,
      fill: '#0a0e14', stroke: C.amber, 'stroke-width': 1.3 }, s);
    box(s, 496, 96, 100, 46, '消费者\n固定速率', { stroke: C.green, tf: C.green, size: 10 });

    const depthT = txt(s, 150, 172, '', { fill: C.dim, size: 10.5 });
    const lostT = txt(s, 150, 190, '', { fill: C.red, size: 10.5 });
    const cells = el('g', {}, s);

    const CAP = 24;
    let q = [], lost = 0, consumed = 0, timer = null;

    function redraw() {
      cells.textContent = '';
      q.slice(0, CAP).forEach((_, i) => {
        el('rect', {
          x: 156 + (i % 12) * 24, y: 96 + Math.floor(i / 12) * 24,
          width: 20, height: 20, rx: 2,
          fill: q.length > CAP * .8 ? C.red : q.length > CAP * .5 ? C.amber : C.green,
          opacity: .8,
        }, cells);
      });
      depthT.textContent = `队列深度 ${q.length}/${CAP}   已消费 ${consumed}`;
      lostT.textContent = lost ? `丢弃 ${lost} 条(队列满了)` : '';
    }

    function startConsumer() {
      clearInterval(timer);
      // 消费者速率固定:每 220ms 处理 1 条。这就是"下游的真实能力"
      timer = setInterval(() => {
        if (q.length) { q.shift(); consumed++; redraw(); }
      }, 220);
    }

    controls(host, [
      ['▶ 平峰流量', () => {
        startConsumer();
        let i = 0;
        const iv = setInterval(() => {
          if (i++ >= 10) return clearInterval(iv);
          q.push(1); redraw();
        }, 260);
      }, 'go'],
      ['⚡ 秒杀洪峰 (瞬间 40 条)', () => {
        startConsumer();
        for (let k = 0; k < 40; k++) {
          if (q.length < CAP) q.push(1); else lost++;
        }
        redraw();
      }],
      ['清空', () => { clearInterval(timer); q = []; lost = consumed = 0; redraw(); }],
    ]);
    redraw();
  }

  /* ============================================================
     7. 分层封装动画 —— 一个 HTTP 请求穿过四层

     每下一层就套一个头。这张图是"为什么 ping 通了但端口连不上"
     这类问题的思维基础。
     ============================================================ */
  function layers(host) {
    const W = 660, H = 300;
    const s = svg(W, H, host);
    arrowDefs(s);

    const L = [
      ['应用层', 'HTTP', 'GET /api/orders', C.cyan],
      ['传输层', 'TCP', '端口 → 哪个进程', C.green],
      ['网络层', 'IP', '地址 → 哪台机器', C.amber],
      ['链路层', 'Ethernet', 'MAC → 下一跳网卡', C.violet],
    ];

    L.forEach(([name, proto, why, col], i) => {
      const y = 24 + i * 62;
      txt(s, 8, y + 20, name, { fill: col, size: 11.5, weight: 600 });
      txt(s, 8, y + 34, why, { fill: C.dim, size: 9 });
      el('line', { x1: 0, y1: y + 52, x2: W, y2: y + 52,
        stroke: C.line, 'stroke-dasharray': '2 5' }, s);
    });

    const g = el('g', {}, s);

    function play() {
      g.textContent = '';
      const payload = 'GET /api/orders';
      const heads = [['', ''], ['TCP', C.green], ['IP', C.amber], ['ETH', C.violet]];

      L.forEach((_, i) => {
        const y = 24 + i * 62 + 8;
        const gi = el('g', { opacity: 0 }, g);
        let x = 150;

        // 已经套上的头,从外到内
        for (let h = i; h >= 1; h--) {
          const [nm, col] = heads[h];
          const w = 42;
          el('rect', { x, y, width: w, height: 30, rx: 3,
            fill: 'none', stroke: col, 'stroke-width': 1.3 }, gi);
          txt(gi, x + w / 2, y + 19, nm, { anchor: 'middle', fill: col, size: 9.5, weight: 600 });
          x += w;
        }
        el('rect', { x, y, width: 150, height: 30, rx: 3,
          fill: '#152029', stroke: C.cyan, 'stroke-width': 1.2 }, gi);
        txt(gi, x + 75, y + 19, payload, { anchor: 'middle', fill: C.cyan, size: 9.5 });

        const total = x + 150 - 150;
        txt(gi, 150 + total + 12, y + 19, `${total > 150 ? '+' + (total - 150) + 'B 头' : '原始数据'}`,
          { fill: C.dim, size: 9 });

        el('animate', { attributeName: 'opacity', from: 0, to: 1,
          dur: '.35s', begin: (i * .55) + 's', fill: 'freeze' }, gi);
      });

      const t = txt(g, W / 2, 288, '↓ 每下一层套一个头,这叫【封装】。收端反向拆开。',
        { anchor: 'middle', fill: C.amber, size: 10, weight: 500 });
      t.setAttribute('opacity', 0);
      el('animate', { attributeName: 'opacity', from: 0, to: 1,
        dur: '.4s', begin: '2.4s', fill: 'freeze' }, t);
    }

    controls(host, [['▶ 逐层封装', play, 'go']]);
    play();
  }

  /* ============================================================
     8. 系统架构图 —— 随进度生长(全站核心)

     每个节点标了它在第几关出现。没到的关卡节点是暗的虚线框。
     这张图就是"整个体系"的具体形状:你每通一关,它长出一块。
     ============================================================ */

  const ARCH = {
    nodes: [
      // id,      label,          x,   y,   w,  h, 解锁关卡, 颜色, 说明
      ['browser', '浏览器 / App',   20, 150, 104, 46, 1,  C.cyan,   '前端。发起 HTTP 请求的那一端'],
      ['dns',     'DNS',           20,  64,  104, 34, 6,  C.dim,    '域名 → IP。请求真正的第一步'],
      ['cdn',     'CDN',           20, 226, 104, 34, 8,  C.dim,     '静态资源就近命中,不惊动源站'],

      ['lb',      '负载均衡\nNginx/LVS', 156, 142, 96, 60, 8,  C.amber, '流量入口。四层还是七层?'],
      ['gw',      'API 网关',      156, 226, 96, 38, 14, C.amber,   '认证/限流/路由/灰度 的统一入口'],

      ['app1',    '应用 #1',       288,  92, 90, 40, 4,  C.green,   '你的业务进程。epoll 事件循环'],
      ['app2',    '应用 #2',       288, 140, 90, 40, 8,  C.green,   '加机器横向扩展的第二台'],
      ['app3',    '应用 #3',       288, 188, 90, 40, 8,  C.green,   '无状态,所以可以随便加'],

      ['redis',   'Redis',         418,  56, 96, 44, 10, C.red,     '会话 / 缓存 / 分布式锁 / 计数器'],
      ['mq',      '消息队列\nKafka', 418, 116, 96, 48, 12, C.pink,  '异步解耦 + 削峰 + 重试'],
      ['worker',  '异步 Worker',   556, 116, 92, 40, 12, C.pink,    '慢活儿在这儿干,不占请求线程'],

      ['dbm',     'MySQL 主',      418, 184, 96, 40, 11, C.violet,  '唯一写入点'],
      ['dbs',     'MySQL 从',      418, 232, 96, 40, 11, C.violet,  '读扩展。注意主从延迟'],

      ['obs',     '可观测性\n日志/指标/链路', 556, 190, 92, 56, 14, C.amber, '看不见的系统没法运维'],
    ],
    edges: [
      ['browser', 'dns',  6,  '① 解析域名'],
      ['browser', 'cdn',  8,  '静态资源'],
      ['browser', 'lb',   1,  'HTTP'],
      ['lb',      'app1', 4,  ''],
      ['lb',      'app2', 8,  ''],
      ['lb',      'app3', 8,  ''],
      ['gw',      'lb',  14,  ''],
      ['app1',    'redis', 10, ''],
      ['app2',    'redis', 10, ''],
      ['app1',    'mq',   12, ''],
      ['mq',      'worker', 12, ''],
      ['app2',    'dbm',  11, '写'],
      ['app3',    'dbs',  11, '读'],
      ['dbm',     'dbs',  11, '复制'],
      ['worker',  'dbm',  12, ''],
      ['app3',    'obs',  14, ''],
    ],
  };

  function nodeCenter(n) {
    return [n[2] + n[4] / 2, n[3] + n[5] / 2];
  }

  function architecture(host, opt = {}) {
    const upto = opt.upto || 99;      // 当前解锁到第几关
    const W = 680, H = 292;
    const s = svg(W, H, host);
    arrowDefs(s);

    const byId = {};
    ARCH.nodes.forEach(n => byId[n[0]] = n);

    // 先画边,压在节点下面
    ARCH.edges.forEach(([a, b, lv, label]) => {
      const na = byId[a], nb = byId[b];
      if (!na || !nb) return;
      const on = lv <= upto;
      const [x1, y1] = nodeCenter(na), [x2, y2] = nodeCenter(nb);
      el('line', {
        x1, y1, x2, y2,
        stroke: on ? C.line : '#182028',
        'stroke-width': on ? 1.3 : 1,
        'stroke-dasharray': on ? '' : '2 4',
        'marker-end': on ? 'url(#adm)' : '',
      }, s);
      if (label && on) {
        txt(s, (x1 + x2) / 2, (y1 + y2) / 2 - 4, label,
          { anchor: 'middle', fill: C.dim, size: 8.5 });
      }
    });

    const info = document.createElement('div');
    info.className = 'fig-cap';
    info.textContent = '点节点看它是什么 · 虚线框是还没解锁的部分';

    ARCH.nodes.forEach(n => {
      const [id, label, x, y, w, h, lv, col, desc] = n;
      const on = lv <= upto;
      const g = el('g', { class: 'arch-node' + (on ? '' : ' dim') }, s);
      el('rect', {
        x, y, width: w, height: h, rx: 5,
        fill: on ? C.panel : 'none',
        stroke: on ? col : '#222c38',
        'stroke-width': on ? 1.4 : 1,
        'stroke-dasharray': on ? '' : '3 3',
      }, g);
      const lines = label.split('\n');
      lines.forEach((l, i) => txt(g, x + w / 2,
        y + h / 2 - (lines.length - 1) * 6 + i * 12 + 4, l, {
        anchor: 'middle', fill: on ? col : '#3a4655',
        size: i ? 8.5 : 10.5, weight: i ? 400 : 600,
      }));
      if (!on) txt(g, x + w / 2, y + h + 10, `第 ${lv} 关解锁`,
        { anchor: 'middle', fill: '#3a4655', size: 8 });

      g.onclick = () => {
        info.innerHTML = on
          ? `<b style="color:${col}">${MD.esc(label.replace('\n', ' '))}</b> · ${MD.esc(desc)}`
          : `<span style="color:${C.dim}">${MD.esc(label.replace('\n', ' '))} — 第 ${lv} 关解锁</span>`;
      };
    });

    host.appendChild(info);
  }

  /* ============================================================
     9. 一个请求的完整路径 —— 端到端追踪
     配合架构图,把"前后端互相请求"补完成真实链路。
     ============================================================ */
  function requestpath(host) {
    const W = 660, H = 330;
    const s = svg(W, H, host);
    arrowDefs(s);

    const hops = [
      ['浏览器输入 URL',       '还没有任何网络包', 0],
      ['DNS 查询',            'UDP:53 → 拿到 IP',  12],
      ['TCP 三次握手',         '1 个 RTT 没了',     28],
      ['TLS 握手',            '再 1~2 个 RTT',     45],
      ['LB 转发',             '选一台后端',        68],
      ['应用处理',            '查 Redis / MySQL',  82],
      ['响应回传',            '字节流往回走',      118],
      ['浏览器渲染',          '首屏出现',          132],
    ];

    const x0 = 40, xw = 560;
    el('line', { x1: x0, y1: 60, x2: x0 + xw, y2: 60, stroke: C.line }, s);
    txt(s, x0, 40, '时间 →', { fill: C.dim, size: 10 });
    txt(s, x0 + xw, 40, '≈ 140ms', { fill: C.amber, size: 10, anchor: 'end' });

    const g = el('g', {}, s);

    function play() {
      g.textContent = '';
      hops.forEach(([name, sub, ms], i) => {
        const x = x0 + (ms / 140) * xw;
        const up = i % 2 === 0;
        const y = up ? 60 - 12 : 60 + 12;
        const ty = up ? 60 - 22 - (i % 4) * 13 : 60 + 30 + (i % 4) * 13;

        const gi = el('g', { opacity: 0 }, g);
        el('circle', { cx: x, cy: 60, r: 4.5, fill: C.cyan }, gi);
        el('line', { x1: x, y1: y, x2: x, y2: ty + (up ? 4 : -9),
          stroke: C.line, 'stroke-width': 1 }, gi);
        txt(gi, x + 5, ty, name, { fill: C.fg, size: 10, weight: 500 });
        txt(gi, x + 5, ty + 12, sub, { fill: C.dim, size: 9 });
        txt(gi, x, up ? 78 : 52, ms + 'ms',
          { anchor: 'middle', fill: C.amber, size: 8.5 });

        el('animate', { attributeName: 'opacity', from: 0, to: 1,
          dur: '.3s', begin: (i * .42) + 's', fill: 'freeze' }, gi);
      });

      const note = txt(g, W / 2, 312,
        '注意:真正"你的代码在跑"的只有【应用处理】那一段。其余都是网络和协议开销。',
        { anchor: 'middle', fill: C.green, size: 9.5 });
      note.setAttribute('opacity', 0);
      el('animate', { attributeName: 'opacity', from: 0, to: 1,
        dur: '.4s', begin: '3.5s', fill: 'freeze' }, note);
    }

    controls(host, [['▶ 走一遍', play, 'go']]);
    play();
  }

  /* ============================================================
     10. CAP / 一致性:主从延迟造成的读到旧数据
     ============================================================ */
  function replication(host) {
    const W = 660, H = 240;
    const s = svg(W, H, host);
    arrowDefs(s);

    box(s, 14, 40, 92, 40, '用户 A\n写', { stroke: C.cyan, tf: C.cyan, size: 10 });
    box(s, 14, 150, 92, 40, '用户 B\n读', { stroke: C.green, tf: C.green, size: 10 });
    box(s, 250, 40, 110, 44, 'MySQL 主', { stroke: C.violet, tf: C.violet });
    box(s, 250, 148, 110, 44, 'MySQL 从', { stroke: C.violet, tf: C.violet });
    el('line', { x1: 305, y1: 88, x2: 305, y2: 144, stroke: C.line,
      'stroke-width': 1.4, 'stroke-dasharray': '4 3', 'marker-end': 'url(#adm)' }, s);
    txt(s, 314, 120, 'binlog 复制', { fill: C.dim, size: 9 });

    const lag = txt(s, 314, 134, '延迟 ~800ms', { fill: C.amber, size: 9 });
    const val1 = txt(s, 480, 66, 'balance = 100', { fill: C.dim, size: 11 });
    const val2 = txt(s, 480, 174, 'balance = 100', { fill: C.dim, size: 11 });
    const log = txt(s, 14, 222, '', { fill: C.dim, size: 10 });

    function scene() {
      val1.textContent = 'balance = 100'; val2.textContent = 'balance = 100';
      val1.setAttribute('fill', C.dim); val2.setAttribute('fill', C.dim);
      log.textContent = '';

      const d1 = el('circle', { cx: 110, cy: 60, r: 4, fill: C.cyan }, s);
      el('animateMotion', { path: 'M110,60 L246,62', dur: '.5s', fill: 'freeze' }, d1);

      setTimeout(() => {
        d1.remove();
        val1.textContent = 'balance = 500'; val1.setAttribute('fill', C.green);
        log.textContent = 'A 写入成功,主库已经是 500';
      }, 520);

      setTimeout(() => {
        const d2 = el('circle', { cx: 110, cy: 170, r: 4, fill: C.green }, s);
        el('animateMotion', { path: 'M110,170 L246,170', dur: '.4s', fill: 'freeze' }, d2);
        setTimeout(() => {
          d2.remove();
          val2.setAttribute('fill', C.red);
          log.textContent = '⚠ B 这时读从库,拿到的还是 100 —— 用户会说"我明明改了啊"';
        }, 420);
      }, 900);

      setTimeout(() => {
        const d3 = el('circle', { cx: 305, cy: 92, r: 4, fill: C.violet }, s);
        el('animateMotion', { path: 'M305,92 L305,142', dur: '.5s', fill: 'freeze' }, d3);
        setTimeout(() => {
          d3.remove();
          val2.textContent = 'balance = 500'; val2.setAttribute('fill', C.green);
          log.textContent = '复制追上了,现在两边一致。这就是【最终一致】。';
        }, 520);
      }, 1900);
    }

    controls(host, [
      ['▶ 演一遍主从延迟', scene, 'go'],
      ['延迟拉到 5 秒', b => {
        lag.textContent = lag.textContent.includes('800') ? '延迟 ~5s(主库压力大)' : '延迟 ~800ms';
        lag.setAttribute('fill', lag.textContent.includes('5s') ? C.red : C.amber);
      }],
    ]);
  }

  return {
    handshake, stream, concurrency, loadbalance, cache, mq,
    layers, architecture, requestpath, replication,
    ARCH,
  };
})();
