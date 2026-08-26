/**
 * j1939.js — J1939 CAN 규격 계산과 검증 (순수 함수. 화면·파일과 무관)
 *
 * 이 파일이 이 도구의 심장이다. 여기가 틀리면 정리된 엑셀 전체가 틀린다.
 * 그래서 **화면·파일 읽기와 완전히 분리**해 Node 에서 그대로 검사한다.
 *
 * ── 29비트 확장 CAN ID 구조 (J1939-21) ──────────────────────────────────
 *
 *    28 27 26 | 25  | 24 | 23 ............ 16 | 15 ............ 8 | 7 ..... 0
 *    우선순위  | EDP | DP |        PF         |        PS         |    SA
 *
 *   PF < 240 (PDU1, 특정 상대에게)  → PS 는 **목적지 주소(DA)** 이고 PGN 에 안 들어간다
 *   PF ≥ 240 (PDU2, 방송)          → PS 는 **그룹 확장(GE)** 이고 PGN 에 들어간다
 *
 *   이 구분을 놓치면 PDU1 메시지의 PGN 이 목적지마다 달라져 버린다.
 *   같은 메시지를 다른 것으로 세게 되므로 정리표가 통째로 어긋난다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.J1939 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** '0x18FEEE00' · '18FEEE00' · '18feee00h' · 419367936 → 숫자. 못 읽으면 null */
  function parseId(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? (v >>> 0) : null;
    var s = String(v).trim().replace(/\s|_/g, '');
    if (!s) return null;
    var m = /^0x([0-9a-f]+)$/i.exec(s) || /^([0-9a-f]+)h$/i.exec(s);
    if (m) return parseInt(m[1], 16) >>> 0;
    // 16진 글자(A~F)가 섞여 있으면 접두어가 없어도 16진으로 본다
    if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) return parseInt(s, 16) >>> 0;
    // 8자리 숫자만 있으면 CAN ID 표기로 보는 것이 관행이다 (예: 18FEEE00 → 여기선 위에서 걸림)
    if (/^\d+$/.test(s)) return parseInt(s, 10) >>> 0;
    return null;
  }

  /** ID 에서 각 자리를 뜯어낸다. 29비트를 넘으면 null */
  function decodeId(id) {
    var n = parseId(id);
    if (n === null || n > 0x1FFFFFFF) return null;
    var priority = (n >>> 26) & 0x7;
    var edp = (n >>> 25) & 0x1;
    var dp  = (n >>> 24) & 0x1;
    var pf  = (n >>> 16) & 0xFF;
    var ps  = (n >>> 8)  & 0xFF;
    var sa  = n & 0xFF;
    var pdu1 = pf < 240;
    // ⚠ PDU1 은 PS 를 PGN 에 넣지 않는다 — 넣으면 목적지마다 다른 메시지가 된다
    var pgn = (edp << 17) | (dp << 16) | (pf << 8) | (pdu1 ? 0 : ps);
    return {
      id: n, priority: priority, edp: edp, dp: dp, pf: pf, ps: ps, sa: sa,
      pdu: pdu1 ? 1 : 2,
      da: pdu1 ? ps : null,        // PDU1 일 때만 목적지 주소
      ge: pdu1 ? null : ps,        // PDU2 일 때만 그룹 확장
      pgn: pgn >>> 0
    };
  }

  /** PGN + 우선순위 + SA(+DA) 로 29비트 ID 를 만든다 */
  function buildId(pgn, priority, sa, da) {
    var p = Number(pgn);
    if (!Number.isFinite(p) || p < 0 || p > 0x3FFFF) return null;
    var pri = priority === undefined || priority === null ? 6 : Number(priority);
    if (!Number.isFinite(pri) || pri < 0 || pri > 7) return null;
    var s = sa === undefined || sa === null ? 0 : Number(sa);
    if (!Number.isFinite(s) || s < 0 || s > 255) return null;

    var edp = (p >>> 17) & 0x1;
    var dp  = (p >>> 16) & 0x1;
    var pf  = (p >>> 8) & 0xFF;
    var ps;
    if (pf < 240) {
      // PDU1 — PS 자리에는 목적지 주소가 들어간다. 안 주면 전역(0xFF).
      ps = da === undefined || da === null ? 0xFF : Number(da);
      if (!Number.isFinite(ps) || ps < 0 || ps > 255) return null;
    } else {
      ps = p & 0xFF;
    }
    return (((pri & 0x7) << 26) | (edp << 25) | (dp << 24) | (pf << 16) | (ps << 8) | s) >>> 0;
  }

  /* ── 표기 규칙 (기획서 사양) ─────────────────────────────────────────
       ID  : 16진수 7~8자리   예) 0x18F00401 · 0xCF00400
             앞자리 0 은 문서에서 흔히 빠진다(0CF00400 → CF00400).
             **읽을 때는 둘 다 받고, 적을 때는 8자리로 채워** 자릿수를 고르게 한다.
       PGN : 16진수 4자리     예) F004 · FEEE
             데이터 페이지가 1이면 5자리가 되므로 그때만 늘린다.
       SA  : 16진수 2자리     예) 21 · 44 · 5A                                */

  function hexId(n) {
    if (n === null || n === undefined) return '';
    return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }
  function hexPgn(n) {
    if (n === null || n === undefined) return '';
    var h = (n >>> 0).toString(16).toUpperCase();
    return h.padStart(h.length > 4 ? 5 : 4, '0');   // 접두어 없이 4자리 (기획서 예: E000)
  }
  function hexSa(n) {
    if (n === null || n === undefined || n === '') return '';
    var v = Number(n);
    if (!Number.isFinite(v)) return '';
    return (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');
  }

  /** '21' · '0x5A' · '5A' · 68 → 숫자. 사양서는 접두어 없이 2자리로 적는 일이 많다. */
  function parseSa(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? (v & 0xFF) : null;
    var s = String(v).trim().replace(/\s/g, '');
    if (!s) return null;
    var m = /^0x([0-9a-f]{1,2})$/i.exec(s) || /^([0-9a-f]{1,2})h$/i.exec(s);
    if (m) return parseInt(m[1], 16) & 0xFF;
    // ⚠ 접두어가 없으면 **16진으로 본다.** 기획서 예(21·44·5A)가 그 표기다.
    //    10진으로 읽으면 '21' 이 0x15 가 되어 ID 와 안 맞는다.
    if (/^[0-9a-f]{1,2}$/i.test(s)) return parseInt(s, 16) & 0xFF;
    return null;
  }

  /** PGN 표기 읽기 — 'F004' · '0xF004' · 61444(10진) 모두 받는다 */
  function parsePgn(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    var s = String(v).trim().replace(/\s|_/g, '');
    if (!s) return null;
    var m = /^0x([0-9a-f]+)$/i.exec(s) || /^([0-9a-f]+)h$/i.exec(s);
    if (m) return parseInt(m[1], 16);
    if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) return parseInt(s, 16);   // 글자가 섞이면 16진
    if (/^\d{1,5}$/.test(s)) {
      var d = parseInt(s, 10);
      // 기획서는 PGN 을 **16진 4자리**로 적는다. 'F004' 처럼 글자가 있으면 위에서 걸리고,
      // 숫자만 4자리면 어느 쪽인지 알 수 없다 — 16진으로 본다(사양서 표기가 그렇다).
      if (/^\d{4}$/.test(s)) return parseInt(s, 16);
      return d;
    }
    return null;
  }

  /** CAN 채널 — 1~3 중 하나(10진). 그 밖의 값은 받지 않는다. */
  function parseChannel(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = String(v).trim();
    var m = /(\d+)/.exec(s);           // 'CAN2' · 'ch 3' · '2번' 도 받는다
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return (n >= 1 && n <= 3) ? n : null;
  }

  /**
   * 사양서에 적힌 값들이 서로 맞는지 본다.
   *
   * 사양서는 ID 와 PGN 을 **둘 다** 적어 두는 일이 많다. 사람이 손으로 옮기다
   * 한쪽만 고치면 둘이 어긋나는데, 그대로 정리하면 틀린 표가 만들어진다.
   * 여기서 계산으로 맞춰 보고 어긋나면 알린다 — **고쳐 주지는 않는다.**
   * 어느 쪽이 맞는지는 사람이 원본을 봐야 안다.
   */
  function crossCheck(row) {
    var notes = [];
    var d = row.canId != null ? decodeId(row.canId) : null;

    if (row.canId != null && d === null) notes.push('CAN ID 를 읽을 수 없음');

    if (d && row.pgn != null) {
      var declared = Number(row.pgn);
      if (Number.isFinite(declared) && declared !== d.pgn) {
        notes.push('PGN 불일치 (ID 계산 ' + d.pgn + ' / 문서 ' + declared + ')');
      }
    }
    if (d && row.priority != null && row.priority !== '') {
      var pr = Number(row.priority);
      if (Number.isFinite(pr) && pr !== d.priority) {
        notes.push('우선순위 불일치 (ID 계산 ' + d.priority + ' / 문서 ' + pr + ')');
      }
    }
    if (d && row.sa != null && row.sa !== '') {
      var sa = Number(row.sa);
      if (Number.isFinite(sa) && sa !== d.sa) {
        notes.push('SA 불일치 (ID 계산 ' + d.sa + ' / 문서 ' + sa + ')');
      }
    }
    // 신호가 8바이트를 넘어가면 그 메시지에 담길 수 없다
    if (row.startBit != null && row.bitLength != null) {
      var sb = Number(row.startBit), bl = Number(row.bitLength);
      var dlc = row.dlc != null && row.dlc !== '' ? Number(row.dlc) : 8;
      if (Number.isFinite(sb) && Number.isFinite(bl) && Number.isFinite(dlc)) {
        if (sb < 1) notes.push('시작비트는 1부터 셉니다 (문서 ' + sb + ')');
        else if (sb - 1 + bl > dlc * 8) {
          notes.push('신호가 데이터 길이를 넘음 (' + sb + '비트에서 ' + bl + '비트 → ' + dlc + '바이트 초과)');
        }
      }
    }
    return notes;
  }

  /** '100ms' · '100 msec' · '0.1s' · '주기 500' → 밀리초 숫자. 못 읽으면 null */
  function parsePeriod(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    var s = String(v).trim().toLowerCase().replace(/,/g, '');
    if (/on\s*(request|demand)|요청\s*시|비주기|이벤트|event/.test(s)) return 0;  // 0 = 요청 시
    var m = /(-?[\d.]+)\s*([a-z가-힣]*)/.exec(s);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    // ⚠ 단위는 **숫자 바로 뒤 글자**로 본다.
    //    `\bs\b` 같은 낱말 경계로 찾으면 '0.1s' 를 놓친다 —
    //    's' 앞이 숫자라 경계가 서지 않기 때문이다. 그러면 0.1ms 로 읽혀 1만 배 틀린다.
    var unit = m[2] || '';
    var isMs  = /^(ms|msec|밀리초)/.test(unit);
    var isSec = !isMs && /^(s|sec|secs|second|seconds|초)$/.test(unit);
    if (isSec) n = n * 1000;
    return n;
  }

  /** 바이트 순서 표기를 한 가지로 모은다 */
  function normalizeByteOrder(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return '';
    if (/intel|little/.test(s)) return 'Intel';
    if (/motorola|big/.test(s)) return 'Motorola';
    return String(v).trim();
  }

  /* ══════════════════════ 있는 것으로 없는 것을 채운다 ══════════════════════

     현장 사양서에는 다섯 가지가 다 있는 일이 드물다.
     **보통 ID 나 PGN 중 하나만** 적혀 있다.

     ID 가 PGN 보다 상위다 — ID 안에 PGN 이 들어 있다.
     그래서 ID 가 있으면 PGN·SA·우선순위를 **계산으로** 얻는다.
     반대로 PGN 만 있으면 ID 는 만들 수 없다. 우선순위와 SA 를 모르기 때문이다.
     그때는 **비워 둔다.** 기본값 6 을 넣어 그럴듯한 ID 를 지어내면,
     나중에 그 값을 실제 사양으로 믿고 쓰게 된다.

     채운 값은 `from` 에 어디서 왔는지 남긴다 —
     문서에 적혀 있던 값과 계산해 낸 값은 신뢰도가 다르다.
     ────────────────────────────────────────────────────────────────────── */

  function complete(raw) {
    var r = {
      canId: null, pgn: null, channel: null, sa: null, period: null,
      priority: null, da: null, pdu: null
    };
    var from = {};      // 항목 → '문서' | '계산'
    var notes = [];

    var id = raw.canId != null && raw.canId !== '' ? parseId(raw.canId) : null;
    if (raw.canId != null && raw.canId !== '' && id === null) {
      notes.push('CAN ID 를 읽을 수 없음: ' + String(raw.canId).slice(0, 24));
    }
    var d = id !== null ? decodeId(id) : null;
    if (id !== null && d === null) notes.push('CAN ID 가 29비트를 넘음: ' + hexId(id));

    /* ── ID ─────────────────────────────────────────── */
    if (d) { r.canId = d.id; from.canId = '문서'; r.pdu = d.pdu; }

    /* ── PGN ── 문서 값이 있으면 그것을 쓰고, ID 계산값과 어긋나면 알린다 */
    var docPgn = parsePgn(raw.pgn);
    if (d && docPgn !== null && docPgn !== d.pgn) {
      notes.push('PGN 불일치 (ID 계산 ' + hexPgn(d.pgn) + ' / 문서 ' + hexPgn(docPgn) + ')');
      r.pgn = docPgn; from.pgn = '문서';       // 고쳐 주지 않는다 — 사람이 원본을 봐야 안다
    } else if (d) {
      r.pgn = d.pgn; from.pgn = docPgn !== null ? '문서' : '계산';
    } else if (docPgn !== null) {
      r.pgn = docPgn; from.pgn = '문서';
    }

    /* ── SA ── ID 가 있으면 그 안에 들어 있다 */
    var docSa = parseSa(raw.sa);
    if (d && docSa !== null && docSa !== d.sa) {
      notes.push('SA 불일치 (ID 계산 ' + hexSa(d.sa) + ' / 문서 ' + hexSa(docSa) + ')');
      r.sa = docSa; from.sa = '문서';
    } else if (d) {
      r.sa = d.sa; from.sa = docSa !== null ? '문서' : '계산';
    } else if (docSa !== null) {
      r.sa = docSa; from.sa = '문서';
    }

    /* ── 우선순위·목적지 ── ID 에서만 나온다 */
    if (d) {
      r.priority = d.priority; from.priority = '계산';
      if (d.da !== null) { r.da = d.da; from.da = '계산'; }
    }
    var docPri = raw.priority;
    if (d && docPri != null && docPri !== '' && Number(docPri) !== d.priority) {
      notes.push('우선순위 불일치 (ID 계산 ' + d.priority + ' / 문서 ' + docPri + ')');
    }

    /* ── 채널·주기 ── 문서에만 있다. 계산으로 얻을 수 없다. */
    r.channel = parseChannel(raw.channel);
    if (r.channel !== null) from.channel = '문서';
    else if (raw.channel != null && raw.channel !== '') {
      notes.push('CAN 채널이 1~3 이 아님: ' + String(raw.channel).slice(0, 16));
    }

    r.period = parsePeriod(raw.period);
    if (r.period !== null) from.period = '문서';

    /* ── 정리에 꼭 필요한 것이 없으면 알린다 ── */
    if (r.canId === null && r.pgn === null) {
      notes.push('ID·PGN 이 둘 다 없음 — 어느 메시지인지 알 수 없음');
    }

    // 신호 자리 검사는 있을 때만
    notes = notes.concat(crossCheck({
      startBit: raw.startBit, bitLength: raw.bitLength, dlc: raw.dlc
    }));

    return { value: r, from: from, notes: notes };
  }

  return {
    parseId: parseId, decodeId: decodeId, buildId: buildId,
    parsePgn: parsePgn, parseSa: parseSa, parseChannel: parseChannel,
    hexId: hexId, hexPgn: hexPgn, hexSa: hexSa,
    crossCheck: crossCheck, parsePeriod: parsePeriod,
    normalizeByteOrder: normalizeByteOrder,
    complete: complete
  };
});
