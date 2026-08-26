/* 브라우저에 실제로 띄워 화면이 그려지는지 본다.
 *
 *   node test/smoke.browser.js
 *
 * 규칙 테스트(test/logic.test.js)가 31개 전부 통과해도 app.js 의 오타 하나면
 * 페이지가 빈 화면이 된다. 규칙은 맞는데 아무도 그것을 볼 수 없는 상태다.
 * 파일을 읽어서는 안 잡힌다 — 실제로 띄워 봐야 잡힌다.
 *
 * 「예제로 해보기」 단추 하나가 xlsx·docx·pdf 세 파서를 모두 지나가므로
 * 그것을 누르는 것이 이 앱에서 가장 넓게 훑는 길이다.
 *
 * playwright 가 없으면 **조용히 건너뛴다.** 이것 하나 때문에 다른 테스트가
 * 막히면 아무도 안 돌리게 된다. CI 에서는 설치하고 돌린다.
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다 (CI 에서는 설치 후 돌립니다).');
  process.exit(0);
}

var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
function group(t) { console.log('\n' + t); }
function ok(c, label, detail) {
  if (c) passed++; else { failed++; console.log('  X ' + label); if (detail) console.log('      ' + detail); }
}
function eq(g, w, label) { ok(String(g) === String(w), label, '기대: ' + w + '  실제: ' + g); }

/* 정적 서버가 내주는 MIME.
 *
 * ⚠ **.mjs 를 빠뜨리면 안 된다.** 브라우저는 모듈 스크립트의 MIME 을 엄격히
 * 검사해서, octet-stream 으로 오면 실행을 거부한다. 실제로 그렇게 만들었다가
 * 화면이 영영 그려지지 않아 30초를 기다린 끝에 시간 초과로만 끝났다 —
 * 무엇이 잘못됐는지는 한 마디도 나오지 않았다.
 * (이 앱은 PDF 를 lib/pdf.min.mjs 로 읽는다.)
 */
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',   /* 한글 CMap — PDF 한글이 빈 문자열이 되지 않게 */
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

/* 서버가 내주지 못한 것을 모아 둔다. 테스트가 못 서는 이유가
 * 앱이 아니라 이 서버일 수 있고, 그때 시간 초과만 나면 원인을 못 찾는다. */
var missed = [];

function serve(port) {
  return http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    var file = path.join(ROOT, rel);
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      missed.push(rel);
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port);
}

(async function main() {
  var PORT = 8813;
  var server = serve(PORT);
  var browser = await chromium.launch();
  var errors = [];

  try {
    var page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
    page.on('pageerror', function (e) { errors.push(String(e)); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });

    group('1. 첫 화면');
    /* <input type=file> 은 css 로 감춰 두고 .drop 라벨이 그 자리를 대신한다.
     * 눌리는 것은 라벨이므로 사람이 보는 것도 라벨이다. */
    ok(await page.isVisible('#drop'), '파일을 끌어다 놓는 자리가 보인다');
    ok(await page.locator('#file').count() === 1, '파일 입력이 붙어 있다');
    ok(await page.isVisible('#sample'), '예제 단추가 보인다');
    ok(await page.isDisabled('#run'), '파일을 고르기 전에는 정리 단추가 눌리지 않는다');
    eq((await page.textContent('#out')).trim(), '', '처음엔 결과가 비어 있다');

    group('2. 예제 한 번으로 세 형식을 다 지나간다');
    await page.click('#sample');
    /* xlsx·docx·pdf 를 모두 읽어야 하므로 넉넉히 기다린다 */
    try {
      await page.waitForSelector('#out table', { timeout: 30000 });
    } catch (e) {
      /* 시간 초과만 던지면 원인을 알 수 없다. 화면과 서버 상태를 함께 적는다. */
      var dump = (await page.textContent('#out')).replace(/\s+/g, ' ').slice(0, 160);
      ok(false, '예제를 눌러 표가 그려진다',
         '#out: ' + (dump || '(비어 있음)') +
         ' | 못 내준 파일: ' + (missed.length ? missed.join(', ') : '없음') +
         ' | 오류: ' + (errors.slice(0, 2).join(' | ') || '없음'));
      throw e;
    }

    var rows = await page.locator('#out table tbody tr').count();
    ok(rows > 0, '정리 결과에 행이 있다 (' + rows + '행)');

    var stats = await page.$$eval('#out .stat', function (els) {
      return els.map(function (e) { return e.textContent.trim(); });
    });
    ok(stats.length >= 4, '요약 숫자가 나온다', JSON.stringify(stats));
    ok(stats.join(' ').indexOf('3개 파일') >= 0,
       'xlsx·docx·pdf 세 파일을 다 읽었다', JSON.stringify(stats));

    group('3. 계산으로 채운 값에 표시가 붙는다');
    /* ID 만 있는 줄은 PGN·SA·우선순위를 계산해 채운다. 문서에 적혀 있던
     * 값과 신뢰도가 다르므로 반드시 구분되어야 한다. */
    var calc = await page.locator('#out .calc').count();
    ok(calc > 0, '「계산」 표시가 붙은 칸이 있다 (' + calc + '칸)');
    eq(await page.locator('#out .calc').first().textContent(), '계산', '표시 글자');

    group('4. 어긋난 값은 고치지 않고 알린다');
    var text = await page.textContent('#out');
    ok(text.indexOf('검토필요') >= 0 || text.indexOf('어긋난 값이 없습니다') >= 0,
       '검토 결과를 밝힌다');
    if (text.indexOf('검토필요') >= 0) {
      ok(text.indexOf('고쳐서 채우지 않습니다') >= 0,
         '고쳐 주지 않는다고 분명히 적는다');
    }

    group('5. 내려받기 단추가 살아 있다');
    var dl = await page.locator('button, a').filter({ hasText: /엑셀|내려받기|다운로드/ }).count();
    ok(dl > 0, '결과를 받을 수 있다 (' + dl + '개)');

    group('6. 좁은 화면에서 가로로 넘치지 않는다');
    await page.setViewportSize({ width: 380, height: 780 });
    await page.waitForTimeout(150);
    var over = await page.evaluate(function () {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    ok(over <= 1, '가로 스크롤이 생기지 않는다 (넘침 ' + over + 'px)');
    ok(await page.isVisible('#drop'), '좁은 화면에서도 파일 자리가 보인다');

    group('7. 콘솔에 오류가 없다');
    ok(errors.length === 0, '자바스크립트 오류 없음', errors.join(' | '));
    /* 이 서버가 못 내준 파일이 있으면 앱이 아니라 테스트가 틀린 것이다 */
    ok(missed.length === 0, '테스트 서버가 필요한 파일을 다 내줬다', missed.join(', '));

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failed ? 'X' : 'O') + ' ' + passed + ' 통과 / ' + failed + ' 실패');
  process.exit(failed ? 1 : 0);
}());
