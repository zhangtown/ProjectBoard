/* ============================================================
 * xlsx.js — 零依赖的最小 XLSX 生成器
 * 通过「STORE 方式 ZIP + SpreadsheetML」在浏览器端直接产出 .xlsx
 * 仅依赖标准 API：TextEncoder / Blob / Uint8Array
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- CRC32 ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
      date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  /* ---------- ZIP（仅 STORE，无压缩） ---------- */
  function buildZip(files) {
    var enc = new TextEncoder();
    var stamp = dosDateTime(new Date());
    var body = [];           // 本地文件头 + 数据
    var central = [];        // 中央目录
    var offset = 0;
    var total = 0;

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);

      var lh = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);   // UTF-8 文件名
      lv.setUint16(8, 0, true);        // STORE
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      body.push(lh, data);
      total += lh.length + data.length;

      var ch = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);   // extra
      cv.setUint16(32, 0, true);   // comment
      cv.setUint16(34, 0, true);   // disk start
      cv.setUint16(36, 0, true);   // internal attrs
      cv.setUint32(38, 0, true);   // external attrs
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);
      total += ch.length;

      offset += lh.length + data.length;
    });

    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    total += 22;

    var out = new Uint8Array(total);
    var p = 0;
    body.forEach(function (c) { out.set(c, p); p += c.length; });
    central.forEach(function (c) { out.set(c, p); p += c.length; });
    out.set(eocd, p);
    return out;
  }

  /* ---------- XML 工具 ---------- */
  function esc(str) {
    var s = String(str == null ? '' : str);
    // 移除 Excel 不接受的控制字符
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colRef(n) {
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /* ---------- XLSX 组件 ---------- */
  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  var ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var WORKBOOK =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="项目归档" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>';

  var WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
      '<font><sz val="11"/><color rgb="FF101828"/><name val="Microsoft YaHei"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF101828"/><name val="Microsoft YaHei"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F6"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function buildSheet(header, rows, widths) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + colRef(header.length) + (rows.length + 1) + '"/>' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18"/>';

    if (widths && widths.length) {
      xml += '<cols>';
      widths.forEach(function (w, i) {
        xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      });
      xml += '</cols>';
    }

    xml += '<sheetData>';

    // 表头
    xml += '<row r="1" ht="24" customHeight="1">';
    header.forEach(function (h, i) {
      xml += '<c r="' + colRef(i + 1) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + esc(h) + '</t></is></c>';
    });
    xml += '</row>';

    // 数据行
    rows.forEach(function (row, ri) {
      var r = ri + 2;
      xml += '<row r="' + r + '" ht="30" customHeight="1">';
      row.forEach(function (val, ci) {
        var ref = colRef(ci + 1) + r;
        if (typeof val === 'number' && isFinite(val)) {
          xml += '<c r="' + ref + '" s="2"><v>' + val + '</v></c>';
        } else if (val === '' || val == null) {
          xml += '<c r="' + ref + '" s="2"/>';
        } else {
          xml += '<c r="' + ref + '" s="2" t="inlineStr"><is><t xml:space="preserve">' + esc(val) + '</t></is></c>';
        }
      });
      xml += '</row>';
    });

    xml += '</sheetData></worksheet>';
    return xml;
  }

  /**
   * 生成 xlsx 二进制内容
   * @param {Object} opts
   * @param {Array<string>} opts.header   表头
   * @param {Array<Array>}  opts.rows     数据行
   * @param {Array<number>} [opts.widths] 列宽
   * @param {string} [opts.sheetName]
   * @returns {Uint8Array}
   */
  function build(opts) {
    var enc = new TextEncoder();
    var header = opts.header || [];
    var rows = opts.rows || [];
    var widths = opts.widths;
    var sheetXml = buildSheet(header, rows, widths);
    var wb = opts.sheetName
      ? WORKBOOK.replace('项目归档', esc(opts.sheetName))
      : WORKBOOK;

    return buildZip([
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: enc.encode(wb) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) }
    ]);
  }

  /** 触发浏览器下载 */
  function download(opts, filename) {
    var bytes = build(opts);
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  global.MiniXlsx = { build: build, download: download };
})(window);
