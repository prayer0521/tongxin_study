/* ============================================================
   md.js —— 极简 markdown 子集 + 语法高亮

   只支持内容文件里实际用到的语法,不追求完整:
     **粗体**  `行内代码`  [文字](链接)
     - 列表    1. 有序    > 引用
     ### 小标题
     | 表格 |
   刻意不支持 HTML 内联 —— 所有内容先转义,杜绝注入。
   ============================================================ */

const MD = (() => {

  // 行内代码占位符。用私用区码点，正文里不会出现，
  // 所以不会和正文里的独立数字冲突。
  const SENT = '\uE000';
  const SENT_RE = /\uE000(\d+)\uE000/g;

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- 行内元素。输入必须是【已转义】的文本 ---- */
  function inline(s) {
    // 先把行内代码抠出来占位,避免里面的 * _ 被当成格式符
    const stash = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => {
      stash.push('<code>' + c + '</code>');
      return SENT + (stash.length - 1) + SENT;
    });

    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, t, u) => /^(https?:|#|\/)/.test(u) ? `<a href="${u}">${t}</a>` : t);
    s = s.replace(/ -&gt; /g, ' → ');

    return s.replace(SENT_RE, (_, i) => stash[+i]);
  }

  /* ---- 块级 ---- */
  function render(src) {
    if (!src) return '';
    const lines = String(src).replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trim();

      if (!line) { i++; continue; }

      // 表格: | a | b |  紧跟 |---|---|
      if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) {
        const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(cells(lines[i])); i++;
        }
        out.push('<div class="tbl-wrap"><table><thead><tr>' +
          head.map(h => '<th>' + inline(esc(h)) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + inline(esc(c)) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }

      // 标题
      let m = /^(#{3,4})\s+(.*)$/.exec(line);
      if (m) {
        out.push('<h3 class="sub3">' + inline(esc(m[2])) + '</h3>');
        i++; continue;
      }

      // 无序列表
      if (/^[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++;
        }
        out.push('<ul>' + items.map(t => '<li>' + inline(esc(t)) + '</li>').join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++;
        }
        out.push('<ol>' + items.map(t => '<li>' + inline(esc(t)) + '</li>').join('') + '</ol>');
        continue;
      }

      // 引用
      if (line.startsWith('&gt;') || line.startsWith('>')) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, '')); i++;
        }
        out.push('<div class="note"><p>' + inline(esc(buf.join(' '))) + '</p></div>');
        continue;
      }

      // 段落:连续非空行合成一段
      const buf = [];
      while (i < lines.length && lines[i].trim() &&
             !/^([-*]\s|\d+[.)]\s|#{3,4}\s|\||>)/.test(lines[i].trim())) {
        buf.push(lines[i].trim()); i++;
      }
      out.push('<p>' + inline(esc(buf.join(' '))) + '</p>');
    }

    return out.join('\n');
  }

  /* ============================================================
     语法高亮

     手写的小型 tokenizer。不是编译器,目标是"读起来舒服"。
     做法:一次正则扫描,按优先级(注释 > 字符串 > 数字 > 关键字)分段,
     绝不在已经生成的 HTML 标签内部再做替换 —— 那是高亮器最常见的 bug。
     ============================================================ */

  const KW = {
    c: `auto break case char const continue default do double else enum extern
        float for goto if inline int long register restrict return short signed
        sizeof static struct switch typedef union unsigned void volatile while
        _Atomic _Bool`,
    cpp: `alignas alignof asm auto bool break case catch char class co_await
        co_return co_yield concept const consteval constexpr const_cast continue
        decltype default delete do double dynamic_cast else enum explicit export
        extern false float for friend goto if inline int long mutable namespace
        new noexcept nullptr operator private protected public register
        reinterpret_cast requires return short signed sizeof static static_assert
        static_cast struct switch template this thread_local throw true try
        typedef typeid typename union unsigned using virtual void volatile while`,
    py: `and as assert async await break class continue def del elif else except
        False finally for from global if import in is lambda None nonlocal not or
        pass raise return True try while with yield match case self`,
    go: `break case chan const continue default defer else fallthrough for func
        go goto if import interface map package range return select struct switch
        type var nil true false make new len cap append copy delete panic recover
        string int int8 int16 int32 int64 uint uint8 byte rune float64 bool error
        any`,
    bash: `if then else elif fi for while do done case esac in function return
        local export echo exit set unset trap read shift break continue sleep
        source declare`,
  };

  function kwSet(lang) {
    const key = ({ cpp: 'cpp', c: 'c', py: 'py', python: 'py', go: 'go',
                   bash: 'bash', sh: 'bash' })[lang] || null;
    if (!key) return null;
    return new Set(KW[key].split(/\s+/).filter(Boolean));
  }

  /* 语言对应的注释/字符串规则 */
  function rulesFor(lang) {
    const l = ({ python: 'py', sh: 'bash' })[lang] || lang;
    if (l === 'py') {
      return [
        [/^(?:'''|""")[\s\S]*?(?:'''|""")/, 't-com'],   // 文档字符串
        [/^#[^\n]*/, 't-com'],
        [/^f?(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/, 't-str'],
      ];
    }
    if (l === 'bash') {
      return [
        [/^#[^\n]*/, 't-com'],
        [/^(?:"(?:[^"\\]|\\.)*"|'[^']*')/, 't-str'],
        [/^\$\{?\w+\}?/, 't-num'],
      ];
    }
    if (l === 'go') {
      return [
        [/^\/\/[^\n]*/, 't-com'],
        [/^\/\*[\s\S]*?\*\//, 't-com'],
        [/^(?:"(?:[^"\\\n]|\\.)*"|`[^`]*`|'(?:[^'\\]|\\.)')/, 't-str'],
      ];
    }
    if (l === 'c' || l === 'cpp') {
      return [
        [/^\/\/[^\n]*/, 't-com'],
        [/^\/\*[\s\S]*?\*\//, 't-com'],
        [/^#\s*\w+/, 't-pre'],
        [/^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\]|\\.)')/, 't-str'],
      ];
    }
    // json / yaml / http / 其他
    if (l === 'json' || l === 'yaml' || l === 'yml' || l === 'conf' || l === 'nginx') {
      return [
        [/^#[^\n]*/, 't-com'],
        [/^"(?:[^"\\\n]|\\.)*"/, 't-str'],
      ];
    }
    return [];
  }

  function highlight(code, lang) {
    const kws = kwSet(lang);
    const rules = rulesFor(lang);
    if (!kws && !rules.length) return esc(code);

    let s = code, out = '';

    while (s.length) {
      let matched = false;

      for (const [re, cls] of rules) {
        const m = re.exec(s);
        if (m && m.index === 0) {
          out += `<span class="${cls}">${esc(m[0])}</span>`;
          s = s.slice(m[0].length);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 标识符 / 数字 / 其他
      let m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s);
      if (m) {
        const w = m[0];
        const after = s.slice(w.length);
        if (kws && kws.has(w)) {
          out += `<span class="t-key">${w}</span>`;
        } else if (/^\s*\(/.test(after)) {
          out += `<span class="t-fn">${w}</span>`;
        } else if (/^[A-Z][A-Za-z0-9_]*$/.test(w) && w.length > 2) {
          out += `<span class="t-typ">${w}</span>`;   // 常量/类型
        } else {
          out += esc(w);
        }
        s = s.slice(w.length);
        continue;
      }

      m = /^0[xX][0-9a-fA-F]+|^\d+\.?\d*/.exec(s);
      if (m) {
        out += `<span class="t-num">${m[0]}</span>`;
        s = s.slice(m[0].length);
        continue;
      }

      out += esc(s[0]);
      s = s.slice(1);
    }
    return out;
  }

  /* 代码块 HTML。kind: 'code' | 'term' */
  function codeBlock(code, opt = {}) {
    const { lang = 'text', file = '', label = '', kind = 'code' } = opt;
    const head = (file || label)
      ? `<div class="code-head">${file ? `<span class="fname">${esc(file)}</span>` : ''}` +
        `${label ? `<span class="tagl">${esc(label)}</span>` : ''}</div>`
      : '';
    return `<div class="code ${kind === 'term' ? 'term' : ''} ${head ? '' : 'bare'}">` +
      head +
      `<pre><code>${kind === 'term' ? esc(code) : highlight(code, lang)}</code></pre>` +
      `</div>`;
  }

  return { render, inline, esc, highlight, codeBlock };
})();
