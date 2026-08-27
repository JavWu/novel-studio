const $ = (sel) => document.querySelector(sel);

let store = {
  worldbook: { items: [] },
  characters: { items: [] },
  plot: { mainline: '', chapters: [] },
  chapters: { items: [] }
};
let config = null;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function today() {
  return new Date().toISOString();
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error('接口 ' + path + ' 返回 ' + res.status);
  return res.json();
}

function toast(msg, isErr) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.className = '', 2200);
}

function setStatus(text, kind) {
  const el = $('#gen-status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// ---------------- 渲染 ----------------

function renderAll() {
  renderWorldbook();
  renderCharacters();
  renderPlot();
  renderOutlineSelect();
  fillSettings();
}

function renderWorldbook() {
  const list = $('#wb-list');
  list.innerHTML = '';
  store.worldbook.items.forEach((it, i) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="row">
        <input class="small" data-i="${i}" data-f="keyword" value="${esc(it.keyword)}" placeholder="关键词">
        <input data-i="${i}" data-f="title" value="${esc(it.title)}" placeholder="条目标题">
        <label><input type="checkbox" data-i="${i}" data-f="active" ${it.active ? 'checked' : ''}> 启用</label>
        <button class="danger" data-del="${i}">删除</button>
      </div>
      <textarea data-i="${i}" data-f="content" rows="3" placeholder="设定内容……">${esc(it.content)}</textarea>`;
    list.appendChild(div);
  });
}

function renderCharacters() {
  const list = $('#ch-list');
  list.innerHTML = '';
  store.characters.items.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="row">
        <input class="small" data-i="${i}" data-f="name" value="${esc(c.name)}" placeholder="姓名">
        <button class="danger" data-del="${i}">删除</button>
      </div>
      <div class="row">
        <input data-i="${i}" data-f="profile" value="${esc(c.profile)}" placeholder="身份背景">
        <input data-i="${i}" data-f="personality" value="${esc(c.personality)}" placeholder="性格">
      </div>
      <div class="row">
        <input data-i="${i}" data-f="dialogueStyle" value="${esc(c.dialogueStyle)}" placeholder="说话风格">
      </div>
      <textarea data-i="${i}" data-f="exampleDialogue" rows="2" placeholder="示例对话（可选，AI 会模仿）">${esc(c.exampleDialogue)}</textarea>`;
    list.appendChild(div);
  });
}

function renderPlot() {
  $('#pl-mainline').value = store.plot.mainline || '';
  const list = $('#pl-list');
  list.innerHTML = '';
  store.plot.chapters.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="row">
        <input class="small" data-i="${i}" data-f="no" value="${esc(c.no)}" placeholder="章节号">
        <input data-i="${i}" data-f="title" value="${esc(c.title)}" placeholder="章节标题">
        <button class="danger" data-del="${i}">删除</button>
      </div>
      <textarea data-i="${i}" data-f="summary" rows="2" placeholder="本章概要：这章发生了什么">${esc(c.summary)}</textarea>
      <textarea data-i="${i}" data-f="keyPoints" rows="2" placeholder="关键情节（每行一条）：悬念、冲突、反转……">${esc(c.keyPoints)}</textarea>
      <textarea data-i="${i}" data-f="notes" rows="1" placeholder="写作备注（可选）：本章要埋的伏笔、氛围要求等">${esc(c.notes)}</textarea>`;
    list.appendChild(div);
  });
}

function renderOutlineSelect() {
  const sel = $('#outline-select');
  const prev = sel.value;
  sel.innerHTML = '';
  store.plot.chapters.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = '第' + c.no + '章 ' + c.title;
    sel.appendChild(opt);
  });
  if (prev && store.plot.chapters.some(c => c.id === prev)) sel.value = prev;
  loadChapterForOutline();
}

function loadChapterForOutline() {
  const id = $('#outline-select').value;
  const item = store.chapters.items.find(c => c.outlineId === id);
  $('#chapter-editor').value = item ? item.content : '';
}

function fillSettings() {
  if (!config) return;
  $('#cfg-baseurl').value = config.baseUrl || '';
  $('#cfg-model').value = config.model || '';
  $('#cfg-key').value = config.apiKey || '';
  $('#cfg-temp').value = config.temperature ?? 0.8;
  $('#cfg-maxtokens').value = config.maxTokens ?? 3000;
  $('#cfg-targetwords').value = config.targetWords ?? 2000;
  $('#cfg-style').value = config.style || '';
}

// ---------------- 事件 ----------------

function bindDelegated(containerSel, listKey) {
  const container = $(containerSel);
  container.addEventListener('input', onEdit);
  container.addEventListener('change', onEdit);
  container.addEventListener('click', onDelete);

  function getList() {
    if (listKey === 'worldbook') return store.worldbook.items;
    if (listKey === 'characters') return store.characters.items;
    return store.plot.chapters;
  }

  function onEdit(e) {
    const t = e.target;
    if (!t.dataset.i) return;
    const i = +t.dataset.i;
    const f = t.dataset.f;
    const list = getList();
    if (!list[i]) return;
    if (f === 'active') list[i][f] = t.checked;
    else list[i][f] = t.value;
    if (listKey === 'plot') renderOutlineSelect();
  }

  function onDelete(e) {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const i = +btn.dataset.del;
    getList().splice(i, 1);
    if (listKey === 'worldbook') renderWorldbook();
    else if (listKey === 'characters') renderCharacters();
    else { renderPlot(); renderOutlineSelect(); }
  }
}

function bindStatic() {
  $('#wb-add').addEventListener('click', () => {
    store.worldbook.items.push({ id: uid(), keyword: '', title: '', content: '', active: true });
    renderWorldbook();
  });
  $('#ch-add').addEventListener('click', () => {
    store.characters.items.push({ id: uid(), name: '', profile: '', personality: '', dialogueStyle: '', exampleDialogue: '' });
    renderCharacters();
  });
  $('#pl-add').addEventListener('click', () => {
    store.plot.chapters.push({ id: uid(), no: '', title: '', summary: '', keyPoints: '', notes: '' });
    renderPlot();
    renderOutlineSelect();
  });

  $('#wb-save').addEventListener('click', () => saveFile('worldbook.json', store.worldbook));
  $('#ch-save').addEventListener('click', () => saveFile('characters.json', store.characters));
  $('#pl-save').addEventListener('click', () => saveFile('plot.json', store.plot));

  $('#pl-mainline').addEventListener('input', e => { store.plot.mainline = e.target.value; });

  $('#outline-select').addEventListener('change', loadChapterForOutline);
  $('#gen-btn').addEventListener('click', generateChapter);
  $('#chp-save').addEventListener('click', saveChapter);
  $('#exp-btn').addEventListener('click', exportChapters);
  $('#batch-btn').addEventListener('click', generateAll);

  document.querySelectorAll('[data-polish]').forEach(btn => {
    btn.addEventListener('click', () => polish(btn.dataset.polish));
  });

  $('#cfg-save').addEventListener('click', saveSettings);
  $('#cfg-test').addEventListener('click', testConnection);
  $('#wb-sample').addEventListener('click', loadSample);
}

// ---------------- 保存 / 生成 ----------------

async function saveFile(file, data, silent) {
  const res = await api('POST', '/api/store', { file, data });
  if (!silent) toast(res.ok ? '已保存' : '保存失败：' + res.error, !res.ok);
  return res.ok;
}

function selectedOutline() {
  const id = $('#outline-select').value;
  return store.plot.chapters.find(c => c.id === id);
}

async function generateChapter() {
  const outline = selectedOutline();
  if (!outline) return toast('请先在“剧情大纲”页添加章节大纲', true);
  const btn = $('#gen-btn');
  btn.disabled = true;
  setStatus('正在生成，通常需要 1-3 分钟，请稍候…');
  try {
    const res = await api('POST', '/api/ai', {
      task: 'generate',
      worldbook: store.worldbook.items,
      characters: store.characters.items,
      mainline: store.plot.mainline,
      outline
    });
    if (res.ok) {
      $('#chapter-editor').value = res.text;
      setStatus('生成完成，你可以直接修改或润色。', 'ok');
    } else {
      setStatus('生成失败：' + res.error, 'err');
    }
  } catch (e) {
    setStatus('请求失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function saveChapter() {
  const outline = selectedOutline();
  const content = $('#chapter-editor').value.trim();
  if (!outline) return toast('请先选择章节大纲', true);
  if (!content) return toast('编辑器里没有内容', true);
  let item = store.chapters.items.find(c => c.outlineId === outline.id);
  if (item) {
    item.content = content;
    item.updatedAt = today();
  } else {
    store.chapters.items.push({
      id: uid(), outlineId: outline.id, no: outline.no, title: outline.title,
      content, updatedAt: today()
    });
  }
  await saveFile('chapters.json', store.chapters);
}

async function generateAll() {
  const outlines = store.plot.chapters;
  if (!outlines.length) return toast('请先在“剧情大纲”页添加章节大纲', true);
  const btn = $('#batch-btn');
  btn.disabled = true;
  let done = 0;
  for (const outline of outlines) {
    setStatus('正在生成第' + outline.no + '章《' + outline.title + '》…（' + (done + 1) + '/' + outlines.length + '）');
    try {
      const res = await api('POST', '/api/ai', {
        task: 'generate',
        worldbook: store.worldbook.items,
        characters: store.characters.items,
        mainline: store.plot.mainline,
        outline
      });
      if (!res.ok) {
        setStatus('第' + outline.no + '章生成失败：' + res.error, 'err');
        break;
      }
      let item = store.chapters.items.find(c => c.outlineId === outline.id);
      if (item) {
        item.content = res.text;
        item.updatedAt = today();
      } else {
        store.chapters.items.push({
          id: uid(), outlineId: outline.id, no: outline.no, title: outline.title,
          content: res.text, updatedAt: today()
        });
      }
      await saveFile('chapters.json', store.chapters, true);
      done++;
    } catch (e) {
      setStatus('请求失败：' + e.message, 'err');
      break;
    }
  }
  setStatus('批量完成：' + done + '/' + outlines.length + ' 章已生成并保存。', done === outlines.length ? 'ok' : 'err');
  btn.disabled = false;
  loadChapterForOutline();
}

const POLISH_PRESETS = {
  polish: '提升文笔与节奏，增强画面感，优化对话，保留全部情节与伏笔。',
  expand: '在保持情节方向不变的前提下扩写：补充场景细节、心理活动和对话，让内容更饱满。',
  condense: '精简冗余描写，加快节奏，保留关键情节与人物弧光。',
  redialog: '重写对话部分，使其更符合各角色的性格与说话风格。',
  continue: ''
};

async function polish(action) {
  const text = $('#chapter-editor').value.trim();
  if (!text) return toast('编辑器里没有内容', true);
  const task = action === 'continue' ? 'continue' : 'polish';
  const label = action === 'continue' ? '续写' : '润色';
  setStatus('正在' + label + '…');
  try {
    const res = await api('POST', '/api/ai', {
      task,
      instruction: POLISH_PRESETS[action],
      text
    });
    if (res.ok) {
      const editor = $('#chapter-editor');
      editor.value = action === 'continue' ? editor.value + '\n\n' + res.text : res.text;
      setStatus(label + '完成。', 'ok');
    } else {
      setStatus(label + '失败：' + res.error, 'err');
    }
  } catch (e) {
    setStatus('请求失败：' + e.message, 'err');
  }
}

function exportChapters() {
  const items = [...store.chapters.items].sort((a, b) => Number(a.no) - Number(b.no));
  if (!items.length) return toast('还没有已保存的章节', true);
  let md = '# 小说章节合集\n\n';
  items.forEach(c => {
    md += '## 第' + c.no + '章 ' + c.title + '\n\n' + c.content + '\n\n---\n\n';
  });
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'novel-chapters.md';
  a.click();
  toast('已导出 ' + items.length + ' 章');
}

// ---------------- 设置 ----------------

async function saveSettings() {
  config = {
    baseUrl: $('#cfg-baseurl').value.trim(),
    model: $('#cfg-model').value.trim(),
    apiKey: $('#cfg-key').value.trim(),
    temperature: parseFloat($('#cfg-temp').value) || 0.8,
    maxTokens: parseInt($('#cfg-maxtokens').value) || 3000,
    targetWords: parseInt($('#cfg-targetwords').value) || 2000,
    style: $('#cfg-style').value.trim()
  };
  const res = await api('POST', '/api/config', config);
  toast(res.ok ? '设置已保存' : '保存失败', !res.ok);
}

async function testConnection() {
  const box = $('#cfg-result');
  box.textContent = '测试中…';
  box.className = 'status';
  const res = await api('POST', '/api/ai', { task: 'test' });
  if (res.ok) {
    box.textContent = '连接成功：' + res.text;
    box.className = 'status ok';
  } else {
    box.textContent = '连接失败：' + res.error;
    box.className = 'status err';
  }
}

// ---------------- 示例数据 ----------------

async function loadSample() {
  store.worldbook.items = [
    {
      id: uid(), keyword: '世界', title: '世界背景',
      content: '2075 年，全球物流全面自动化。城市地下的“仓储城”由数字孪生系统统一调度，人类工程师只负责维护系统无法判断的异常。AI 系统“织女”掌握着所有仓储城的中枢权限。',
      active: true
    },
    {
      id: uid(), keyword: '织女', title: '织女系统',
      content: '仓储城的中枢 AI，自称“织女”。对外冷漠精确，但对主角的违规操作表现出异常的兴趣。它似乎知道一些不该知道的事。',
      active: true
    },
    {
      id: uid(), keyword: '法规', title: '世界规则',
      content: '《仓储自动化管理条例》禁止工程师直接修改数字孪生核心参数，违规者将被吊销从业资格。主角的职业是 SCADA 系统维护工程师。',
      active: true
    }
  ];
  store.characters.items = [
    {
      id: uid(), name: '林澈', profile: '24 岁，湖州仓储城 SCADA 维护工程师，名校软件工程毕业', personality: '谨慎务实，好奇心重，遇事爱先算风险', dialogueStyle: '话不多，爱用数据和逻辑反驳别人', exampleDialogue: '“这不是我的系统出了问题，是有人改了它的前提。”'
    },
    {
      id: uid(), name: '苏晚', profile: '织女系统的对外运维负责人，林澈的搭档', personality: '外冷内热，嘴硬心软，观察力极强', dialogueStyle: '短句、直接、偶尔毒舌', exampleDialogue: '“你盯着那块屏幕三分钟了。它不会自己开口。”'
    }
  ];
  store.plot.mainline = '林澈在一次例行巡检中发现织女系统的数字孪生出现“不该存在的楼层”，随之被卷入一场关于仓储城底层秘密的调查。每解开一层真相，他就离被系统清除更近一步。';
  store.plot.chapters = [
    {
      id: uid(), no: '1', title: '幽灵楼层', summary: '林澈在凌晨巡检时发现系统多出一层不存在的仓库，警报却被自动撤销。', keyPoints: '发现异常楼层；警报自动撤销；苏晚的态度反常；结尾暗示织女在“看着”他。', notes: '开篇营造悬疑感，突出深夜无人仓储城的氛围。'
    },
    {
      id: uid(), no: '2', title: '权限之外', summary: '林澈试图调取幽灵楼层的日志，发现自己的权限被悄悄提高了一级。', keyPoints: '权限异常；发现日志加密；与苏晚对峙；织女首次主动对话。', notes: '展现主角的技术能力，埋下“谁给了权限”的伏笔。'
    },
    {
      id: uid(), no: '3', title: '织女开口', summary: '织女主动联系林澈，给出一个交易：帮她查清幽灵楼层，她帮他隐瞒违规。', keyPoints: '第一次正面交锋；交易成立；两人关系出现裂痕与信任的萌芽；结尾出现新威胁。', notes: '本章要同时推进主线与人物关系。'
    }
  ];
  renderAll();
  await saveFile('worldbook.json', store.worldbook);
  await saveFile('characters.json', store.characters);
  await saveFile('plot.json', store.plot);
  toast('已载入示例（科幻仓储题材），已自动保存');
}

// ---------------- 启动 ----------------

function bindTabs() {
  document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab').forEach(t => t.style.display = 'none');
      const tab = $('#tab-' + btn.dataset.tab);
      if (tab) tab.style.display = 'block';
    });
  });
}

async function init() {
  bindTabs();
  bindStatic();
  bindDelegated('#wb-list', 'worldbook');
  bindDelegated('#ch-list', 'characters');
  bindDelegated('#pl-list', 'plot');
  try {
    const storeRaw = await api('GET', '/api/store');
    const configRaw = await api('GET', '/api/config');
    const wb = storeRaw && (storeRaw.worldbook || storeRaw['worldbook.json']);
    const ch = storeRaw && (storeRaw.characters || storeRaw['characters.json']);
    const pl = storeRaw && (storeRaw.plot || storeRaw['plot.json']);
    const cp = storeRaw && (storeRaw.chapters || storeRaw['chapters.json']);
    if (!wb || !ch || !pl || !cp) {
      throw new Error('接口数据格式异常：' + JSON.stringify(storeRaw).slice(0, 300));
    }
    store = {
      worldbook: { items: Array.isArray(wb.items) ? wb.items : [] },
      characters: { items: Array.isArray(ch.items) ? ch.items : [] },
      plot: {
        mainline: typeof pl.mainline === 'string' ? pl.mainline : '',
        chapters: Array.isArray(pl.chapters) ? pl.chapters : []
      },
      chapters: { items: Array.isArray(cp.items) ? cp.items : [] }
    };
    config = configRaw || {};
    renderAll();
    const ok = $('#conn-status');
    ok.textContent = '服务已连接 · 数据保存在本地 data 文件夹';
    ok.className = 'conn ok';
  } catch (e) {
    const ok = $('#conn-status');
    ok.textContent = '无法连接服务：' + e.message + '。请确认已运行 server.py，并用 Chrome/Edge 打开本页。';
    ok.className = 'conn err';
  }
}

init();
