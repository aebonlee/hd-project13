/**
 * read-docx.js — Word(.docx) 안의 **표**를 읽는다. 라이브러리 없이.
 *
 * .docx 는 사실 ZIP 이고, 본문은 그 안의 `word/document.xml` 이다.
 * 압축 해제는 브라우저에 내장된 `DecompressionStream('deflate-raw')` 로 한다 —
 * 그래서 이 기능 하나 때문에 1MB 짜리 압축 라이브러리를 들일 필요가 없다.
 *
 * ⚠ 표만 읽는다. 문단은 무시한다.
 *   CAN 사양은 거의 표로 온다. 문단까지 긁으면 머리글 찾기가 흔들린다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadDocx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ─────────────────────────── ZIP 읽기 ─────────────────────────── */

  /**
   * ZIP 의 중앙 디렉터리를 뒤에서부터 찾아 항목 목록을 만든다.
   * 앞에서부터 훑지 않는 이유: 로컬 헤더에는 압축 크기가 0으로 적히고
   * 실제 값은 데이터 뒤(Data Descriptor)에 오는 경우가 있어 건너뛸 수가 없다.
   */
  function listEntries(buf) {
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    // EOCD(끝 표식 0x06054b50)를 뒤에서 찾는다. 주석이 있으면 끝이 아닐 수 있다.
    var eocd = -1;
    for (var i = u8.length - 22; i >= 0 && i > u8.length - 22 - 65536; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 형식이 아닙니다 (.docx 가 맞는지 확인하세요)');

    var count = dv.getUint16(eocd + 10, true);
    var start = dv.getUint32(eocd + 16, true);
    var p = start, out = [];
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nameLen));
      out.push({ name: name, method: method, compSize: compSize, localOff: localOff });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  function entryBytes(buf, e) {
    var dv = new DataView(buf);
    if (dv.getUint32(e.localOff, true) !== 0x04034b50) throw new Error('ZIP 항목이 손상되었습니다');
    var nameLen = dv.getUint16(e.localOff + 26, true);
    var extraLen = dv.getUint16(e.localOff + 28, true);
    var dataAt = e.localOff + 30 + nameLen + extraLen;
    return new Uint8Array(buf, dataAt, e.compSize);
  }

  function inflate(bytes) {
    // deflate-raw 는 ZIP 이 쓰는 그대로의 형식이다 (zlib 머리말이 없다)
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
  }

  function readXml(buf, name) {
    var entries = listEntries(buf);
    var e = null;
    for (var i = 0; i < entries.length; i++) if (entries[i].name === name) { e = entries[i]; break; }
    if (!e) return Promise.resolve(null);
    var raw = entryBytes(buf, e);
    if (e.method === 0) return Promise.resolve(new TextDecoder('utf-8').decode(raw));   // 무압축
    if (e.method !== 8) return Promise.reject(new Error('지원하지 않는 압축 방식입니다 (' + e.method + ')'));
    return inflate(raw).then(function (ab) { return new TextDecoder('utf-8').decode(ab); });
  }

  /* ─────────────────────────── 표 뽑기 ─────────────────────────── */

  /** 한 셀의 글자. <w:t> 조각을 잇고, 줄바꿈은 공백으로 만든다 */
  function cellText(cellXml) {
    var parts = [];
    var re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, m;
    while ((m = re.exec(cellXml))) parts.push(m[1]);
    var s = parts.join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, '&');
    // 셀 안 줄바꿈(<w:br/>)은 표에서는 한 줄로 본다
    return s.replace(/\s+/g, ' ').trim();
  }

  /**
   * 가로로 합쳐진 셀(gridSpan)은 **그 수만큼 칸을 채운다.**
   * 안 채우면 그 줄만 칸이 밀려 머리글과 값이 어긋난다.
   */
  function rowCells(rowXml) {
    var cells = [];
    var re = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g, m;
    while ((m = re.exec(rowXml))) {
      var inner = m[1];
      var span = 1;
      var g = /<w:gridSpan\s+w:val="(\d+)"/.exec(inner);
      if (g) span = Math.max(1, parseInt(g[1], 10) || 1);
      var t = cellText(inner);
      cells.push(t);
      for (var i = 1; i < span; i++) cells.push('');
    }
    return cells;
  }

  /** document.xml → 표 배열. 각 표는 줄 배열, 각 줄은 칸 배열 */
  function tablesFromXml(xml) {
    var tables = [];
    var tre = /<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/g, tm;
    while ((tm = tre.exec(xml))) {
      var rows = [];
      var rre = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g, rm;
      while ((rm = rre.exec(tm[1]))) rows.push(rowCells(rm[1]));
      if (rows.length) tables.push(rows);
    }
    return tables;
  }

  /** ArrayBuffer(.docx) → 표 배열 */
  function readTables(arrayBuffer) {
    return readXml(arrayBuffer, 'word/document.xml').then(function (xml) {
      if (!xml) throw new Error('word/document.xml 이 없습니다 (.docx 가 맞는지 확인하세요)');
      return tablesFromXml(xml);
    });
  }

  return { readTables: readTables, tablesFromXml: tablesFromXml,
           rowCells: rowCells, cellText: cellText, listEntries: listEntries };
});
