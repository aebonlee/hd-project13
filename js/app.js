/**
 * app.js — 화면
 *
 * 하는 일은 단순하다. 파일을 받아 형식별 추출기에 넘기고, 결과를 표로 보여 주고,
 * 엑셀로 내보낸다. **판정과 계산은 전부 j1939.js·mapping.js 가 한다** —
 * 여기서 또 계산하면 화면과 엑셀이 서로 다른 값을 말하게 된다.
 */
import * as pdfjs from '../lib/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.mjs';

const J = window.J1939, M = window.CanMapping, X = window.CanExtract;
const $ = (s) => document.querySelector(s);
const CMAP = new URL('../lib/cmaps/', import.meta.url).href;

let picked = [];
let rows = [];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function kindOf(name) {
  if (/\.xlsx?$/i.test(name)) return 'xlsx';
  if (/\.docx$/i.test(name)) return 'docx';
  if (/\.pdf$/i.test(name)) return 'pdf';
  return null;
}

function renderFiles() {
  $('#files').innerHTML = picked.map(f =>
    '<li><span>' + esc(f.name) + '</span><span>' +
    (kindOf(f.name) || '지원 안 함') + ' · ' +
    Math.round(f.size / 1024).toLocaleString() + ' KB</span></li>').join('');
  $('#run').disabled = picked.length === 0;
}

/* ───────────────────────────── 표 그리기 ───────────────────────────── */

function fmt(r, key) {
  switch (key) {
    case 'canId':  return r.canId == null ? '' : J.hexId(r.canId);
    case 'pgn':    return r.pgn == null ? '' : J.hexPgn(r.pgn);
    case 'sa':     return r.sa == null ? '' : J.hexSa(r.sa);
    case 'da':     return r.da == null ? '' : J.hexSa(r.da);
    case 'pdu':    return r.pdu == null ? '' : 'PDU' + r.pdu;
    case 'period': return r.period == null ? '' : (r.period === 0 ? '요청 시' : r.period);
    default:       return r[key] == null ? '' : r[key];
  }
}

const NUMERIC = ['channel', 'period', 'dlc', 'spn', 'startBit', 'bitLength', 'resolution', 'offset', 'priority'];
const MONO = ['canId', 'pgn', 'sa', 'da'];

function renderTable() {
  if (!rows.length) {
    $('#out').innerHTML = '<div class="warn"><b>CAN 사양표를 찾지 못했습니다.</b><br>' +
      '머리글에 <code>ID</code> 나 <code>PGN</code> 이 있는 표가 있어야 합니다. ' +
      '표가 아니라 문장으로 적힌 사양은 아직 읽지 못합니다.</div>';
    return;
  }
  const need = rows.filter(r => r.review).length;
  const derived = rows.filter(r => r.derived).length;
  const noId = rows.filter(r => r.canId == null).length;

  const cols = M.COLUMNS.filter(c => c.key !== 'derived');
  const head = cols.map(c => '<th>' + esc(c.label) + '</th>').join('');
  const body = rows.map(r => '<tr' + (r.review ? ' class="flag"' : '') + '>' +
    cols.map(c => {
      const v = fmt(r, c.key);
      const cls = (NUMERIC.includes(c.key) ? 'num ' : '') + (MONO.includes(c.key) ? 'mono ' : '') +
                  (c.key === 'review' ? 'rev' : '');
      // 계산으로 채운 값에는 표시를 단다
      const calc = r.derived && r.derived.split(', ').includes(c.key)
        ? '<span class="calc">계산</span>' : '';
      return '<td class="' + cls.trim() + '">' + esc(v) + calc + '</td>';
    }).join('') + '</tr>').join('');

  $('#out').innerHTML =
    '<h2>정리 결과</h2>' +
    '<div class="stats">' +
      '<div class="stat"><b>' + rows.length + '</b>행</div>' +
      '<div class="stat"><b>' + new Set(rows.map(r => r.source)).size + '</b>개 파일</div>' +
      '<div class="stat"><b>' + derived + '</b>행 계산 보완</div>' +
      '<div class="stat"><b>' + need + '</b>행 검토필요</div>' +
    '</div>' +
    (need
      ? '<div class="warn"><b>' + need + '행은 사람이 확인해야 합니다.</b> ' +
        '맨 오른쪽 「검토필요」에 무엇이 어긋났는지 적어 두었습니다. ' +
        '<b>고쳐서 채우지 않습니다</b> — 어느 쪽이 맞는지는 원본을 봐야 압니다.</div>'
      : '<div class="ok">어긋난 값이 없습니다.</div>') +
    (noId
      ? '<div class="note"><b>' + noId + '행은 ID 가 없습니다.</b> PGN 만 적힌 사양서입니다. ' +
        '우선순위와 SA 를 알 수 없어 ID 를 만들 수 없으므로 <b>비워 두었습니다</b> — ' +
        '그럴듯한 값을 지어내면 나중에 그것을 실제 사양으로 믿고 쓰게 됩니다.</div>'
      : '') +
    '<div class="tablewrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body +
    '</tbody></table></div>' +
    '<div class="btnrow"><button class="btn green" id="dl">엑셀로 내려받기</button></div>';

  $('#dl').addEventListener('click', downloadExcel);
}

/* ───────────────────────────── 엑셀 ───────────────────────────── */

function downloadExcel() {
  const cols = M.COLUMNS;
  const aoa = [cols.map(c => c.label)];
  rows.forEach(r => {
    aoa.push(cols.map(c => {
      const v = fmt(r, c.key);
      // 숫자는 **숫자로** 넣는다. 문자열로 넣으면 엑셀에서 정렬·필터가 안 먹는다.
      if (NUMERIC.includes(c.key) && v !== '' && v !== '요청 시') {
        const n = Number(String(v).replace(/,/g, ''));
        if (Number.isFinite(n)) return n;
      }
      return v;
    }));
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(c => ({ wch: Math.max(9, Math.min(34, c.label.length + 6)) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CAN 사양');
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  XLSX.writeFile(wb, 'CAN사양_정리_' + ymd + '.xlsx');
}

/* ───────────────────────────── 실행 ───────────────────────────── */

async function run() {
  const btn = $('#run');
  btn.disabled = true;
  $('#out').innerHTML = '';
  rows = [];
  const skippedAll = [];
  const failed = [];

  try {
    for (const f of picked) {
      btn.textContent = '읽는 중… ' + f.name;
      const kind = kindOf(f.name);
      try {
        if (kind === 'xlsx') {
          const r = X.fromXlsx(new Uint8Array(await f.arrayBuffer()), f.name);
          rows = rows.concat(r.rows); if (r.skipped.length) skippedAll.push(f.name + ': ' + r.skipped.join(', '));
        } else if (kind === 'docx') {
          const r = await X.fromDocx(await f.arrayBuffer(), f.name);
          rows = rows.concat(r.rows); if (r.skipped.length) skippedAll.push(f.name + ': ' + r.skipped.join(', '));
        } else if (kind === 'pdf') {
          const r = await X.fromPdf(await f.arrayBuffer(), f.name, pdfjs, CMAP);
          rows = rows.concat(r.rows); if (r.skipped.length) skippedAll.push(f.name + ': ' + r.skipped.join(', '));
        } else {
          failed.push(f.name + ' — 지원하지 않는 형식');
        }
      } catch (e) {
        failed.push(f.name + ' — ' + (e.message || e));
      }
    }
    renderTable();
    if (failed.length) {
      $('#out').insertAdjacentHTML('beforeend',
        '<div class="warn"><b>읽지 못한 파일</b><br>' + failed.map(esc).join('<br>') + '</div>');
    }
    if (skippedAll.length) {
      // 건너뛴 것을 조용히 넘기면 "왜 이 표가 안 나왔지"를 알 수 없다
      $('#out').insertAdjacentHTML('beforeend',
        '<div class="note"><b>CAN 사양표가 아니라고 보고 건너뛴 곳</b><br>' +
        skippedAll.map(esc).join('<br>') +
        '<br><span class="sub">머리글에 ID 나 PGN 이 없으면 다른 표로 봅니다.</span></div>');
    }
  } finally {
    btn.disabled = false; btn.textContent = '추출하기';
  }
}

function wire() {
  const drop = $('#drop'), input = $('#file');
  const take = (list) => {
    picked = [...list].filter(f => kindOf(f.name));
    const bad = [...list].filter(f => !kindOf(f.name));
    renderFiles();
    if (bad.length) $('#out').innerHTML =
      '<div class="note">지원하지 않는 형식은 뺐습니다: ' + bad.map(f => esc(f.name)).join(', ') + '</div>';
  };
  input.addEventListener('change', () => take(input.files));
  ['dragenter', 'dragover'].forEach(t =>
    drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t =>
    drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => take(e.dataTransfer.files || []));
  $('#run').addEventListener('click', run);

  $('#sample').addEventListener('click', async () => {
    const names = ['A사_ECM_CAN사양_20260820.xlsx', 'B사_Cluster_CAN사양_Rev3.docx', 'C사_BodyECU_CAN_Spec.pdf'];
    const btn = $('#sample');
    btn.disabled = true; btn.textContent = '예제 받는 중…';
    try {
      picked = [];
      for (const n of names) {
        const r = await fetch('sample/' + encodeURIComponent(n));
        if (!r.ok) throw new Error(n + ' (' + r.status + ')');
        picked.push(new File([await r.blob()], n));
      }
      renderFiles();
      await run();
    } catch (e) {
      $('#out').innerHTML = '<div class="warn">예제를 불러오지 못했습니다 — ' + esc(e.message) + '</div>';
    } finally { btn.disabled = false; btn.textContent = '예제 사양서로 해보기'; }
  });
}

wire();
