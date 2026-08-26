/**
 * 단위 테스트 — 실행: node test/logic.test.js
 *
 * 검사 대상은 **정리표의 값이 맞는가**다. 화면이 예쁜지는 여기서 안 본다.
 * 실제 J1939 표준 메시지의 알려진 값으로 맞춰 본다 —
 * 내가 만든 계산으로 내 계산을 검사하면 아무것도 증명되지 않는다.
 */
'use strict';
const assert = require('assert');
const J = require('../js/j1939.js');
const M = require('../js/mapping.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.error('  ✘ ' + name); console.error('    ' + e.message); }
}

/* ═══════════════════ ID ↔ PGN — 표준 메시지로 대조 ═══════════════════
   아래 값은 J1939-71 에 정의된 실제 메시지다. 임의로 만든 값이 아니다. */

const KNOWN = [
  // ID,          PGN,   이름,                     우선순위, SA,  PDU
  ['0x18FEEE00', 65262, 'ET1 엔진 온도 1',            6,   0,   2],
  ['0x0CF00400', 61444, 'EEC1 전자엔진제어 1',         3,   0,   2],
  ['0x18FEF100', 65265, 'CCVS 순항제어·차속',          6,   0,   2],
  ['0x18FEE500', 65253, 'HOURS 엔진 가동시간',         6,   0,   2],
  ['0x18FEF200', 65266, 'LFE 연료 소비',              6,   0,   2],
  ['0x0CF00300', 61443, 'EEC2 전자엔진제어 2',         3,   0,   2],
  ['0x18FECA00', 65226, 'DM1 활성 진단코드',           6,   0,   2],
];

test('알려진 J1939 메시지의 ID 에서 PGN 이 나온다', () => {
  for (const [id, pgn, name, pri, sa, pdu] of KNOWN) {
    const d = J.decodeId(id);
    assert.ok(d, id + ' 를 읽지 못했다');
    assert.strictEqual(d.pgn, pgn, name + ' PGN (계산 ' + d.pgn + ' ≠ ' + pgn + ')');
    assert.strictEqual(d.priority, pri, name + ' 우선순위');
    assert.strictEqual(d.sa, sa, name + ' SA');
    assert.strictEqual(d.pdu, pdu, name + ' PDU 형식');
  }
});

test('PGN 에서 ID 를 되만들면 원래 ID 가 나온다 (왕복)', () => {
  for (const [id, pgn, name, pri, sa] of KNOWN) {
    const back = J.buildId(pgn, pri, sa);
    assert.strictEqual(J.hexId(back), id.toUpperCase().replace('0X', '0x'),
      name + ' 왕복 실패: ' + J.hexId(back));
  }
});

test('★ PDU1 은 PS 를 PGN 에 넣지 않는다 — 목적지가 달라도 같은 메시지다', () => {
  // TP.CM (PGN 60416 = 0xEC00) 은 PF=0xEC=236 < 240 → PDU1
  const toA = J.decodeId('0x1CEC1122');   // 목적지 0x11, 송신 0x22
  const toB = J.decodeId('0x1CEC9922');   // 목적지 0x99, 송신 0x22
  assert.strictEqual(toA.pdu, 1);
  assert.strictEqual(toA.pgn, 60416, 'PDU1 PGN 이 틀림: ' + toA.pgn);
  assert.strictEqual(toB.pgn, 60416, '목적지가 바뀌었는데 PGN 이 달라졌다');
  assert.strictEqual(toA.da, 0x11);
  assert.strictEqual(toB.da, 0x99);
  // PDU2 는 반대로 PS 가 PGN 에 들어간다
  const p2 = J.decodeId('0x18FEEE00');
  assert.strictEqual(p2.pdu, 2);
  assert.strictEqual(p2.ge, 0xEE);
});

test('PDU1 을 되만들 때 목적지를 안 주면 전역(0xFF)', () => {
  const id = J.buildId(60416, 7, 0x22);
  assert.strictEqual(J.hexId(id), '0x1CECFF22');
});

test('ID 표기가 여러 가지여도 읽는다', () => {
  const want = 0x18FEEE00;
  for (const v of ['0x18FEEE00', '18FEEE00', '18feee00', '18FEEE00h', ' 0X18FEEE00 ']) {
    assert.strictEqual(J.parseId(v), want, '읽지 못함: ' + JSON.stringify(v));
  }
  assert.strictEqual(J.parseId(''), null);
  assert.strictEqual(J.parseId('없음'), null);
});

test('29비트를 넘는 값은 받지 않는다', () => {
  assert.strictEqual(J.decodeId('0xFFFFFFFF'), null, '32비트 값이 통과했다');
  assert.ok(J.decodeId('0x1FFFFFFF'), '29비트 최대값은 통과해야 한다');
});

/* ═══════════════════ 어긋난 사양서 잡아내기 ═══════════════════ */

test('★ 문서의 PGN 이 ID 와 어긋나면 알린다 — 고쳐 주지는 않는다', () => {
  const n = J.crossCheck({ canId: '0x18FEEE00', pgn: 65263 });   // 실제는 65262
  assert.strictEqual(n.length, 1);
  assert.ok(/PGN 불일치/.test(n[0]), n[0]);
  assert.ok(/65262/.test(n[0]) && /65263/.test(n[0]), '양쪽 값을 다 보여 줘야 한다: ' + n[0]);
});

test('우선순위·SA 가 어긋나도 각각 알린다', () => {
  const n = J.crossCheck({ canId: '0x18FEEE00', priority: 3, sa: 16 });
  assert.strictEqual(n.length, 2, n.join(' / '));
  assert.ok(n.some(x => /우선순위 불일치/.test(x)));
  assert.ok(n.some(x => /SA 불일치/.test(x)));
});

test('맞는 사양서는 아무 말도 하지 않는다', () => {
  assert.deepStrictEqual(
    J.crossCheck({ canId: '0x18FEEE00', pgn: 65262, priority: 6, sa: 0 }), []);
});

test('신호가 데이터 길이를 넘으면 잡는다', () => {
  // 8바이트 = 64비트. 60번째 비트에서 8비트면 67비트까지 → 넘는다
  const n = J.crossCheck({ startBit: 60, bitLength: 8, dlc: 8 });
  assert.strictEqual(n.length, 1);
  assert.ok(/데이터 길이를 넘음/.test(n[0]), n[0]);
  // 딱 맞는 것은 통과
  assert.deepStrictEqual(J.crossCheck({ startBit: 57, bitLength: 8, dlc: 8 }), []);
});

test('시작비트를 0부터 센 문서를 잡는다', () => {
  // J1939 문서는 1부터 센다. 0이 오면 다른 규칙으로 적은 것이라 그대로 쓰면 한 칸씩 밀린다
  const n = J.crossCheck({ startBit: 0, bitLength: 8, dlc: 8 });
  assert.ok(n.some(x => /1부터/.test(x)), n.join(' / '));
});

/* ═══════════ 기획서 표기 규칙 (ID 7~8자리 · PGN 4자리 · SA 2자리) ═══════════ */

test('기획서 예시 ID 를 그대로 읽는다', () => {
  assert.strictEqual(J.parseId('0x18F00401'), 0x18F00401);
  assert.strictEqual(J.parseId('0xCF00400'), 0x0CF00400, '7자리(앞 0 생략) 을 못 읽었다');
  assert.strictEqual(J.parseId('CF00400'), 0x0CF00400);
});

test('PGN 은 16진 4자리로 적는다 — 접두어 없이', () => {
  assert.strictEqual(J.hexPgn(0xF004), 'F004');
  assert.strictEqual(J.hexPgn(0xE000), 'E000');
  assert.strictEqual(J.hexPgn(0xFDD8), 'FDD8');
});

test('PGN 표기를 여러 형태로 읽는다', () => {
  for (const v of ['F004', '0xF004', 'f004', 'F004h']) {
    assert.strictEqual(J.parsePgn(v), 0xF004, v);
  }
  // 숫자 4자리는 사양서 표기대로 16진으로 본다
  assert.strictEqual(J.parsePgn('E000'), 0xE000);
});

test('SA 는 접두어 없는 16진 2자리다 — 10진으로 읽으면 안 된다', () => {
  assert.strictEqual(J.parseSa('21'), 0x21, "'21' 을 10진 21 로 읽었다");
  assert.strictEqual(J.parseSa('44'), 0x44);
  assert.strictEqual(J.parseSa('5A'), 0x5A);
  assert.strictEqual(J.hexSa(0x5A), '5A');
  assert.strictEqual(J.hexSa(1), '01', '한 자리는 0 을 채워야 한다');
});

test('CAN 채널은 1~3 만 받는다', () => {
  assert.strictEqual(J.parseChannel('2'), 2);
  assert.strictEqual(J.parseChannel('CAN3'), 3);
  assert.strictEqual(J.parseChannel('1번'), 1);
  assert.strictEqual(J.parseChannel('0'), null, '0 은 채널이 아니다');
  assert.strictEqual(J.parseChannel('4'), null, '4 는 채널이 아니다');
  assert.strictEqual(J.parseChannel(''), null);
});

/* ═══════════ ★ 하나만 있어도 정리된다 (기획 핵심) ═══════════ */

test('★ ID 만 있으면 PGN·SA·우선순위를 계산해 채운다', () => {
  const r = J.complete({ canId: '0x18F00401' });
  assert.strictEqual(J.hexPgn(r.value.pgn), 'F004');
  assert.strictEqual(J.hexSa(r.value.sa), '01');
  assert.strictEqual(r.value.priority, 6);
  assert.strictEqual(r.from.pgn, '계산', '계산해 낸 값임을 표시해야 한다');
  assert.strictEqual(r.from.canId, '문서');
  assert.deepStrictEqual(r.notes, []);
});

test('★ PGN 만 있으면 ID 를 지어내지 않는다', () => {
  const r = J.complete({ pgn: 'F004', sa: '21' });
  assert.strictEqual(r.value.pgn, 0xF004);
  assert.strictEqual(J.hexSa(r.value.sa), '21');
  // 우선순위를 모르므로 ID 는 만들 수 없다. 기본값 6 을 넣어 지어내면
  // 나중에 그 값을 실제 사양으로 믿고 쓰게 된다.
  assert.strictEqual(r.value.canId, null, 'ID 를 지어냈다');
  assert.strictEqual(r.value.priority, null);
});

test('★ ID·PGN 이 둘 다 없으면 알린다', () => {
  const r = J.complete({ channel: '1', period: '100ms' });
  assert.ok(r.notes.some(n => /둘 다 없음/.test(n)), r.notes.join(' / '));
});

test('ID 와 문서 PGN 이 어긋나면 문서 값을 두고 알린다', () => {
  const r = J.complete({ canId: '0x18F00401', pgn: 'F005' });
  assert.ok(r.notes.some(n => /PGN 불일치/.test(n)), r.notes.join(' / '));
  assert.strictEqual(r.value.pgn, 0xF005, '문서 값을 남겨야 사람이 원본과 대조할 수 있다');
  assert.strictEqual(r.from.pgn, '문서');
});

test('ID 와 문서 SA 가 어긋나도 알린다', () => {
  const r = J.complete({ canId: '0x18F00401', sa: '21' });   // ID 안의 SA 는 01
  assert.ok(r.notes.some(n => /SA 불일치/.test(n)), r.notes.join(' / '));
});

test('채널이 1~3 밖이면 비우고 알린다', () => {
  const r = J.complete({ canId: '0x18F00401', channel: '7' });
  assert.strictEqual(r.value.channel, null);
  assert.ok(r.notes.some(n => /채널/.test(n)), r.notes.join(' / '));
});

test('다섯 항목이 다 있는 사양은 그대로 통과한다', () => {
  const r = J.complete({ canId: '0x18F00401', pgn: 'F004', channel: '1', sa: '01', period: '100ms' });
  assert.deepStrictEqual(r.notes, [], r.notes.join(' / '));
  assert.strictEqual(J.hexId(r.value.canId), '0x18F00401');
  assert.strictEqual(J.hexPgn(r.value.pgn), 'F004');
  assert.strictEqual(r.value.channel, 1);
  assert.strictEqual(J.hexSa(r.value.sa), '01');
  assert.strictEqual(r.value.period, 100);
});

/* ═══════════════════ 주기 읽기 ═══════════════════ */

test('주기 표기가 제각각이어도 밀리초로 모은다', () => {
  const cases = [['100ms',100], ['100 msec',100], ['100',100], ['0.1s',100],
                 ['1 s',1000], ['1초',1000], ['50 밀리초',50], ['1,000ms',1000]];
  for (const [inp, want] of cases) {
    assert.strictEqual(J.parsePeriod(inp), want, inp + ' → ' + J.parsePeriod(inp));
  }
});

test('요청 시 전송은 0 으로 구분한다 — 빈칸과 다르다', () => {
  for (const v of ['On Request', 'on request', '요청 시', '비주기', 'Event']) {
    assert.strictEqual(J.parsePeriod(v), 0, v);
  }
  assert.strictEqual(J.parsePeriod(''), null, '빈칸은 null 이어야 한다');
  assert.strictEqual(J.parsePeriod('미정'), null);
});

test('바이트 순서 표기를 한 가지로 모은다', () => {
  ['Intel','intel','little endian','Little-Endian'].forEach(v =>
    assert.strictEqual(J.normalizeByteOrder(v), 'Intel', v));
  ['Motorola','big endian','BIG'].forEach(v =>
    assert.strictEqual(J.normalizeByteOrder(v), 'Motorola', v));
  assert.strictEqual(J.normalizeByteOrder(''), '');
});

/* ═══════════════════ 열 이름 맞추기 ═══════════════════ */

test('업체마다 다른 열 이름을 같은 자리로 모은다', () => {
  const head = ['메시지명','CAN ID','PGN','주기(ms)','SPN','신호명','Start Bit','길이(bit)','분해능','단위'];
  const map = M.mapHeader(head);
  assert.strictEqual(map.message, 0);
  assert.strictEqual(map.canId, 1);
  assert.strictEqual(map.pgn, 2);
  assert.strictEqual(map.period, 3);
  assert.strictEqual(map.spn, 4);
  assert.strictEqual(map.signal, 5);
  assert.strictEqual(map.startBit, 6);
  assert.strictEqual(map.bitLength, 7);
});

test('영문 사양서도 같은 자리로 모은다', () => {
  const head = ['Message','Identifier','PGN','Cycle Time','SPN','Signal Name','Start Position','Length','Resolution','Unit'];
  const map = M.mapHeader(head);
  assert.strictEqual(map.canId, 1, 'Identifier 를 CAN ID 로 못 봤다');
  assert.strictEqual(map.period, 3, 'Cycle Time 을 주기로 못 봤다');
  assert.strictEqual(map.startBit, 4 + 2, 'Start Position 을 시작비트로 못 봤다');
});

test('★ 머리글을 못 찾으면 추측하지 않는다', () => {
  const map = M.mapHeader(['가','나','다']);
  assert.strictEqual(Object.keys(map).length, 0, '엉뚱한 열을 끌어다 붙였다');
});

test('머리글 줄을 표에서 찾아낸다 — 위에 제목이 몇 줄 있어도', () => {
  const rows = [
    ['○○장비 CAN 사양서'], [], ['작성일', '2026-08-20'], [],
    ['메시지명','CAN ID','PGN','주기','SPN','신호명','시작비트','비트길이'],
    ['ET1','0x18FEEE00','65262','1000','110','냉각수온도','1','8'],
  ];
  const hit = M.findHeaderRow(rows);
  assert.strictEqual(hit.index, 4, '머리글 줄을 ' + hit.index + ' 로 봤다');
  assert.ok(hit.map.canId >= 0);
});

test('머리글이 아예 없으면 없다고 답한다', () => {
  assert.strictEqual(M.findHeaderRow([['가','나'],['1','2']]), null);
});

console.log('\n결과: ' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
