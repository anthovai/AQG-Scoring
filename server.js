/* ══════════════════════════════════════════════════════════════════════════
   AQG prototype server — zero dependency (plain Node)

   1. static files with HTTP range + conditional GET + gzip
      (range is mandatory: the stage videos are 250-640 MB and <video> seeks)
   2. a small results API so a study does not depend on each browser's
      localStorage:
        GET  /api/config                 → what the client may use
        GET  /api/code?code=XXXX         → verify an access code
        POST /api/sessions               → store one finished session
        GET  /api/sessions?key=…         → list sessions      (admin)
        GET  /api/sessions.csv?key=…     → one CSV of every decision (admin)
        GET  /api/sessions-wide.csv?key=… → 1 row per session, 6 dims as columns
        GET  /api/session?id=…&key=…     → one full session   (admin)

   node server.js [port]
     PORT            default 5190
     AQG_ADMIN_KEY   admin key for the /api/sessions* reads
                     (unset = a random key is generated and printed at startup)
     AQG_REQUIRE_CODE=1  players must enter a valid access code to start
     AQG_DEV=1       enables POST /_shot (frame dumps used to calibrate cues)
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var crypto = require('crypto');

var ROOT = __dirname;
var PORT = Number(process.argv[2] || process.env.PORT || 5190);
var DEV = process.env.AQG_DEV === '1';
/* No guessable default: without AQG_ADMIN_KEY a fresh random key is generated
   per start and printed below, so an unconfigured instance never ships with a
   key that anyone could read out of this repository. */
var ADMIN_KEY = process.env.AQG_ADMIN_KEY || crypto.randomBytes(12).toString('hex');
var ADMIN_KEY_GENERATED = !process.env.AQG_ADMIN_KEY;
var REQUIRE_CODE = process.env.AQG_REQUIRE_CODE === '1';

var RESULTS_DIR = path.join(ROOT, 'results');
var SESSIONS_LOG = path.join(RESULTS_DIR, 'sessions.jsonl');
var CODES_FILE = path.join(ROOT, 'config', 'access-codes.json');
var MAX_BODY = 512 * 1024;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8'
};
var GZIP = /^(text\/|application\/json|image\/svg|text\/javascript)/;
/* assets are content-addressed by mtime+size in the ETag, so they can be
   cached hard; index.html and the data file must always be revalidated */
var LONG_CACHE = /\.(mp4|m4a|mp3|jpe?g|png|webp|svg|woff2|ico)$/i;

/* ── helpers ───────────────────────────────────────────────────────────── */
function send(res, code, body, headers) {
  headers = headers || {};
  if (typeof body === 'object' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body, null, 2);
    headers['Content-Type'] = TYPES['.json'];
  }
  var buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  headers['Content-Length'] = buf.length;
  res.writeHead(code, headers);
  res.end(buf);
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function etagOf(st) {
  return '"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
}
function safeId(s) { return String(s || '').replace(/[^\w.\-]/g, '_').slice(0, 80); }
function body(req, cb) {
  var chunks = [], size = 0, bad = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_BODY) { bad = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', function () { if (!bad) cb(null, Buffer.concat(chunks)); });
  req.on('error', function (e) { cb(e); });
  req.on('close', function () { if (bad) cb(new Error('body too large')); });
}
function isAdmin(q, req) {
  var k = q.key || req.headers['x-admin-key'];
  return !!k && String(k) === ADMIN_KEY;
}

/* ── access codes ──────────────────────────────────────────────────────── */
function ensureConfig() {
  fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
  if (!fs.existsSync(CODES_FILE)) {
    fs.writeFileSync(CODES_FILE, JSON.stringify({
      _readme: 'รายชื่อรหัสเข้าเล่น — แก้ไฟล์นี้ได้เลย ไม่ต้องรีสตาร์ตเซิร์ฟเวอร์. ' +
               'ตั้ง AQG_REQUIRE_CODE=1 เพื่อบังคับใช้รหัส',
      codes: [
        { code: 'AQG-001', callsign: 'ว2-001', unit: 'ตัวอย่าง หน่วยที่ 1' },
        { code: 'AQG-002', callsign: 'ว2-002', unit: 'ตัวอย่าง หน่วยที่ 1' },
        { code: 'DEMO', callsign: 'ผู้ทดลองระบบ', unit: 'สาธิต' }
      ]
    }, null, 2), 'utf8');
    console.log('created config/access-codes.json (ตัวอย่าง 3 รหัส)');
  }
}
function lookupCode(code) {
  var cfg = readJSON(CODES_FILE, { codes: [] });
  var want = String(code || '').trim().toUpperCase();
  var list = cfg.codes || [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].code || '').trim().toUpperCase() === want) return list[i];
  }
  return null;
}

/* ── results storage ───────────────────────────────────────────────────── */
var CSV_COLS = ['sessionId', 'callsign', 'unit', 'accessCode', 'mode', 'startedAt',
  'finishedAt', 'stageId', 'questionId', 'dimension', 'choiceId', 'score',
  'displayedPosition', 'displayedOrder', 'responseTimeMs', 'timedOut', 'timestamp'];

function csvCell(v) {
  if (Array.isArray(v)) v = v.join('|');
  v = v == null ? '' : String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function sessionToCSV(s) {
  return (s.decisions || []).map(function (d) {
    return CSV_COLS.map(function (c) {
      return csvCell((c in d) ? d[c] : s[c]);
    }).join(',');
  }).join('\r\n');
}
/* CSV แบบกว้าง: 1 แถว = 1 session, 6 มิติเป็นคอลัมน์ — เปิดใน SPSS/R/Excel ได้ตรงๆ
   ค่าที่หมดเวลาเว้นว่างไว้ (missing) ไม่ใส่ 0 */
var DIM_KEYS = ['AQ-Control', 'AQ-Ownership', 'AQ-Reach', 'AQ-Endurance',
  'GRIT-Passion', 'GRIT-Perseverance'];
var WIDE_COLS = ['sessionId', 'callsign', 'unit', 'accessCode', 'mode',
  'startedAt', 'finishedAt', 'decisions', 'timeouts', 'avgScored']
  .concat(DIM_KEYS.map(function (k) { return k.replace(/[^A-Za-z]/g, '_'); }))
  .concat(DIM_KEYS.map(function (k) { return k.replace(/[^A-Za-z]/g, '_') + '_choice'; }))
  .concat(DIM_KEYS.map(function (k) { return k.replace(/[^A-Za-z]/g, '_') + '_ms'; }));

function sessionToWideRow(s) {
  var byDim = {};
  (s.decisions || []).forEach(function (d) { byDim[d.dimension] = d; });
  var sum = summarise(s);
  var row = [s.sessionId, s.callsign, s.unit, s.accessCode, s.mode,
    s.startedAt, s.finishedAt, sum.decisions, sum.timeouts, sum.avg];
  DIM_KEYS.forEach(function (k) {
    var d = byDim[k];
    row.push(d && typeof d.score === 'number' ? d.score : '');
  });
  DIM_KEYS.forEach(function (k) { row.push((byDim[k] || {}).choiceId || ''); });
  DIM_KEYS.forEach(function (k) { row.push((byDim[k] || {}).responseTimeMs || ''); });
  return row.map(csvCell).join(',');
}

function saveSession(s) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  var id = safeId(s.sessionId || ('AQG-' + Date.now()));
  s.sessionId = id;
  s.savedAt = new Date().toISOString();
  fs.writeFileSync(path.join(RESULTS_DIR, id + '.json'), JSON.stringify(s, null, 2), 'utf8');
  fs.appendFileSync(SESSIONS_LOG, JSON.stringify(s) + '\n', 'utf8');
  return id;
}
function allSessions() {
  var out = [];
  try {
    fs.readFileSync(SESSIONS_LOG, 'utf8').split('\n').forEach(function (l) {
      if (!l.trim()) return;
      try { out.push(JSON.parse(l)); } catch (e) { /* skip a torn line */ }
    });
  } catch (e) { /* no results yet */ }
  /* the log is append-only: keep the newest record per sessionId */
  var seen = {};
  out.forEach(function (s) { seen[s.sessionId] = s; });
  return Object.keys(seen).map(function (k) { return seen[k]; })
    .sort(function (a, b) { return (b.finishedAt || '').localeCompare(a.finishedAt || ''); });
}
function summarise(s) {
  var dims = {};
  (s.decisions || []).forEach(function (d) { dims[d.dimension] = d.score; });
  /* ข้อที่หมดเวลามี score = null (missing data) ไม่นับในค่าเฉลี่ย */
  var scores = (s.decisions || []).map(function (d) { return d.score; })
    .filter(function (v) { return typeof v === 'number'; });
  return {
    sessionId: s.sessionId,
    callsign: s.callsign || '',
    unit: s.unit || '',
    accessCode: s.accessCode || '',
    mode: s.mode || '',
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    decisions: (s.decisions || []).length,
    timeouts: (s.decisions || []).filter(function (d) { return d.timedOut; }).length,
    avg: scores.length ? +(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length).toFixed(2) : null,
    scored: scores.length,
    dimensions: dims
  };
}

/* ── API ───────────────────────────────────────────────────────────────── */
function api(req, res, p, q) {
  if (p === '/api/config') {
    return send(res, 200, {
      ok: true,
      storage: 'server',
      requireCode: REQUIRE_CODE,
      serverTime: new Date().toISOString()
    }, { 'Cache-Control': 'no-store' });
  }

  if (p === '/api/code') {
    var hit = lookupCode(q.code);
    if (!hit) return send(res, 404, { ok: false, error: 'ไม่พบรหัสนี้ในระบบ' }, { 'Cache-Control': 'no-store' });
    return send(res, 200, {
      ok: true, code: hit.code, callsign: hit.callsign || '', unit: hit.unit || ''
    }, { 'Cache-Control': 'no-store' });
  }

  if (p === '/api/sessions' && req.method === 'POST') {
    return body(req, function (err, buf) {
      if (err) return send(res, 413, { ok: false, error: String(err.message || err) });
      var s;
      try { s = JSON.parse(buf.toString('utf8')); } catch (e) {
        return send(res, 400, { ok: false, error: 'invalid json' });
      }
      if (!s || !Array.isArray(s.decisions)) {
        return send(res, 400, { ok: false, error: 'missing decisions[]' });
      }
      if (REQUIRE_CODE && !lookupCode(s.accessCode)) {
        return send(res, 403, { ok: false, error: 'ต้องมีรหัสเข้าเล่นที่ถูกต้อง' });
      }
      try {
        var id = saveSession(s);
        console.log('saved session ' + id + ' (' + s.decisions.length + ' decisions)');
        return send(res, 200, { ok: true, sessionId: id });
      } catch (e) {
        console.error('save failed', e);
        return send(res, 500, { ok: false, error: 'บันทึกผลไม่สำเร็จ' });
      }
    });
  }

  /* everything below is admin-only */
  if (p === '/api/sessions' || p === '/api/sessions.csv' ||
      p === '/api/sessions-wide.csv' || p === '/api/session') {
    if (!isAdmin(q, req)) return send(res, 401, { ok: false, error: 'admin key required' });

    if (p === '/api/sessions') {
      var list = allSessions();
      return send(res, 200, {
        ok: true, count: list.length, sessions: list.map(summarise)
      }, { 'Cache-Control': 'no-store' });
    }
    if (p === '/api/session') {
      var one = allSessions().filter(function (s) { return s.sessionId === q.id; })[0];
      return one ? send(res, 200, { ok: true, session: one }, { 'Cache-Control': 'no-store' })
                 : send(res, 404, { ok: false, error: 'not found' });
    }
    if (p === '/api/sessions-wide.csv') {
      var wrows = [WIDE_COLS.join(',')];
      allSessions().forEach(function (x) { wrows.push(sessionToWideRow(x)); });
      return send(res, 200, Buffer.from('\ufeff' + wrows.join('\r\n'), 'utf8'), {
        'Content-Type': TYPES['.csv'],
        'Content-Disposition': 'attachment; filename="aqg-sessions-wide.csv"',
        'Cache-Control': 'no-store'
      });
    }
    var rows = [CSV_COLS.join(',')];
    allSessions().forEach(function (s) {
      var c = sessionToCSV(s);
      if (c) rows.push(c);
    });
    return send(res, 200, Buffer.from('﻿' + rows.join('\r\n'), 'utf8'), {
      'Content-Type': TYPES['.csv'],
      'Content-Disposition': 'attachment; filename="aqg-all-sessions.csv"',
      'Cache-Control': 'no-store'
    });
  }

  return send(res, 404, { ok: false, error: 'unknown endpoint' });
}

/* ── static ────────────────────────────────────────────────────────────── */
function serveStatic(req, res, p) {
  if (p === '/' || p === '') p = '/index.html';
  var file = path.join(ROOT, path.normalize(p).replace(/^[\\/]+/, ''));
  if (file.indexOf(ROOT) !== 0) return send(res, 403, 'forbidden');

  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      return send(res, 404, '404 ' + p, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    var type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    var etag = etagOf(st);
    var lastMod = st.mtime.toUTCString();
    var cache = LONG_CACHE.test(file) ? 'public, max-age=604800' : 'no-cache';

    /* conditional GET — replays and stage re-entry cost nothing */
    var inm = req.headers['if-none-match'];
    var ims = req.headers['if-modified-since'];
    if ((inm && inm === etag) || (!inm && ims && new Date(ims) >= new Date(lastMod))) {
      res.writeHead(304, { ETag: etag, 'Last-Modified': lastMod, 'Cache-Control': cache });
      return res.end();
    }

    var base = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': lastMod,
      'Cache-Control': cache
    };

    var range = req.headers.range;
    if (range) {
      var m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      var start = m[1] ? parseInt(m[1], 10) : 0;
      var end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start) || start >= st.size || start > end) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
        return res.end();
      }
      if (end >= st.size) end = st.size - 1;
      base['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
      base['Content-Length'] = end - start + 1;
      res.writeHead(206, base);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start: start, end: end }).pipe(res);
    }

    var accept = req.headers['accept-encoding'] || '';
    if (GZIP.test(type) && /\bgzip\b/.test(accept) && st.size > 1024) {
      base['Content-Encoding'] = 'gzip';
      base['Vary'] = 'Accept-Encoding';
      delete base['Accept-Ranges'];
      res.writeHead(200, base);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
    }

    base['Content-Length'] = st.size;
    res.writeHead(200, base);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ── router ────────────────────────────────────────────────────────────── */
ensureConfig();

http.createServer(function (req, res) {
  var u = new URL(req.url, 'http://localhost');
  var query = {};
  u.searchParams.forEach(function (v, k) { query[k] = v; });
  var p = decodeURIComponent(u.pathname);

  if (p.indexOf('/api/') === 0) return api(req, res, p, query);

  if (DEV && req.method === 'POST' && p === '/_shot') {
    var name = safeId(query.name || 'shot.png');
    var dir = path.join(ROOT, 'tools', 'shots');
    fs.mkdirSync(dir, { recursive: true });
    return body(req, function (err, buf) {
      if (err) return send(res, 413, 'too large');
      fs.writeFile(path.join(dir, name), buf, function (e) {
        send(res, e ? 500 : 200, e ? String(e) : 'ok ' + name,
          { 'Content-Type': 'text/plain' });
      });
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  serveStatic(req, res, p);
}).on('error', function (e) {
  /* ข้อความที่อ่านรู้เรื่องแทน stack trace — กรณีที่เจอบ่อยคือมีเซิร์ฟเวอร์ตัวเก่ารันค้างอยู่ */
  if (e.code === 'EADDRINUSE') {
    console.error('พอร์ต ' + PORT + ' ถูกใช้อยู่แล้ว — มีเซิร์ฟเวอร์ AQG ตัวเก่ารันค้างอยู่หรือเปล่า?');
    console.error('ดูว่าใครถือพอร์ต:  netstat -ano | findstr :' + PORT);
    console.error('หรือสั่งใช้พอร์ตอื่น:  node server.js 5191');
  } else {
    console.error('เปิดเซิร์ฟเวอร์ไม่ได้: ' + e.message);
  }
  process.exit(1);
}).listen(PORT, function () {
  console.log('AQG prototype  →  http://localhost:' + PORT);
  console.log('admin          →  http://localhost:' + PORT + '/admin.html');
  console.log('admin key      →  ' + ADMIN_KEY +
    (ADMIN_KEY_GENERATED
      ? '   (สุ่มใหม่ทุกครั้งที่รัน — ตั้ง AQG_ADMIN_KEY เพื่อใช้คีย์เดิมทุกครั้ง)'
      : '   (จาก AQG_ADMIN_KEY)'));
  console.log('serving ' + ROOT +
    (REQUIRE_CODE ? '  [require access code]' : '') +
    (DEV ? '  [dev /_shot]' : ''));
});
