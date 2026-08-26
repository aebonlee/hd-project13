/**
 * extract.js — 세 형식(엑셀·워드·PDF)에서 **CAN 사양표**만 찾아 표준 행으로 만든다
 *
 * 형식마다 읽는 방법은 다르지만, 그 뒤는 전부 같다 —
 *   ① 표(줄×칸)로 만든다
 *   ② 머리글 줄을 찾는다 (mapping.js)
 *   ③ 한 줄씩 표준 항목으로 옮기고 ID·PGN 을 서로 채운다 (j1939.js)
 * 그래서 형식별 코드는 ①만 담당하고 나머지는 공유한다.
 *
 * ⚠ 파일은 서버로 보내지 않는다. 읽기도 엑셀 만들기도 전부 브라우저 안에서 끝난다.
 *   사내 사양서를 다루는 도구라 이 점이 중요하다.
 */
(function (root) {
  'use strict';

  var M = root.CanMapping, J = root.J1939;

  /** 표 하나에서 CAN 사양 행을 뽑는다. 사양표가 아니면 null */
  function rowsFromTable(table, ctx) {
    var hit = M.findHeaderRow(table);
    if (!hit) return null;
    var map = hit.map;
    var out = [];
    for (var i = hit.index + 1; i < table.length; i++) {
      var cells = table[i] || [];
      // 빈 줄·소계 줄은 건너뛴다
      var filled = cells.filter(function (c) { return String(c == null ? '' : c).trim() !== ''; });
      if (filled.length < 2) continue;

      var raw = {};
      Object.keys(map).forEach(function (k) { raw[k] = cells[map[k]]; });
      // 머리글이 반복해서 나오는 표가 있다 — 값 줄이 아니면 건너뛴다
      if (M.norm(raw.canId) === 'id' || M.norm(raw.pgn) === 'pgn') continue;

      var c = J.complete(raw);
      var derived = Object.keys(c.from).filter(function (k) { return c.from[k] === '계산'; });

      out.push({
        model: raw.model || ctx.model || '',
        ecu: raw.ecu || ctx.ecu || '',
        message: raw.message || '',
        canId: c.value.canId, pgn: c.value.pgn, channel: c.value.channel,
        sa: c.value.sa, period: c.value.period,
        priority: c.value.priority, da: c.value.da, pdu: c.value.pdu,
        dlc: raw.dlc, spn: raw.spn, signal: raw.signal,
        startBit: raw.startBit, bitLength: raw.bitLength,
        resolution: raw.resolution, offset: raw.offset,
        unit: raw.unit, range: raw.range,
        byteOrder: J.normalizeByteOrder(raw.byteOrder),
        source: ctx.source, sheet: ctx.sheet || '',
        derived: derived.join(', '),
        review: c.notes.length ? c.notes.join(' · ') : ''
      });
    }
    return out.length ? out : null;
  }

  /* ─────────────────────────── 엑셀 ─────────────────────────── */

  function fromXlsx(bytes, fileName) {
    var wb = XLSX.read(bytes, { type: 'array' });
    var rows = [], skipped = [];
    wb.SheetNames.forEach(function (name) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      var got = rowsFromTable(aoa, { source: fileName, sheet: name });
      if (got) rows = rows.concat(got);
      else skipped.push(name);
    });
    return { rows: rows, skipped: skipped };
  }

  /* ─────────────────────────── 워드 ─────────────────────────── */

  function fromDocx(arrayBuffer, fileName) {
    return root.ReadDocx.readTables(arrayBuffer).then(function (tables) {
      var rows = [], skipped = [];
      tables.forEach(function (t, i) {
        var got = rowsFromTable(t, { source: fileName, sheet: '표 ' + (i + 1) });
        if (got) rows = rows.concat(got);
        else skipped.push('표 ' + (i + 1));
      });
      return { rows: rows, skipped: skipped };
    });
  }

  /* ─────────────────────────── PDF ─────────────────────────── */

  /**
   * PDF 에는 표 구조가 없다. 글자와 그 **좌표**만 있다.
   * 그래서 y 가 비슷한 것끼리 한 줄로 묶고, x 로 칸을 가른다.
   * 칸 경계는 머리글 줄의 x 위치에서 가져온다 — 사양서 표는 열이 세로로 정렬돼 있다.
   */
  function pdfItemsToTable(items) {
    // 한 줄로 묶기 (y 오차 2pt 이내)
    var lines = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = Math.round(it.transform[5] * 2) / 2;
      var line = null;
      for (var i = 0; i < lines.length; i++) {
        if (Math.abs(lines[i].y - y) <= 2) { line = lines[i]; break; }
      }
      if (!line) { line = { y: y, items: [] }; lines.push(line); }
      line.items.push({ x: it.transform[4], s: it.str.trim() });
    });
    lines.sort(function (a, b) { return b.y - a.y; });          // 위에서 아래로
    lines.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); });

    // 머리글 줄 찾기 — 각 줄을 칸 배열로 보고 mapping 에 물어본다
    var asCells = lines.map(function (l) { return l.items.map(function (i) { return i.s; }); });
    var hit = M.findHeaderRow(asCells);
    if (!hit) return null;

    // 머리글의 x 위치를 칸 경계로 삼는다
    var bounds = lines[hit.index].items.map(function (i) { return i.x; });
    function bucket(x) {
      var k = 0;
      for (var i = 0; i < bounds.length; i++) {
        // 경계보다 살짝 왼쪽에서 시작하는 값도 그 칸으로 본다
        if (x >= bounds[i] - 6) k = i; else break;
      }
      return k;
    }
    return lines.map(function (l) {
      var cells = new Array(bounds.length).fill('');
      l.items.forEach(function (it) {
        var k = bucket(it.x);
        cells[k] = cells[k] ? cells[k] + ' ' + it.s : it.s;
      });
      return cells;
    });
  }

  /**
   * @param cMapUrl CMap 폴더 주소.
   *   ⚠ 이것을 주지 않으면 한글 라벨이 **빈 문자열**로 나온다.
   *     내장되지 않은 CID 글꼴로 그린 사양서가 흔하고, 그러면 머리글을 못 찾아
   *     "표가 없다"고 나온다 — 원인을 찾기 어려운 유형이다.
   *   (여기서 import.meta.url 을 쓸 수 없다. 이 파일은 일반 스크립트라
   *    모듈 문법이 들어가면 브라우저가 통째로 못 읽는다. 그래서 밖에서 받는다)
   */
  function fromPdf(arrayBuffer, fileName, pdfjs, cMapUrl) {
    return pdfjs.getDocument({
      data: arrayBuffer,
      cMapUrl: cMapUrl,
      cMapPacked: true
    }).promise.then(function (doc) {
      var jobs = [];
      for (var p = 1; p <= doc.numPages; p++) {
        jobs.push(doc.getPage(p).then(function (page) {
          return page.getTextContent().then(function (tc) { return tc.items; });
        }));
      }
      return Promise.all(jobs).then(function (pages) {
        var rows = [], skipped = [];
        pages.forEach(function (items, i) {
          var table = pdfItemsToTable(items);
          var got = table ? rowsFromTable(table, { source: fileName, sheet: (i + 1) + '쪽' }) : null;
          if (got) rows = rows.concat(got);
          else skipped.push((i + 1) + '쪽');
        });
        doc.destroy();
        return { rows: rows, skipped: skipped };
      });
    });
  }

  root.CanExtract = {
    rowsFromTable: rowsFromTable,
    fromXlsx: fromXlsx, fromDocx: fromDocx, fromPdf: fromPdf,
    pdfItemsToTable: pdfItemsToTable
  };
})(typeof self !== 'undefined' ? self : this);
