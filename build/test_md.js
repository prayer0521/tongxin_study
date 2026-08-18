// 渲染器自测。跑法: node build/test_md.js
// 重点验证:行内代码占位符不会和正文里的独立数字冲突。
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../site/js/md.js', 'utf8');
const MD = eval(src + '; MD');

let fail = 0;
function eq(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) {
    console.log('   got : ' + JSON.stringify(got));
    console.log('   want: ' + JSON.stringify(want));
  }
}

// 1. 基础
eq('bold', MD.inline('a **b** c'), 'a <strong>b</strong> c');
eq('code', MD.inline('a `b` c'), 'a <code>b</code> c');
eq('link', MD.inline('[x](#/arch)'), '<a href="#/arch">x</a>');

// 2. 关键:正文里有独立数字 + 行内代码,数字必须保持原样
eq('digit+code 1', MD.inline('x 0 y `c` z'), 'x 0 y <code>c</code> z');
eq('digit+code 2', MD.inline('backlog 是 2 时 `listen` 如何'),
   'backlog 是 2 时 <code>listen</code> 如何');
eq('digit+code 3', MD.inline('`a` 和 `b` 和 1 和 0'),
   '<code>a</code> 和 <code>b</code> 和 1 和 0');
eq('two codes', MD.inline('`x` mid `y`'), '<code>x</code> mid <code>y</code>');
eq('code adjacent digits', MD.inline('值 0 `f()` 值 1'),
   '值 0 <code>f()</code> 值 1');

// 3. 转义(内容先被 esc 过,但确认不会二次解析出标签)
eq('escaped html', MD.render('<b>x</b>'), '<p>&lt;b&gt;x&lt;/b&gt;</p>');

// 4. 块级
eq('ul', MD.render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
eq('h3', MD.render('### T'), '<h3 class="sub3">T</h3>');

console.log(fail ? `\n${fail} 个失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
