/* ตรวจความถูกต้องของข้อมูลเกมและไฟล์ที่ต้องมี  —  node tools/check.js
   ใช้ก่อนนำไปติดตั้ง/เดโม เพื่อจับปัญหาแบบ "ไฟล์หาย / คะแนนเพี้ยน" ให้เจอก่อนผู้เล่น */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var fail = [], warn = [], ok = [];

function has(rel, minBytes) {
  var p = path.join(ROOT, rel);
  try {
    var st = fs.statSync(p);
    if (minBytes && st.size < minBytes) return warn.push(rel + ' เล็กกว่าที่คาด (' + st.size + ' bytes)');
    return ok.push(rel + ' (' + (st.size / 1048576).toFixed(1) + ' MB)');
  } catch (e) { fail.push('ไม่พบไฟล์ ' + rel); }
}

/* ── data ─────────────────────────────────────────────────────────────── */
global.window = {};
require(path.join(ROOT, 'data', 'game.js'));
var D = global.window.AQG_DATA;
if (!D) fail.push('data/game.js ไม่ได้ตั้งค่า window.AQG_DATA');

if (D) {
  var M = D.meta, qCount = 0;
  if (M.timerSeconds !== 20) warn.push('timerSeconds = ' + M.timerSeconds + ' (เอกสารกำหนด 20)');
  if (Object.keys(M.hotspots || {}).length !== 5) fail.push('meta.hotspots ต้องมี 5 ตำแหน่ง');
  if ((M.dimensions || []).length !== 6) fail.push('meta.dimensions ต้องมี 6 มิติ');

  if (M.titleVideo) {
    var tw = fs.existsSync(path.join(ROOT, M.titleVideo));
    if (tw) has(M.titleVideo, 1024 * 1024);
    else if (M.titleVideoFallback) {
      warn.push('ไม่พบ ' + M.titleVideo + ' — จะใช้ไฟล์ต้นฉบับแทน');
      has(M.titleVideoFallback, 1024 * 1024);
    } else fail.push('ไม่พบวีดีโอไทเทิล ' + M.titleVideo);
  }

  D.stages.forEach(function (st) {
    /* the app prefers the web-sized file and falls back to the master */
    var web = fs.existsSync(path.join(ROOT, st.video));
    if (web) has(st.video, 1024 * 1024);
    else if (st.videoFallback) {
      warn.push('ไม่พบ ' + st.video + ' — จะใช้ไฟล์ต้นฉบับแทน (รัน tools/compress-video.ps1 เพื่อย่อ)');
      has(st.videoFallback, 1024 * 1024);
    } else has(st.video, 1024 * 1024);
    if (st.poster) has(st.poster);
    st.questions.forEach(function (q) {
      qCount++;
      var ids = q.options.map(function (o) { return o.id; }).sort();
      if (ids.length !== 5) fail.push(q.id + ': ต้องมี 5 ตัวเลือก');
      var scores = q.options.map(function (o) { return o.score; }).sort();
      if (scores.join() !== '1,2,3,4,5') fail.push(q.id + ': คะแนนต้องครบ 1-5 (ได้ ' + scores.join() + ')');
      q.options.forEach(function (o) {
        if (!o.text) fail.push(o.id + ': ไม่มีข้อความตัวเลือก');
        if (!o.tag) fail.push(o.id + ': ไม่มี Behavior Tag');
        if (!o.advice) fail.push(o.id + ': ไม่มีคำแนะนำ');
        var letter = o.id.slice(-1);
        var want = M.scoreMap[letter];
        if (want !== o.score) fail.push(o.id + ': คะแนนไม่ตรง scoreMap (' + o.score + ' ≠ ' + want + ')');
      });
      var slots = (q.slots || []).map(function (s) { return s.choiceId; }).sort();
      if (slots.join() !== ids.join()) fail.push(q.id + ': slots ไม่แม็พครบกับ choice_id');
      if ((q.slots || []).map(function (s) { return s.label; }).join('') !== 'ABCDE') {
        fail.push(q.id + ': slot label ต้องเป็น A..E');
      }
      var c = q.cue || {};
      if (!(c.end > c.start)) fail.push(q.id + ': cue ไม่ถูกต้อง');
      var win = c.end - c.start;
      if (win < 12 || win > 30) warn.push(q.id + ': ช่วงตอบ ' + win.toFixed(1) + ' วินาที (คาด ~20)');
    });
  });
  if (qCount !== 6) fail.push('ต้องมี 6 จุดตัดสินใจ (พบ ' + qCount + ')');

  /* dimension ↔ question */
  (M.dimensions || []).forEach(function (d) {
    var found = false;
    D.stages.forEach(function (st) {
      st.questions.forEach(function (q) { if (q.id === d.from) found = true; });
    });
    if (!found) fail.push('มิติ ' + d.key + ' อ้างคำถาม ' + d.from + ' ที่ไม่มีอยู่');
  });
}

/* ── files the app needs ──────────────────────────────────────────────── */
['index.html', 'app.js', 'styles.css', 'admin.html', 'server.js',
 'assets/logo.png', 'assets/bg-stage1.jpg', 'assets/bg-menu.jpg',
 'assets/bg-hud.jpg', 'assets/bg-title.jpg', 'assets/bg-result.jpg'].forEach(function (f) { has(f); });

/* ── report ───────────────────────────────────────────────────────────── */
console.log('ผ่าน  : ' + ok.length + ' รายการ');
warn.forEach(function (w) { console.log('เตือน : ' + w); });
fail.forEach(function (f) { console.log('ผิด   : ' + f); });
if (fail.length) {
  console.log('\nไม่ผ่าน ' + fail.length + ' รายการ');
  process.exit(1);
}
console.log('\nเรียบร้อย — ข้อมูลและไฟล์ครบตามเอกสาร' + (warn.length ? ' (มีคำเตือน ' + warn.length + ')' : ''));
