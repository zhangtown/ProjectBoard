/* ============================================================
 * app.js — 拖拽式项目看板
 * 数据持久化：localStorage
 * 归档导出：js/xlsx.js（零依赖 XLSX 生成）
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var CARD_KEY = 'pm_kanban_cards_v1';
  var ARCH_KEY = 'pm_kanban_archive_v1';

  var COLUMNS = [
    { id: 'todo', name: '待办',   tone: '#3B82F6' },
    { id: 'wip',  name: '进行中', tone: '#F59E0B' },
    { id: 'done', name: '已完成', tone: '#10B981' }
  ];

  var PRIORITY = {
    high:   { label: '高' },
    medium: { label: '中' },
    low:    { label: '低' }
  };

  var EXPORT_HEADER = ['序号', '部门', '销售', '项目名称', '支撑内容', '技术负责人', '时间', '备注', '项目情况'];
  var EXPORT_WIDTHS = [6, 14, 10, 26, 44, 16, 14, 50, 14];

  var AVATAR_COLORS = ['#0F766E', '#B45309', '#1D4ED8', '#9333EA', '#BE123C',
                       '#0369A1', '#4D7C0F', '#A16207', '#7C2D12', '#5B21B6'];

  var SEED = [
    { col: 'todo', name: '712 项目投标支撑', support: '投标技术文件编制、审核与装订交付。',
      priority: 'high', dept: '销售一部', sales: '王倩', owners: '张腾、余忠礼',
      date: '2026-09-20', remark: '需在 9 月 18 日前完成初稿并提交内审。', status: '未启动' },

    { col: 'todo', name: '网络对抗试验环境搭建', support: '靶场网络拓扑搭建与流量仿真环境部署。',
      priority: 'medium', dept: '销售二部', sales: '陈诺', owners: '余忠礼',
      date: '2026-09-28', remark: '等待客户确认机柜与授权范围。', status: '待启动' },

    { col: 'todo', name: '安全检测报告模板修订', support: '按新规范更新报告模板与评分细则。',
      priority: 'low', dept: '销售一部', sales: '李菁', owners: '孙悦',
      date: '2026-10-10', remark: '', status: '待启动' },

    { col: 'wip', name: 'HY 行动武器装备安全性试验鉴定', support: '基于 AI 网络对抗的防护验证方案设计与实施。',
      priority: 'high', dept: '销售一部', sales: '王倩', owners: '张腾、余忠礼、孙悦',
      date: '2026-09-15', remark: '第二阶段验证用例已评审通过，进入执行。', status: '进行中' },

    { col: 'wip', name: '客户现场渗透测试复测', support: '针对第一轮高危漏洞的复测与报告输出。',
      priority: 'medium', dept: '销售二部', sales: '陈诺', owners: '余忠礼',
      date: '2026-09-12', remark: '剩余 2 个中危项待客户确认整改计划。', status: '复测中' },

    { col: 'done', name: '709 投标项目', support: '投标材料技术部分检查。',
      priority: 'high', dept: '销售一部', sales: '李菁', owners: '张腾、余忠礼',
      date: '2026-01-08',
      remark: '1、张腾、余忠礼检查出部分问题，外协以时间来不及为理由，部分问题未修改继续打印。',
      status: '项目终止' }
  ];

  /* ---------------- 状态 ---------------- */
  var cards = [];
  var archive = [];
  var editId = null;
  var qaPriority = 'medium';
  var archiveQuery = '';
  var newIds = Object.create(null);

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $('board');

  /* ---------------- 工具 ---------------- */
  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseOwners(str) {
    return String(str || '').split(/[、,，;；\/|]+/).map(function (t) { return t.trim(); })
      .filter(function (t, i, a) { return t && a.indexOf(t) === i; });
  }

  function hashOf(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
    return h;
  }

  function colorOf(name) {
    return AVATAR_COLORS[hashOf(name || '?') % AVATAR_COLORS.length];
  }

  function initialOf(name) {
    var s = String(name || '').trim();
    return s ? s.charAt(0).toUpperCase() : '?';
  }

  function fmtDateCN(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return (+m[1]) + '年' + (+m[2]) + '月' + (+m[3]) + '日';
  }

  function fmtDateShort(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var now = new Date().getFullYear();
    return (+m[1] === now ? '' : (+m[1]) + '年') + (+m[2]) + '月' + (+m[3]) + '日';
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function statusTone(s) {
    var t = String(s || '');
    if (/终止|取消|失败|停止|流标|废标/.test(t)) return '#D92D20';
    if (/完成|结项|交付|通过|中标|验收/.test(t)) return '#067647';
    if (/进行|实施|推进|复测|测试|评审|投标/.test(t)) return '#B54708';
    if (/暂缓|暂停|挂起|待定/.test(t)) return '#667085';
    if (/未启动|待启动|准备|排期/.test(t)) return '#175CD3';
    return '#475467';
  }

  /* ---------------- 存储 ---------------- */
  function normalizeCard(raw, fallbackCol) {
    return {
      id: raw.id || uid(),
      col: COLUMNS.some(function (c) { return c.id === raw.col; }) ? raw.col : (fallbackCol || 'todo'),
      name: String(raw.name || '未命名任务'),
      support: String(raw.support || ''),
      priority: PRIORITY[raw.priority] ? raw.priority : 'medium',
      dept: String(raw.dept || ''),
      sales: String(raw.sales || ''),
      owners: String(raw.owners || ''),
      date: String(raw.date || ''),
      remark: String(raw.remark || ''),
      status: String(raw.status || ''),
      createdAt: raw.createdAt || Date.now(),
      updatedAt: raw.updatedAt || Date.now()
    };
  }

  function load() {
    try {
      var rawC = localStorage.getItem(CARD_KEY);
      if (rawC) {
        var pc = JSON.parse(rawC);
        if (Array.isArray(pc)) cards = pc.map(function (c) { return normalizeCard(c); });
      } else {
        cards = SEED.map(function (c) { return normalizeCard(c, 'todo'); });
      }
    } catch (e) {
      cards = SEED.map(function (c) { return normalizeCard(c, 'todo'); });
    }

    try {
      var rawA = localStorage.getItem(ARCH_KEY);
      var pa = rawA ? JSON.parse(rawA) : [];
      archive = Array.isArray(pa) ? pa.filter(function (r) { return r && r.name; }) : [];
    } catch (e) {
      archive = [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(CARD_KEY, JSON.stringify(cards));
      localStorage.setItem(ARCH_KEY, JSON.stringify(archive));
    } catch (e) {
      toast('本地存储写入失败，数据可能未保存', 'err');
    }
  }

  /* ---------------- 渲染：看板 ---------------- */
  function avatarsHTML(ownersStr) {
    var list = parseOwners(ownersStr);
    if (!list.length) return '';
    var show = list.slice(0, 3);
    var html = '<div class="avatars">';
    show.forEach(function (n) {
      html += '<span class="avatar" style="background:' + colorOf(n) + '" title="' + esc(n) + '">' +
              esc(initialOf(n)) + '</span>';
    });
    if (list.length > show.length) {
      html += '<span class="avatar avatar--more" title="' + esc(list.slice(3).join('、')) + '">+' +
              (list.length - show.length) + '</span>';
    }
    html += '</div>';
    return html;
  }

  function cardHTML(c, isNew, idx) {
    var pri = PRIORITY[c.priority] ? c.priority : 'medium';
    var ownerList = parseOwners(c.owners);
    var delay = reduceMotion ? 0 : Math.min(idx, 8) * 28;

    var html =
      '<article class="card' + (isNew ? ' is-new' : '') + '" data-id="' + esc(c.id) + '" data-pri="' + pri + '"' +
      ' tabindex="0" role="listitem"' + (isNew ? ' style="animation-delay:' + delay + 'ms"' : '') + '>' +
        '<div class="card__top">' +
          '<h3 class="card__name">' + esc(c.name) + '</h3>' +
          '<span class="card__grip" aria-hidden="true"><svg class="ico"><use href="#i-grip"/></svg></span>' +
          '<span class="tag">' + PRIORITY[pri].label + '</span>' +
        '</div>';

    if (c.support) html += '<p class="card__support">' + esc(c.support) + '</p>';

    var meta = '';
    if (c.status) {
      meta += '<span class="chip"><span class="chip__dot" style="background:' + statusTone(c.status) + '"></span>' +
              '<span class="chip__text">' + esc(c.status) + '</span></span>';
    }
    if (c.date) {
      meta += '<span class="chip"><svg class="ico"><use href="#i-calendar"/></svg>' +
              esc(fmtDateShort(c.date)) + '</span>';
    }
    if (c.dept) {
      meta += '<span class="chip chip--dept"><span class="chip__text">' + esc(c.dept) + '</span></span>';
    }
    if (c.sales) {
      meta += '<span class="chip"><span class="chip__text">销售 ' + esc(c.sales) + '</span></span>';
    }
    if (meta) html += '<div class="card__meta">' + meta + '</div>';

    html += '<div class="card__foot">' +
        '<div class="owners">' +
          (ownerList.length
            ? avatarsHTML(c.owners) + '<span class="owner-names" title="' + esc(ownerList.join('、')) + '">' + esc(ownerList.join('、')) + '</span>'
            : '<span class="owner-names owner-names--empty">未指派</span>') +
        '</div>' +
        '<div class="card__actions">' +
          (c.col === 'done'
            ? '<button type="button" class="icon-btn icon-btn--accent" data-act="archive" data-id="' + esc(c.id) + '" title="归档" aria-label="归档"><svg class="ico"><use href="#i-archive"/></svg></button>'
            : '') +
          '<button type="button" class="icon-btn" data-act="edit" data-id="' + esc(c.id) + '" title="编辑" aria-label="编辑"><svg class="ico"><use href="#i-edit"/></svg></button>' +
          '<button type="button" class="icon-btn icon-btn--danger" data-act="del" data-id="' + esc(c.id) + '" title="删除" aria-label="删除"><svg class="ico"><use href="#i-trash"/></svg></button>' +
        '</div>' +
      '</div>' +
    '</article>';
    return html;
  }

  function renderBoard() {
    var scrollMap = Object.create(null);
    boardEl.querySelectorAll('.cards').forEach(function (el) { scrollMap[el.dataset.col] = el.scrollTop; });

    var frag = document.createDocumentFragment();

    COLUMNS.forEach(function (col) {
      var list = cards.filter(function (c) { return c.col === col.id; });

      var section = document.createElement('section');
      section.className = 'column';
      section.dataset.col = col.id;

      var head = document.createElement('header');
      head.className = 'column__head';
      head.innerHTML =
        '<span class="column__dot" style="background:' + col.tone + '"></span>' +
        '<span class="column__name">' + col.name + '</span>' +
        '<span class="column__count">' + list.length + '</span>' +
        '<span class="column__spacer"></span>' +
        '<button type="button" class="icon-btn" data-add="' + col.id + '" title="在「' + col.name + '」新增" aria-label="在' + col.name + '新增">' +
          '<svg class="ico"><use href="#i-plus"/></svg></button>';

      var zone = document.createElement('div');
      zone.className = 'cards';
      zone.dataset.col = col.id;
      zone.setAttribute('role', 'list');

      if (!list.length) {
        zone.innerHTML = '<div class="empty">暂无任务，拖动卡片到这里</div>';
      } else {
        var buf = '';
        list.forEach(function (c, i) {
          buf += cardHTML(c, !!newIds[c.id], i);
        });
        zone.innerHTML = buf;
      }

      section.appendChild(head);
      section.appendChild(zone);
      frag.appendChild(section);
    });

    boardEl.innerHTML = '';
    boardEl.appendChild(frag);

    Object.keys(scrollMap).forEach(function (k) {
      var el = boardEl.querySelector('.cards[data-col="' + k + '"]');
      if (el) el.scrollTop = scrollMap[k];
    });

    newIds = Object.create(null);
  }

  /* ---------------- 渲染：归档 ---------------- */
  function renderArchive() {
    var list = archive.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    if (archiveQuery) {
      var q = archiveQuery.toLowerCase();
      list = list.filter(function (r) {
        return [r.name, r.dept, r.sales, r.owners, r.status, r.support, r.remark]
          .join(' ').toLowerCase().indexOf(q) > -1;
      });
    }

    $('archiveCount').textContent = String(archive.length);
    $('archiveMeta').textContent = archive.length
      ? '共 ' + archive.length + ' 条归档记录' + (archiveQuery ? '（筛选出 ' + list.length + ' 条）' : '')
      : '暂无归档记录';

    var box = $('archiveList');
    if (!list.length) {
      box.innerHTML =
        '<div class="drawer-empty"><svg viewBox="0 0 24 24"><use href="#i-inbox"/></svg>' +
        '<p>' + (archive.length ? '没有匹配的归档记录' : '归档目录还是空的') + '</p>' +
        '<small>' + (archive.length ? '换个关键词试试' : '把「已完成」的卡片归档后会出现在这里') + '</small></div>';
      return;
    }

    box.innerHTML = list.map(function (r) {
      var meta = [];
      if (r.date) meta.push('<span>时间 <i>' + esc(fmtDateCN(r.date)) + '</i></span>');
      if (r.dept) meta.push('<span>部门 <i>' + esc(r.dept) + '</i></span>');
      if (r.sales) meta.push('<span>销售 <i>' + esc(r.sales) + '</i></span>');
      if (r.owners) meta.push('<span>技术 <i>' + esc(r.owners) + '</i></span>');
      if (r.status) {
        meta.push('<span><span class="chip__dot" style="background:' + statusTone(r.status) + '"></span>' +
                  '<i>' + esc(r.status) + '</i></span>');
      }

      return '<div class="arc" data-id="' + esc(r.id) + '">' +
          '<div class="arc__seq">' + (r.seq || 0) + '</div>' +
          '<div class="arc__main">' +
            '<div class="arc__title">' + esc(r.name) + '</div>' +
            (r.support ? '<div class="arc__sub">' + esc(r.support) + '</div>' : '') +
            (meta.length ? '<div class="arc__meta">' + meta.join('') + '</div>' : '') +
          '</div>' +
          '<div class="arc__actions">' +
            '<button type="button" class="icon-btn icon-btn--accent" data-arc="restore" data-id="' + esc(r.id) + '" title="恢复到「已完成」" aria-label="恢复"><svg class="ico"><use href="#i-undo"/></svg></button>' +
            '<button type="button" class="icon-btn icon-btn--danger" data-arc="del" data-id="' + esc(r.id) + '" title="彻底删除" aria-label="删除"><svg class="ico"><use href="#i-trash"/></svg></button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function renderAll() {
    renderBoard();
    renderArchive();
    refreshDatalists();
    syncScrollLock();
  }

  function refreshDatalists() {
    function fill(id, key) {
      var dl = $(id);
      if (!dl) return;
      var set = Object.create(null);
      cards.concat(archive).forEach(function (r) { if (r[key]) set[r[key]] = 1; });
      dl.innerHTML = Object.keys(set).slice(0, 40)
        .map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('');
    }
    fill('dlDept', 'dept');
    fill('dlSales', 'sales');
    fill('dlStatus', 'status');
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'ok');
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    $('toaster').appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 260);
    }, 2200);
  }

  /* ---------------- 弹层基础 ---------------- */
  function isOpen(id) { var el = $(id); return el && !el.hidden; }

  function openLayer(id) { $(id).hidden = false; syncScrollLock(); }
  function closeLayer(id) { $(id).hidden = true; syncScrollLock(); }

  function syncScrollLock() {
    var open = isOpen('drawer') || isOpen('cardModal') || isOpen('confirmModal');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  /* ---------------- 确认框 ---------------- */
  var confirmResolve = null;

  function confirmBox(title, text, okText) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('btnConfirmOk').textContent = okText || '确定';
    openLayer('confirmModal');
    setTimeout(function () { $('btnConfirmOk').focus(); }, 40);
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }

  function settleConfirm(v) {
    closeLayer('confirmModal');
    if (confirmResolve) { var r = confirmResolve; confirmResolve = null; r(v); }
  }

  /* ---------------- 卡片增删改 ---------------- */
  function openCardModal(colId, id) {
    editId = id || null;
    var c = id ? cards.find(function (x) { return x.id === id; }) : null;

    $('cardModalTitle').textContent = c ? '编辑卡片' : '新增卡片';
    $('fName').value = c ? c.name : '';
    $('fSupport').value = c ? c.support : '';
    $('fDept').value = c ? c.dept : '';
    $('fSales').value = c ? c.sales : '';
    $('fOwners').value = c ? c.owners : '';
    $('fDate').value = c ? c.date : '';
    $('fStatus').value = c ? c.status : '';
    $('fRemark').value = c ? c.remark : '';
    $('fCol').value = c ? c.col : (colId || 'todo');
    setSeg('fPriority', c ? c.priority : 'medium');

    $('errName').hidden = true;
    $('fName').parentNode.classList.remove('is-invalid');

    openLayer('cardModal');
    setTimeout(function () { $('fName').focus(); }, 60);
  }

  function saveCard() {
    var name = $('fName').value.trim();
    if (!name) {
      $('errName').hidden = false;
      $('fName').parentNode.classList.add('is-invalid');
      $('fName').focus();
      return;
    }

    var payload = {
      name: name,
      support: $('fSupport').value.trim(),
      priority: getSeg('fPriority'),
      dept: $('fDept').value.trim(),
      sales: $('fSales').value.trim(),
      owners: $('fOwners').value.trim(),
      date: $('fDate').value,
      status: $('fStatus').value.trim(),
      remark: $('fRemark').value.trim(),
      col: $('fCol').value,
      updatedAt: Date.now()
    };

    if (editId) {
      var i = cards.findIndex(function (x) { return x.id === editId; });
      if (i > -1) {
        cards[i] = normalizeCard(Object.assign({}, cards[i], payload, { id: editId }), cards[i].col);
      }
      toast('已保存修改');
    } else {
      var card = normalizeCard(Object.assign({ id: uid(), createdAt: Date.now() }, payload), payload.col);
      cards.unshift(card);
      newIds[card.id] = 1;
      toast('已新增卡片：' + card.name);
    }

    editId = null;
    persist();
    renderAll();
    closeLayer('cardModal');
  }

  function deleteCard(id) {
    var c = cards.find(function (x) { return x.id === id; });
    if (!c) return;
    confirmBox('删除卡片', '确定删除「' + c.name + '」吗？该操作不可撤销。', '删除')
      .then(function (ok) {
        if (!ok) return;
        cards = cards.filter(function (x) { return x.id !== id; });
        persist();
        renderAll();
        toast('已删除：' + c.name, 'warn');
      });
  }

  /* ---------------- 归档 ---------------- */
  function nextSeq() {
    return archive.reduce(function (m, r) { return Math.max(m, Number(r.seq) || 0); }, 0) + 1;
  }

  function archiveCard(id) {
    var idx = cards.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var c = cards[idx];

    confirmBox('归档卡片', '「' + c.name + '」将从看板移除并存入归档目录，可随时恢复或导出 Excel。', '归档')
      .then(function (ok) {
        if (!ok) return;
        archive.push({
          id: c.id,
          seq: nextSeq(),
          name: c.name,
          support: c.support,
          dept: c.dept,
          sales: c.sales,
          owners: c.owners,
          date: c.date,
          remark: c.remark,
          status: c.status,
          priority: c.priority,
          archivedAt: new Date().toISOString()
        });
        cards.splice(idx, 1);
        persist();
        renderAll();
        toast('已归档：' + c.name);
      });
  }

  function restoreArchived(id) {
    var i = archive.findIndex(function (r) { return r.id === id; });
    if (i < 0) return;
    var r = archive[i];
    var card = normalizeCard({
      id: uid(),
      col: 'done',
      name: r.name, support: r.support, priority: r.priority,
      dept: r.dept, sales: r.sales, owners: r.owners,
      date: r.date, remark: r.remark, status: r.status,
      createdAt: Date.now()
    }, 'done');
    cards.unshift(card);
    archive.splice(i, 1);
    newIds[card.id] = 1;
    persist();
    renderAll();
    toast('已恢复到「已完成」：' + card.name);
  }

  function deleteArchived(id) {
    var i = archive.findIndex(function (r) { return r.id === id; });
    if (i < 0) return;
    var r = archive[i];
    confirmBox('删除归档', '确定彻底删除归档记录「' + r.name + '」吗？该操作不可撤销。', '删除')
      .then(function (ok) {
        if (!ok) return;
        archive.splice(i, 1);
        persist();
        renderArchive();
        toast('已删除归档记录', 'warn');
      });
  }

  function base64FromBytes(bytes) {
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function exportExcel() {
    if (!archive.length) { toast('归档目录为空，暂无可导出的数据', 'warn'); return; }

    var rows = archive.slice()
      .sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); })
      .map(function (r, i) {
        return [
          Number(r.seq) || (i + 1),
          r.dept || '',
          r.sales || '',
          r.name || '',
          r.support || '',
          r.owners || '',
          fmtDateCN(r.date) || '',
          r.remark || '',
          r.status || ''
        ];
      });

    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    var filename = '项目归档_' + stamp + '.xlsx';

    var bytes = window.MiniXlsx.build({
      header: EXPORT_HEADER,
      rows: rows,
      widths: EXPORT_WIDTHS,
      sheetName: '项目归档'
    });

    // 桌面端（Neutralino）：用系统保存对话框落地文件；浏览器回退到锚点下载
    // 注意：必须用 window.NL_OS 判定真实 Neutralino 运行时（仅框架注入），
    // 不能只用 window.Neutralino（引入客户端库后浏览器里该对象也存在，会误触连接）。
    if (window.Neutralino && window.NL_OS) {
      window.Neutralino.os.showSaveDialog({
        title: '导出 Excel',
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
      }).then(function (path) {
        if (!path) return;
        if (!/\.xlsx$/i.test(path)) path += '.xlsx';
        return window.Neutralino.filesystem.writeFile(path, base64FromBytes(bytes));
      }).then(function () {
        toast('已导出 ' + rows.length + ' 条归档记录');
      }).catch(function (e) {
        if (e && (e.code === 'NE_RPC_FAILED' || (e.message || '').indexOf('cancel') > -1)) return;
        toast('导出失败：' + ((e && e.message) || e), 'err');
      });
      return;
    }

    try {
      var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('已导出 ' + rows.length + ' 条归档记录');
    } catch (e) {
      toast('导出失败：' + e.message, 'err');
    }
  }

  /* ---------------- 快捷添加 ---------------- */
  function quickAdd() {
    var input = $('qaInput');
    var text = input.value.trim();
    if (!text) { input.focus(); return; }

    var card = normalizeCard({
      id: uid(),
      col: 'todo',
      name: text,
      support: '',
      priority: qaPriority,
      date: todayISO(),
      createdAt: Date.now()
    }, 'todo');

    cards.unshift(card);
    newIds[card.id] = 1;
    persist();
    renderAll();
    input.value = '';
    input.focus();
    toast('已加入「待办」：' + text);
  }

  /* ---------------- 分段控件 ---------------- */
  function setSeg(id, value) {
    var box = $(id);
    if (!box) return;
    box.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.value === value);
    });
  }

  function getSeg(id) {
    var on = $(id).querySelector('button.is-on');
    return on ? on.dataset.value : 'medium';
  }

  /* ============================================================
   * 拖拽引擎（Pointer Events，鼠标 / 触屏通用）
   * ============================================================ */
  var pending = null;   // 按下后尚未进入拖拽的状态
  var drag = null;      // 正在拖拽的状态
  var rafId = 0;
  var clickBlockUntil = 0;  // 拖拽结束后短暂屏蔽 click，避免误触卡片按钮
  var colCache = null;  // 拖拽期间缓存的列矩形，避免每帧 getBoundingClientRect
  var indicatorEl = null;   // 拖拽期间的插入指示线

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('button, a, input, textarea, select, label')) return;
    var card = e.target.closest('.card');
    if (!card || drag) return;

    pending = {
      el: card,
      id: card.dataset.id,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      touch: e.pointerType === 'touch',
      timer: 0
    };

    if (pending.touch) {
      pending.timer = setTimeout(function () {
        if (pending) beginDrag();
      }, 240);
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!pending) return;
    pending.x = e.clientX;
    pending.y = e.clientY;

    if (!drag) {
      var dist = Math.abs(e.clientX - pending.startX) + Math.abs(e.clientY - pending.startY);
      if (pending.touch) {
        if (dist > 10) resetPending();          // 触屏：判定为滚动
      } else if (dist > 5) {
        beginDrag();
      }
      return;
    }

    e.preventDefault();
    // 拖拽期间：坐标写入 drag，占位移动由 pointermove 事件驱动（非逐帧）
    drag.x = e.clientX;
    drag.y = e.clientY;
    updateDropTarget(e.clientX, e.clientY);
  }

  function onPointerUp() {
    if (drag) endDrag(true);
    resetPending();
  }

  function resetPending() {
    if (pending && pending.timer) clearTimeout(pending.timer);
    pending = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function beginDrag() {
    if (!pending || drag) return;
    var el = pending.el;
    var rect = el.getBoundingClientRect();

    drag = {
      el: el,
      id: el.dataset.id,
      offX: pending.x - rect.left,
      offY: pending.y - rect.top,
      x: pending.x,
      y: pending.y,
      dropCol: null
    };

    // 缓存所有列与卡片的矩形（拖拽起点一次性读取），后续逐帧不再触碰布局
    buildColCache();

    if (window.getSelection) { try { window.getSelection().removeAllRanges(); } catch (err) {} }

    var ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('is-new');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    ghost.removeAttribute('tabindex');
    document.body.appendChild(ghost);
    drag.ghost = ghost;

    el.classList.add('is-dragging');
    document.body.classList.add('dnd-active');

    moveGhost();
    rafId = requestAnimationFrame(tick);
  }

  // 缓存列矩形与每列卡片矩形：仅在拖拽起点与 DOM 变动后重建。
  // 这是消除卡顿的关键——把「每帧 getBoundingClientRect」降到「按需」。
  function buildColCache() {
    colCache = [];
    boardEl.querySelectorAll('.cards').forEach(function (zone) {
      var zr = zone.getBoundingClientRect();
      var items = [];
      Array.prototype.slice.call(zone.querySelectorAll('.card')).forEach(function (c) {
        if (c === drag.el) return;
        var cr = c.getBoundingClientRect();
        items.push({ el: c, top: cr.top, bottom: cr.bottom, mid: (cr.top + cr.bottom) / 2 });
      });
      colCache.push({ zone: zone, top: zr.top, bottom: zr.bottom, left: zr.left, right: zr.right, items: items });
    });
  }

  function moveGhost() {
    if (!drag) return;
    var t = 'translate3d(' + (drag.x - drag.offX) + 'px,' + (drag.y - drag.offY) + 'px,0) rotate(1.2deg) scale(1.02)';
    drag.ghost.style.transform = t;
  }

  function tick() {
    if (!drag) return;
    // 逐帧只做「合成器友好」的 transform 更新，绝不做任何布局读取。
    // 拖拽坐标已在 pointermove 中写入 drag.x/drag.y。
    moveGhost();
    autoScroll();
    rafId = requestAnimationFrame(tick);
  }

  function autoScroll() {
    // 用缓存列矩形判断是否贴近列边缘，避免逐帧 elementFromPoint / getBoundingClientRect。
    var x = drag.x, y = drag.y;
    if (!colCache) return;
    for (var i = 0; i < colCache.length; i++) {
      var c = colCache[i];
      if (x < c.left || x > c.right) continue;
      var zone = c.zone;
      if (zone.scrollHeight > zone.clientHeight + 2) {
        var edge = 56;
        if (y < c.top + edge) zone.scrollTop -= Math.ceil((c.top + edge - y) / 5);
        else if (y > c.bottom - edge) zone.scrollTop += Math.ceil((y - (c.bottom - edge)) / 5);
      }
    }

    var b = boardEl;
    if (b.scrollWidth > b.clientWidth + 4) {
      if (x < 72) b.scrollLeft -= 16;
      else if (x > window.innerWidth - 72) b.scrollLeft += 16;
    }
  }

  // 由 pointermove 触发（非逐帧）：判定指针所在列，并做轻量插入指示线。
  // 拖拽期间「不移动真实卡片」——只移动一条指示线 + 高亮目标列，彻底消除逐帧重排。
  // 使用缓存矩形，零 getBoundingClientRect 调用；仅在列/插入位真正变化时操作 DOM。
  function updateDropTarget(x, y) {
    if (!drag || !colCache) return;
    var container = null, hit = null;
    for (var i = 0; i < colCache.length; i++) {
      var c = colCache[i];
      if (x >= c.left && x <= c.right && y >= c.top && y <= c.bottom) {
        container = c.zone; hit = c; break;
      }
    }
    if (!container) {
      if (drag.dropCol) { drag.dropCol.classList.remove('is-drop-target'); drag.dropCol = null; }
      removeIndicator();
      return;
    }

    if (drag.dropCol && drag.dropCol !== container) drag.dropCol.classList.remove('is-drop-target');

    var before = null;
    for (var j = 0; j < hit.items.length; j++) {
      if (y < hit.items[j].mid) { before = hit.items[j].el; break; }
    }

    // 仅当目标列或插入位真正变化时才重绘指示线（避免 pointermove 每步都读 offsetTop）
    if (drag.dropCol === container && drag.targetBefore === before) return;

    container.classList.add('is-drop-target');
    drag.dropCol = container;
    drag.targetBefore = before;   // 记录落位目标，endDrag 时一次性插入
    placeIndicator(container, before);
  }

  // 插入指示线：绝对定位浮在列内，不参与 flex 布局，零重排
  function placeIndicator(container, before) {
    var ind = indicatorEl;
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'drop-indicator';
      container.appendChild(ind);
      indicatorEl = ind;
    } else if (ind.parentNode !== container) {
      container.appendChild(ind);
    }

    var top;
    if (before) {
      // 目标卡片顶部，微上调让指示线贴合卡片间距
      top = before.offsetTop - 4;
    } else {
      // 列尾：最后一个卡片底部（或空列提示底部）
      var last = container.querySelector('.card:last-of-type');
      top = last ? last.offsetTop + last.offsetHeight + 4 : 8;
    }
    ind.style.top = top + 'px';
  }
  function removeIndicator() {
    if (indicatorEl && indicatorEl.parentNode) indicatorEl.parentNode.removeChild(indicatorEl);
    indicatorEl = null;
  }

  function clearEmptyHints() {
    // 清空后补回占位提示，避免列高度塌陷
    boardEl.querySelectorAll('.cards').forEach(function (zone) {
      var has = zone.querySelector('.card');
      var hint = zone.querySelector('.empty');
      if (!has && !hint) {
        var d = document.createElement('div');
        d.className = 'empty';
        d.textContent = '暂无任务，拖动卡片到这里';
        zone.appendChild(d);
      } else if (has && hint) {
        hint.remove();
      }
    });
  }

  function endDrag(commit) {
    if (!drag) return;
    cancelAnimationFrame(rafId);
    colCache = null;
    removeIndicator();
    if (drag.dropCol) drag.dropCol.classList.remove('is-drop-target');
    var ghost = drag.ghost;
    var el = drag.el;
    var target = el.getBoundingClientRect();

    el.classList.remove('is-dragging');
    document.body.classList.remove('dnd-active');

    if (commit) {
      clickBlockUntil = Date.now() + 320;

      // 一次性落位：把卡片插入目标列的目标位置，再按 DOM 顺序重建数据
      var dest = drag.dropCol;
      if (dest) {
        var empty = dest.querySelector('.empty');
        if (empty) empty.remove();
        dest.insertBefore(el, drag.targetBefore || null);
        clearEmptyHints();
      }

      var prevIds = cards.map(function (c) { return c.id; }).join('|');
      var prevCols = cards.map(function (c) { return c.col; }).join('|');
      var next = [];
      COLUMNS.forEach(function (col) {
        var zone = boardEl.querySelector('.cards[data-col="' + col.id + '"]');
        if (!zone) return;
        Array.prototype.slice.call(zone.querySelectorAll('.card')).forEach(function (n) {
          var c = cards.find(function (x) { return x.id === n.dataset.id; });
          if (!c) return;
          if (c.col !== col.id) c.col = col.id;
          next.push(c);
        });
      });

      if (next.length === cards.length) {
        cards = next;
        var nextIds = cards.map(function (c) { return c.id; }).join('|');
        var nextCols = cards.map(function (c) { return c.col; }).join('|');
        if (nextIds !== prevIds || nextCols !== prevCols) {
          cards.forEach(function (c) { c.updatedAt = Date.now(); });
          persist();
        }
      }
    }

    if (!reduceMotion) {
      ghost.style.transition = 'transform .2s cubic-bezier(.16,1,.3,1), opacity .2s ease-in';
      ghost.style.transform = 'translate3d(' + target.left + 'px,' + target.top + 'px,0) rotate(0deg) scale(1)';
      ghost.style.opacity = '0.15';
      setTimeout(function () { if (ghost.parentNode) ghost.remove(); }, 220);
    } else {
      ghost.remove();
    }

    drag = null;
    renderAll();
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bind() {
    /* --- 看板交互 --- */
    boardEl.addEventListener('pointerdown', onPointerDown);
    boardEl.addEventListener('click', function (e) {
      if (Date.now() < clickBlockUntil) return;   // 刚结束拖拽，忽略这一次 click
      var addBtn = e.target.closest('[data-add]');
      if (addBtn) { openCardModal(addBtn.dataset.add, null); return; }

      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        var id = actBtn.dataset.id;
        var act = actBtn.dataset.act;
        if (act === 'edit') openCardModal(null, id);
        else if (act === 'del') deleteCard(id);
        else if (act === 'archive') archiveCard(id);
      }
    });

    // 阻止拖拽时触屏滚动 / 长按菜单
    document.addEventListener('touchmove', function (e) {
      if (drag && e.cancelable) e.preventDefault();
    }, { passive: false });
    document.addEventListener('contextmenu', function (e) {
      if (drag || (pending && pending.touch)) e.preventDefault();
    });
    document.addEventListener('dragstart', function (e) {
      if (e.target.closest && e.target.closest('.card')) e.preventDefault();
    });

    /* --- 顶栏 --- */
    $('btnNew').addEventListener('click', function () { openCardModal('todo', null); });

    /* --- 快捷添加 --- */
    $('qaBtn').addEventListener('click', quickAdd);
    $('qaInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); quickAdd(); }
    });
    $('qaPriority').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      qaPriority = b.dataset.value;
      setSeg('qaPriority', qaPriority);
    });

    /* --- 卡片弹窗 --- */
    $('fPriority').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      setSeg('fPriority', b.dataset.value);
    });
    $('btnSaveCard').addEventListener('click', saveCard);
    $('fName').addEventListener('input', function () {
      $('errName').hidden = true;
      $('fName').parentNode.classList.remove('is-invalid');
    });
    $('cardModal').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); saveCard(); }
    });

    /* --- 关闭按钮 / 遮罩 --- */
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-close]');
      if (!t) return;
      var id = t.dataset.close;
      if (id === 'drawer') closeDrawer();
      else closeLayer(id);
    });

    /* --- 确认框 --- */
    $('btnConfirmOk').addEventListener('click', function () { settleConfirm(true); });

    /* --- 归档抽屉 --- */
    $('drawerScrim').addEventListener('click', closeDrawer);
    $('archiveSearch').addEventListener('input', function (e) {
      archiveQuery = e.target.value.trim();
      renderArchive();
    });
    $('archiveList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-arc]');
      if (!b) return;
      if (b.dataset.arc === 'restore') restoreArchived(b.dataset.id);
      else deleteArchived(b.dataset.id);
    });
    $('btnExport').addEventListener('click', exportExcel);
    $('btnClearArchive').addEventListener('click', function () {
      if (!archive.length) { toast('归档目录已为空', 'warn'); return; }
      confirmBox('清空归档', '将删除全部 ' + archive.length + ' 条归档记录，且无法恢复。建议先导出 Excel。', '清空')
        .then(function (ok) {
          if (!ok) return;
          archive = [];
          persist();
          renderArchive();
          toast('归档目录已清空', 'warn');
        });
    });

    /* --- 键盘 --- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (isOpen('confirmModal')) settleConfirm(false);
        else if (isOpen('cardModal')) closeLayer('cardModal');
        else if (isOpen('drawer')) closeDrawer();
        return;
      }
    });

    /* --- 跨标签页同步 --- */
    window.addEventListener('storage', function (e) {
      if (e.key !== CARD_KEY && e.key !== ARCH_KEY) return;
      load();
      renderAll();
    });
  }

  /* 抽屉打开 / 关闭 */
  function openDrawer() {
    $('drawerScrim').hidden = false;
    $('drawer').hidden = false;
    syncScrollLock();
    setTimeout(function () { $('archiveSearch').focus(); }, 120);
  }
  function closeDrawer() {
    $('drawer').hidden = true;
    $('drawerScrim').hidden = true;
    syncScrollLock();
  }
  $('btnArchive').addEventListener('click', openDrawer);

  /* ---------------- 启动 ---------------- */
  load();
  bind();
  renderAll();

  // 桌面端（Neutralino）：建立与框架的原生通道，确保导出等功能可用
  if (window.Neutralino && window.NL_OS) {
    try { window.Neutralino.init(); } catch (e) { /* 忽略：非桌面环境不会执行到这里 */ }
  }
})();
