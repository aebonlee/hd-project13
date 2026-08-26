/**
 * mapping.js — 업체마다 다른 열 이름을 **같은 자리**로 모은다
 *
 * 전장품 사양서는 업체마다 양식이 다르다.
 * 같은 값을 두고 「CAN ID」·「Identifier」·「메시지 ID」로 제각각 적는다.
 * 그 차이를 여기서만 흡수하고, 나머지 코드는 정해진 이름 하나만 쓴다.
 *
 * ⚠ 못 알아본 열은 **끌어다 붙이지 않는다.** 엉뚱한 열을 CAN ID 로 잘못 보면
 *   표 전체가 조용히 틀린다. 빈칸으로 두고 「검토필요」로 알리는 편이 낫다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CanMapping = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 정리표의 열 — 이 순서가 곧 엑셀 열 순서다 */
  /* 앞의 다섯은 **기획서가 정한 정리 대상**이다 (ID · PGN · 채널 · SA · 주기).
     나머지는 사양서에 있으면 함께 담는 부가 정보다. */
  var COLUMNS = [
    { key: 'model',      label: '모델' },
    { key: 'ecu',        label: '전장품' },
    { key: 'message',    label: '메시지명' },
    { key: 'canId',      label: 'ID' },              // 16진 7~8자리
    { key: 'pgn',        label: 'PGN' },             // 16진 4자리
    { key: 'channel',    label: 'CAN Channel' },     // 1~3
    { key: 'sa',         label: 'Source Address' },  // 16진 2자리
    { key: 'period',     label: 'Period(ms)' },
    { key: 'priority',   label: '우선순위' },
    { key: 'da',         label: 'DA' },
    { key: 'pdu',        label: 'PDU' },
    { key: 'dlc',        label: '길이(byte)' },
    { key: 'spn',        label: 'SPN' },
    { key: 'signal',     label: '신호명' },
    { key: 'startBit',   label: '시작비트' },
    { key: 'bitLength',  label: '비트길이' },
    { key: 'resolution', label: '분해능' },
    { key: 'offset',     label: '오프셋' },
    { key: 'unit',       label: '단위' },
    { key: 'range',      label: '범위' },
    { key: 'byteOrder',  label: '바이트순서' },
    { key: 'source',     label: '출처파일' },
    { key: 'sheet',      label: '출처위치' },
    { key: 'derived',    label: '계산으로 채운 항목' },
    { key: 'review',     label: '검토필요' }
  ];

  /**
   * 열 이름 후보. 위에 있는 것부터 맞춰 본다 —
   * 「PGN」이 「PGN 설명」보다 먼저 걸려야 하므로 **긴 것·구체적인 것을 앞에** 둔다.
   */
  var ALIASES = {
    canId:      ['can id', 'canid', 'can-id', 'identifier', 'id(hex)', 'can 식별자',
                 '메시지 id', '메시지id', 'msg id', 'arbitration id', 'frame id', 'id'],
    pgn:        ['pgn(dec)', 'pgn(hex)', 'pgn 번호', 'pgn no', 'pgn', 'parameter group number'],
    channel:    ['can channel', 'can ch', 'channel', 'ch', 'bus', 'can bus', 'can 채널',
                 '채널', '캔채널', '버스'],
    priority:   ['priority', 'prio', '우선순위', '우선 순위', 'p'],
    sa:         ['source address', 'src addr', 'sa', '송신주소', '소스주소', '발신주소'],
    da:         ['destination address', 'dest addr', 'da', '목적지주소', '수신주소'],
    period:     ['cycle time', 'cycletime', 'repetition rate', 'tx rate', 'period',
                 'interval', '주기', '전송주기', '송신주기', '전송 주기', 'rate'],
    dlc:        ['dlc', 'data length', 'length(byte)', '데이터길이', '데이터 길이', '길이(byte)'],
    spn:        ['spn', 'suspect parameter number', 'spn 번호'],
    signal:     ['signal name', 'signal', 'parameter name', 'parameter', '신호명', '신호 이름',
                 '파라미터명', '파라미터 명', '신호', '데이터명'],
    message:    ['message name', 'message', 'pg name', 'pg label', '메시지명', '메시지 이름',
                 '메시지', 'acronym'],
    startBit:   ['start bit', 'startbit', 'start position', 'start byte/bit', 'bit position',
                 'start', '시작비트', '시작 비트', '시작위치', '비트위치'],
    bitLength:  ['bit length', 'bitlength', 'length(bit)', 'length (bits)', 'bits', 'size',
                 'length', '비트길이', '비트 길이', '길이(bit)', '데이터크기'],
    resolution: ['resolution', 'scaling', 'scale', 'factor', 'lsb', '분해능', '해상도', '단위당값'],
    offset:     ['offset', '오프셋', '옵셋'],
    unit:       ['unit', 'units', '단위'],
    range:      ['range', 'data range', 'valid range', '범위', '유효범위'],
    byteOrder:  ['byte order', 'byteorder', 'endian', 'endianness', '바이트순서', '바이트 순서', '정렬'],
    ecu:        ['ecu', 'node', 'device', 'controller', '전장품', '부품', '장치', '노드'],
    model:      ['model', 'machine', '모델', '장비', '기종', '차종']
  };

  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/ /g, ' ')          // 문서에서 오는 줄바꿈 없는 공백
      .replace(/[\[\]()（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().toLowerCase();
  }

  /** 머리글 한 줄 → { 열이름: 몇 번째 칸 }. 못 알아본 열은 아예 넣지 않는다. */
  function mapHeader(cells) {
    var used = {};      // 한 칸이 두 열로 쓰이지 않게
    var out = {};
    var normd = (cells || []).map(norm);

    Object.keys(ALIASES).forEach(function (key) {
      for (var a = 0; a < ALIASES[key].length; a++) {
        // ⚠ 후보 이름도 **같은 방식으로 다듬어** 견준다.
        //    셀은 다듬고 후보는 그대로 두면 '길이(bit)' 가 '길이 bit' 와 안 맞는다.
        //    괄호가 든 이름이 통째로 안 잡혀 그 열이 조용히 비어 버렸다.
        var alias = norm(ALIASES[key][a]);
        for (var i = 0; i < normd.length; i++) {
          if (used[i] || !normd[i]) continue;
          var c = normd[i];
          // 정확히 같거나, 이름이 그 칸에 낱말로 들어 있을 때만 인정한다.
          // 부분 일치를 아무렇게나 허용하면 'id' 가 'valid range' 에 걸린다.
          var hit = c === alias ||
            new RegExp('(^|[^a-z0-9가-힣])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                       + '([^a-z0-9가-힣]|$)').test(c);
          if (hit) { out[key] = i; used[i] = true; return; }
        }
      }
    });
    return out;
  }

  /** 표에서 머리글 줄이 몇 번째인지 찾는다. 위에 제목·작성일이 몇 줄 있어도 된다. */
  function findHeaderRow(rows, opts) {
    var need = (opts && opts.minKeys) || 3;
    var limit = Math.min(rows.length, (opts && opts.scan) || 30);
    var best = null;
    for (var i = 0; i < limit; i++) {
      var map = mapHeader(rows[i] || []);
      var n = Object.keys(map).length;
      // CAN ID 나 PGN 이 없으면 CAN 사양표로 보지 않는다 —
      // 신호명·단위만 있는 표는 다른 표일 가능성이 크다
      var anchored = map.canId !== undefined || map.pgn !== undefined;
      if (n >= need && anchored && (!best || n > best.count)) {
        best = { index: i, map: map, count: n };
      }
    }
    return best;
  }

  return { COLUMNS: COLUMNS, ALIASES: ALIASES, mapHeader: mapHeader, findHeaderRow: findHeaderRow, norm: norm };
});
