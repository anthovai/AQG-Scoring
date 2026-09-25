/* ══════════════════════════════════════════════════════════════════════════
   AQG — AQ/GRIT situational assessment prototype

   The three stage videos (S01/S02/S03) already render the decision screens:
   five option cards in a ring, labelled A-E, fading in one by one, followed by
   a countdown. This app makes those cards clickable and scores them per
   "AQG scoring Aug":

     • 3 stages / 6 decision points / 6 dimensions
     • the score comes from choice_id (A=5 … E=1) — the ring position the card
       happens to sit in is recorded, never scored (see `slots` in data/game.js)
     • 20 s per decision; if the video's own window ends first the picture is
       frozen so the player still gets the full 20 s
     • nothing about scoring is revealed mid-game — one reveal point, the end
     • ?panel=1 → panel mode: the video pauses and the options are re-drawn as
       a shuffled list (the per-session shuffle the document asks for)
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DATA = window.AQG_DATA;
  var META = DATA.meta;
  var STORE_KEY = 'aqg.sessions.v1';
  var PANEL_MODE = /[?&]panel=1/.test(location.search);
  var LETTERS = ['A', 'B', 'C', 'D', 'E'];

  /* ── helpers ──────────────────────────────────────────────────────────── */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(name) {
    var all = document.querySelectorAll('.screen');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('is-active', all[i].dataset.screen === name);
    }
    state.screen = name;
  }
  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function shuffled(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var state = {
    screen: 'menu', flow: [], step: -1, session: null, q: null,
    backend: null,        // /api/config once the server answers
    code: null            // the verified access code, if any
  };

  /* ── backend (optional) ───────────────────────────────────────────────────
     The app is fully playable with no server API: results then live in
     localStorage and in the JSON/CSV download. When server.js is running its
     API is used as well, so a study does not depend on each browser. */
  function probeBackend() {
    return fetch('api/config', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        state.backend = c && c.ok ? c : null;
        applyBackend();
      })
      .catch(function () { state.backend = null; applyBackend(); });
  }
  function applyBackend() {
    var b = state.backend;
    $('#field-code').hidden = !b;
    $('#login-note').textContent = !b
      ? 'โหมดเดี่ยว (ไม่มีเซิร์ฟเวอร์) — ผลจะเก็บในเครื่องนี้และดาวน์โหลดเป็นไฟล์'
      : (b.requireCode
        ? 'ต้องใส่รหัสเข้าเล่นที่ได้รับ เพื่อเริ่มการประเมิน'
        : 'ใส่รหัสเข้าเล่นถ้ามี — หรือกรอกนามเรียกขาน/หน่วยเองก็ได้');
  }
  function loginStatus(msg, kind) {
    var n = $('#login-status');
    n.hidden = !msg;
    n.textContent = msg || '';
    n.className = 'status' + (kind ? ' status--' + kind : '');
  }
  function doLogin() {
    var code = ($('#in-code').value || '').trim();
    var b = state.backend;
    if (!b || !code) {
      if (b && b.requireCode) return loginStatus('กรุณาใส่รหัสเข้าเล่นที่ได้รับ', 'bad');
      state.code = null;
      return playTitle();
    }
    loginStatus('กำลังตรวจรหัส…');
    fetch('api/code?code=' + encodeURIComponent(code), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) {
          state.code = null;
          return loginStatus(d.error || 'รหัสไม่ถูกต้อง', 'bad');
        }
        state.code = d.code;
        if (d.callsign) $('#in-callsign').value = d.callsign;
        if (d.unit) $('#in-unit').value = d.unit;
        loginStatus('ยืนยันรหัสแล้ว: ' + d.code, 'ok');
        setTimeout(playTitle, 550);
      })
      .catch(function () { loginStatus('ติดต่อเซิร์ฟเวอร์ไม่ได้ — เล่นต่อได้ในโหมดเดี่ยว', 'bad'); });
  }

  /* ── flow: briefing → video (with decision cues) → … → result ─────────── */
  function buildFlow() {
    var f = [];
    DATA.stages.forEach(function (st) {
      f.push({ type: 'stagecard', stage: st });
      f.push({ type: 'video', stage: st });
    });
    f.push({ type: 'result' });
    return f;
  }
  function next() { runStep(state.step + 1); }
  function runStep(i) {
    state.step = i;
    var s = state.flow[i];
    if (!s) return renderResult();
    if (s.type === 'stagecard') return renderStageCard(s);
    if (s.type === 'video') return renderVideo(s);
    return renderResult();
  }

  /* ── stage briefing ───────────────────────────────────────────────────── */
  function renderStageCard(s) {
    var st = s.stage;
    $('#sc-no').textContent = 'ด่านที่ ' + st.no;
    $('#sc-title').textContent = '“' + st.title + '”';
    $('#sc-sub').textContent = st.subtitle;
    $('#sc-measures').textContent = 'วัด: ' + st.measures + ' · ' +
      st.questions.length + ' จุดตัดสินใจ';
    $('#sc-bg').style.backgroundImage = 'url("' + (st.poster || 'assets/bg-stage1.jpg') + '")';

    var brief = $('#sc-brief');
    brief.innerHTML = '';
    brief.appendChild(el('p', 'brief__scene', st.scene));
    (st.opening || []).forEach(function (b) {
      var p = el('p', 'brief__' + b.kind);
      if (b.kind === 'radio') {
        p.appendChild(el('b', null, (b.speaker || 'วิทยุ') + ': '));
        p.appendChild(document.createTextNode('“' + b.text + '”'));
      } else {
        p.textContent = b.text;
      }
      brief.appendChild(p);
    });
    show('stagecard');
    $('#btn-stage-go').focus();
    prefetchNext(state.step);       // warm this stage's video while they read
  }

  /* ══════════ video + decision layer ══════════ */
  var V = null;

  function videoRect() {
    /* the picture inside the element, accounting for object-fit:contain */
    var r = V.getBoundingClientRect();
    var vr = V.videoWidth / V.videoHeight || 16 / 9;
    var er = r.width / r.height;
    var w = r.width, h = r.height, x = r.left, y = r.top;
    if (er > vr) { w = r.height * vr; x += (r.width - w) / 2; }
    else { h = r.width / vr; y += (r.height - h) / 2; }
    return { x: x, y: y, w: w, h: h };
  }

  function renderVideo(s) {
    var st = s.stage;
    V = $('#video');
    state.pending = st.questions.slice();          // questions not answered yet
    state.q = null;
    $('#vid-label').textContent = 'ด่านที่ ' + st.no + ' — ' + st.title;
    $('#vid-note').textContent = st.id + ' · ' + st.video.split('/').pop();
    $('#qlayer').hidden = true;
    $('#hud').hidden = true;
    show('video');
    watchBuffering();

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      closeQuestion(true);
      V.pause();
      V.ontimeupdate = V.onended = V.onerror = null;
      next();
    }
    state.finishVideo = finish;

    V.ontimeupdate = function () {
      $('#vid-time').textContent = fmt(V.currentTime) + ' / ' + fmt(V.duration);
      var q = state.pending[0];
      if (!state.q && q && V.currentTime >= q.cue.start) return openQuestion(st, q);
      if (state.q && V.currentTime >= state.q.cue.end) V.pause();   // freeze on the cards
    };
    V.onended = finish;
    V.onerror = function () {
      /* the web-sized file may not have been generated yet — fall back to the
         master file once, then give up and move on */
      if (st.videoFallback && state.usedFallback !== st.id) {
        state.usedFallback = st.id;
        $('#vid-note').textContent = st.id + ' · ' + st.videoFallback.split('/').pop();
        V.src = st.videoFallback;
        V.load();
        V.play();
        return;
      }
      $('#vid-note').textContent = 'เล่นไฟล์ ' + st.video + ' ไม่ได้';
      toast('เล่นวีดีโอไม่ได้ — ระบบจะข้ามไปด่านถัดไป');
      setTimeout(finish, 2200);
    };
    $('#btn-vid-skip').onclick = skip;

    if (V.src.indexOf(st.video) === -1) {
      V.src = st.video;
      if (st.poster) V.poster = st.poster;
    }
    var play = function () {
      try { V.currentTime = 0; } catch (e) {}
      var p = V.play();
      if (p && p.catch) p.catch(function () { toast('กดปุ่มเล่นบนวีดีโอเพื่อเริ่ม'); });
    };
    if (V.readyState >= 1) play(); else V.onloadedmetadata = play;
  }

  /* a spinner while the stream stalls — these files are large */
  function watchBuffering() {
    var sp = $('#spinner');
    /* never cover a live decision with the spinner */
    var set = function (on) { sp.hidden = !on || !!state.q; };
    V.onwaiting = function () { set(true); };
    V.onstalled = function () { set(true); };
    V.onplaying = function () { set(false); };
    V.oncanplay = function () { set(false); };
    V.onseeking = function () { if (!V.paused) set(true); };
    V.onseeked = function () { set(false); };
    set(V.readyState < 3);
  }

  /* warm the next stage's stream while the player reads the briefing:
     a short range request so the connection and the moov box are ready */
  function prefetchNext(step) {
    var nxt = null;
    for (var i = step + 1; i < state.flow.length; i++) {
      if (state.flow[i].type === 'video') { nxt = state.flow[i].stage.video; break; }
    }
    if (!nxt || state.prefetched === nxt) return;
    state.prefetched = nxt;
    try {
      fetch(nxt, { headers: { Range: 'bytes=0-1048575' }, cache: 'force-cache' })
        .then(function (r) { return r.arrayBuffer(); })
        .catch(function () {});
    } catch (e) { /* prefetch is best-effort */ }
  }

  /* skip to the next decision point, or to the end of the stage */
  function skip() {
    if (state.q) return;                       // never skip past a live decision
    var q = state.pending[0];
    if (q && V.currentTime < q.cue.start) {
      try { V.currentTime = q.cue.start; } catch (e) {}
      V.play();
    } else if (state.finishVideo) {
      state.finishVideo();
    }
  }

  /* ── open / close a decision ──────────────────────────────────────────── */
  function openQuestion(stage, q) {
    state.q = q;
    state.qStage = stage;
    state.askedAt = performance.now();
    state.locked = false;

    $('#q-stage').textContent = 'ด่านที่ ' + stage.no + ' — ' + stage.title;
    $('#q-beat').textContent = q.beat;
    $('#q-prog').textContent = 'จุดตัดสินใจ ' + questionIndex(q) + '/6';
    $('#hud').hidden = false;
    $('#spinner').hidden = true;
    $('#vid-note').hidden = true;            // keep the top-left clear for the HUD
    $('#btn-vid-skip').hidden = true;         // a live decision cannot be skipped

    var layer = $('#qlayer');
    layer.hidden = false;
    layer.innerHTML = '';
    layer.classList.toggle('qlayer--panel', PANEL_MODE);

    if (PANEL_MODE) {
      V.pause();
      buildPanel(layer, q);
    } else {
      buildHotspots(layer, q);
      window.addEventListener('resize', placeHotspots);
    }
    startTimer(function () { answer(null, null); });
  }

  /* video-native mode: transparent buttons over the video's own cards */
  function buildHotspots(layer, q) {
    var hint = el('p', 'qlayer__hint', 'แตะ/คลิกการ์ดตัวเลือกบนจอเพื่อเลือก — หรือกดปุ่ม A–E');
    layer.appendChild(hint);
    q.slots.forEach(function (sl) {
      var b = el('button', 'hot');
      b.type = 'button';
      b.dataset.label = sl.label;
      b.setAttribute('aria-label', 'ตัวเลือก ' + sl.label);
      b.appendChild(el('span', 'hot__letter', sl.label));
      b.onclick = function () { answer(sl, b); };
      layer.appendChild(b);
    });
    placeHotspots();
  }
  function placeHotspots() {
    if (!state.q || PANEL_MODE) return;
    var r = videoRect(), hs = META.hotspots;
    var nodes = document.querySelectorAll('#qlayer .hot');
    for (var i = 0; i < nodes.length; i++) {
      var box = hs[nodes[i].dataset.label];
      if (!box) continue;
      nodes[i].style.left = (r.x + box[0] * r.w) + 'px';
      nodes[i].style.top = (r.y + box[1] * r.h) + 'px';
      nodes[i].style.width = ((box[2] - box[0]) * r.w) + 'px';
      nodes[i].style.height = ((box[3] - box[1]) * r.h) + 'px';
    }
  }

  /* panel mode: the document's own shuffle, drawn over a frozen frame */
  function buildPanel(layer, q) {
    var wrap = el('div', 'qpanel');
    wrap.appendChild(el('p', 'qpanel__inner', q.innerQuestion));
    wrap.appendChild(el('h2', 'qpanel__prompt', q.prompt));
    var list = el('div', 'opts');
    shuffled(q.options).forEach(function (o, i) {
      var b = el('button', 'opt');
      b.type = 'button';
      b.style.animationDelay = (i * 0.05) + 's';
      b.appendChild(el('span', 'opt__slot', String(i + 1)));
      b.appendChild(el('p', 'opt__text', o.text));
      b.onclick = function () {
        answer({ label: String(i + 1), choiceId: o.id }, b);
      };
      list.appendChild(b);
    });
    wrap.appendChild(list);
    layer.appendChild(wrap);
  }

  function questionIndex(q) {
    var n = 0;
    for (var i = 0; i < DATA.stages.length; i++) {
      for (var j = 0; j < DATA.stages[i].questions.length; j++) {
        n++;
        if (DATA.stages[i].questions[j].id === q.id) return n;
      }
    }
    return n;
  }

  function optionOf(qid, cid) {
    for (var i = 0; i < DATA.stages.length; i++) {
      var qs = DATA.stages[i].questions;
      for (var j = 0; j < qs.length; j++) {
        if (qs[j].id !== qid) continue;
        for (var k = 0; k < qs[j].options.length; k++) {
          if (qs[j].options[k].id === cid) return qs[j].options[k];
        }
      }
    }
    return null;
  }

  /* ── record a decision ────────────────────────────────────────────────── */
  function answer(slot, node) {
    if (!state.q || state.locked) return;
    state.locked = true;
    stopTimer();
    var q = state.q;
    var opt = slot ? optionOf(q.id, slot.choiceId) : null;

    state.session.decisions.push({
      stageId: state.qStage.id,
      stageNo: state.qStage.no,
      questionId: q.id,
      dimension: q.dimension,
      choiceId: opt ? opt.id : null,
      score: opt ? opt.score : null,   // หมดเวลา = missing data ไม่ใช่ 0 คะแนน
      displayedPosition: slot ? slot.label : null,
      displayedOrder: q.slots.map(function (s) { return s.label + ':' + s.choiceId; }),
      responseTimeMs: Math.round(performance.now() - state.askedAt),
      timedOut: !opt,
      mode: PANEL_MODE ? 'panel' : 'video',
      timestamp: new Date().toISOString()
    });

    if (node) node.classList.add('is-picked');
    var layer = $('#qlayer');
    layer.classList.add('is-locked');
    if (!opt) toast('หมดเวลา — บันทึกว่าไม่ได้ตัดสินใจในข้อนี้');

    setTimeout(function () { closeQuestion(); }, opt ? 450 : 1400);
  }

  function closeQuestion(silent) {
    stopTimer();
    if (!state.q) return;
    var q = state.q;
    state.pending = state.pending.filter(function (x) { return x.id !== q.id; });
    state.q = null;
    state.locked = false;
    window.removeEventListener('resize', placeHotspots);
    var layer = $('#qlayer');
    layer.hidden = true;
    layer.classList.remove('is-locked');
    layer.innerHTML = '';
    $('#hud').hidden = true;
    $('#vid-note').hidden = false;
    $('#btn-vid-skip').hidden = false;
    if (silent) return;
    /* jump past the video's own countdown and carry on with the story */
    if (V && isFinite(q.cue.end) && V.currentTime < q.cue.end) {
      try { V.currentTime = q.cue.end; } catch (e) {}
    }
    if (V) V.play();
  }

  /* ── 20-second countdown ──────────────────────────────────────────────── */
  var ARC = 2 * Math.PI * 19, tmr = null, toastT = null;
  function startTimer(onEnd) {
    /* wall-clock based: 20 s means 20 real seconds even if the tab is
       throttled in the background (counting interval ticks would drift) */
    var total = META.timerSeconds;
    var deadline = performance.now() + total * 1000;
    var arc = $('#timer-arc'), num = $('#timer-num'), ring = $('#timer');
    arc.style.strokeDasharray = ARC;
    stopTimer();
    paint();
    tmr = setInterval(function () {
      if (paint() <= 0) { stopTimer(); onEnd(); }
    }, 200);
    function paint() {
      var msLeft = Math.max(0, deadline - performance.now());
      var left = Math.ceil(msLeft / 1000);
      num.textContent = left;
      arc.style.strokeDashoffset = ARC * (1 - msLeft / (total * 1000));
      ring.classList.toggle('is-low', left <= 5);
      return msLeft;
    }
  }
  function stopTimer() { if (tmr) clearInterval(tmr); tmr = null; }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('is-on'); }, 2800);
  }

  /* ══════════ RESULT — the one and only reveal point ══════════ */
  function byQuestion(id) {
    var d = state.session.decisions;
    for (var i = 0; i < d.length; i++) if (d[i].questionId === id) return d[i];
    return null;
  }

  function computeResult() {
    var rows = META.dimensions.map(function (d) {
      var dec = byQuestion(d.from);
      var opt = dec && dec.choiceId ? optionOf(d.from, dec.choiceId) : null;
      return {
        key: d.key, th: d.th, anchor: !!d.anchor, note: d.note || '', from: d.from,
        score: dec && dec.score != null ? dec.score : null,
        choiceId: dec ? dec.choiceId : null,
        slot: dec ? dec.displayedPosition : null,
        timedOut: dec ? dec.timedOut : true,
        tag: opt ? opt.tag : 'ไม่ได้ตัดสินใจภายในเวลาที่กำหนด',
        advice: opt ? opt.advice
          : 'ข้อนี้หมดเวลาก่อนเลือก — ควรทำซ้ำเพื่อให้ได้ผลประเมินที่สมบูรณ์',
        ms: dec ? dec.responseTimeMs : null
      };
    });
    /* ค่าเฉลี่ยนับเฉพาะมิติที่มีคำตอบ — ข้อที่หมดเวลาเป็น missing data
       ถ้านับเป็น 0 ค่าเฉลี่ยจะต่ำกว่าความจริง */
    var avg = function (a) {
      var v = a.filter(function (r) { return r.score != null; });
      return v.length ? v.reduce(function (s, r) { return s + r.score; }, 0) / v.length : null;
    };
    var fmtAvg = function (x) { return x == null ? '—' : x.toFixed(2); };
    var missing = rows.filter(function (r) { return r.score == null; });
    var find = function (k) {
      for (var i = 0; i < rows.length; i++) if (rows[i].key === k) return rows[i];
      return null;
    };
    var ctrl = find('AQ-Control'), pass = find('GRIT-Passion');
    return {
      rows: rows,
      avgAll: avg(rows), avgAQ: avg(rows.slice(0, 4)), avgGRIT: avg(rows.slice(4)),
      fmtAvg: fmtAvg, missing: missing,
      strengths: rows.filter(function (r) { return r.score != null && r.score >= 4; })
        .sort(function (a, b) { return b.score - a.score; }),
      improve: rows.filter(function (r) { return r.score != null && r.score <= 2; })
        .sort(function (a, b) {
          if (a.anchor !== b.anchor) return a.anchor ? -1 : 1;   // S7 first when low
          return a.score - b.score;
        }),
      dualFlag: !!(ctrl && pass && ctrl.score != null && pass.score != null &&
                   ctrl.score >= META.dualFlag.threshold &&
                   pass.score >= META.dualFlag.threshold)
    };
  }

  function radarSVG(rows) {
    /* the box is wider than the web so the axis labels never clip */
    var W = 520, H = 440, CX = W / 2, CY = 212, R = 125, N = rows.length;
    var pt = function (i, r) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / N;
      return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
    };
    var C = CX;   // kept for the axis lines below
    var s = '<svg class="radar" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="เรดาร์ 6 มิติ">';
    [1, 2, 3, 4, 5].forEach(function (lv) {
      var p = [];
      for (var i = 0; i < N; i++) p.push(pt(i, R * lv / 5).map(Math.round).join(','));
      s += '<polygon class="radar__grid" points="' + p.join(' ') + '"/>';
    });
    for (var i = 0; i < N; i++) {
      var e = pt(i, R);
      s += '<line class="radar__axis" x1="' + CX + '" y1="' + CY + '" x2="' + e[0].toFixed(1) +
           '" y2="' + e[1].toFixed(1) + '"/>';
    }
    s += '<polygon class="radar__shape" points="' + rows.map(function (r, i) {
      return pt(i, R * Math.max(r.score == null ? 0 : r.score, 0.12) / 5).map(function (v) { return v.toFixed(1); }).join(',');
    }).join(' ') + '"/>';
    rows.forEach(function (r, i) {
      var p = pt(i, R * Math.max(r.score == null ? 0 : r.score, 0.12) / 5);
      s += '<circle class="radar__dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5"/>';
      var l = pt(i, R + 22), anchor = 'middle';
      if (l[0] > CX + 10) anchor = 'start'; else if (l[0] < CX - 10) anchor = 'end';
      s += '<text class="radar__label' + (r.anchor ? ' radar__label--anchor' : '') + '" x="' +
           l[0].toFixed(1) + '" y="' + (l[1] + 4).toFixed(1) + '" text-anchor="' + anchor + '">' +
           r.key.replace(/^(AQ|GRIT)-/, '') + ' ' + (r.score == null ? '—' : r.score) + '</text>';
    });
    return s + '</svg>';
  }

  function renderResult() {
    stopTimer();
    state.session.finishedAt = new Date().toISOString();
    saveSession(state.session);
    var R = computeResult(), S = state.session;
    var who = S.callsign ? esc(S.callsign) + (S.unit ? ' · ' + esc(S.unit) : '')
                         : 'ไม่ระบุรหัสผู้เล่น';
    var h = '';

    h += '<div class="result__head">' +
         '<p class="result__eyebrow">Result Screen — จุดเปิดเผยผลจุดเดียวของเกม</p>' +
         '<h1 class="result__h">ผลการประเมิน AQ &amp; GRIT</h1>' +
         '<p class="result__meta">' + who + ' · session ' + S.sessionId + ' · ' +
         new Date(S.finishedAt).toLocaleString('th-TH') + '</p></div>';

    h += '<div class="card"><h2 class="card__h">6 มิติจาก 6 จุดตัดสินใจ</h2>' +
         '<p class="card__note">คะแนนรายมิติ 1–5 ตามเกณฑ์ในเอกสาร (A=5, B=4, C=3, D=2, E=1)</p>' +
         '<div class="radarwrap"><div>' + radarSVG(R.rows) + '</div><div class="bars">';
    R.rows.forEach(function (r) {
      var miss = r.score == null;
      h += '<div class="bar' + (r.anchor ? ' bar--anchor' : '') +
           (!miss && r.score <= 2 ? ' bar--low' : '') + (miss ? ' bar--missing' : '') + '">' +
           '<div class="bar__top"><span class="bar__name">' + r.key + ' <small>· ' + r.th + '</small>' +
           (r.anchor ? '<span class="pill">anchor</span>' : '') + '</span>' +
           '<span class="bar__score">' + (miss ? '<b>—</b><span>ไม่มีข้อมูล</span>'
             : '<b>' + r.score + '</b><span>/5</span>') + '</span></div>' +
           '<div class="bar__track"><div class="bar__fill" style="width:' +
           (miss ? 0 : r.score / 5 * 100) + '%"></div></div></div>';
    });
    h += '</div></div><p class="card__note" style="margin:22px 0 0">ค่าเฉลี่ยอ้างอิง — รวม 6 มิติ ' +
         R.fmtAvg(R.avgAll) + ' · AQ (4 มิติ) ' + R.fmtAvg(R.avgAQ) +
         ' · GRIT (2 มิติ) ' + R.fmtAvg(R.avgGRIT) +
         (R.missing.length ? ' — คิดจาก ' + (6 - R.missing.length) + '/6 มิติ (' +
            R.missing.length + ' ข้อหมดเวลา ไม่นับรวม)' : '') + '</p></div>';

    if (R.dualFlag) {
      h += '<div class="card card--flag"><h2 class="card__h">' + META.dualFlag.title + '</h2>' +
           '<p class="card__note" style="margin:0">' + META.dualFlag.text + '</p></div>';
    }

    h += '<div class="split">';
    h += '<div class="card card--good"><h2 class="card__h">จุดเด่น <span class="pill">คะแนน 4–5</span></h2>' +
         '<p class="card__note">ดึงจากตัวเลือกที่ได้คะแนน 4–5</p><ul class="list">' +
         (R.strengths.length ? R.strengths.map(function (r) {
           return '<li><b>' + r.key + ' — ' + r.tag + '</b><span>' + r.advice + '</span></li>';
         }).join('') : '<li><span>ยังไม่มีมิติที่อยู่ในช่วงคะแนน 4–5</span></li>') +
         '</ul></div>';
    h += '<div class="card card--work"><h2 class="card__h">จุดที่ควรพัฒนา <span class="pill">คะแนน 1–2</span></h2>' +
         '<p class="card__note">ให้น้ำหนัก GRIT-Perseverance (S7) เป็นพิเศษหากคะแนนต่ำ</p><ul class="list">' +
         (R.improve.length ? R.improve.map(function (r) {
           return '<li><b>' + r.key + ' — ' + r.tag +
                  (r.anchor ? ' <span class="pill">น้ำหนักสูงสุด</span>' : '') + '</b><span>' +
                  r.advice + '</span></li>';
         }).join('') : '<li><span>ไม่มีมิติที่อยู่ในช่วงคะแนน 1–2</span></li>') +
         '</ul></div></div>';

    h += '<div class="card"><h2 class="card__h">Behavioral Response Pattern รายมิติ</h2>' +
         '<p class="card__note">Behavior Tag และคำแนะนำการพัฒนา ตามตัวเลือกที่ท่านเลือกจริง</p><div class="tags">';
    R.rows.forEach(function (r) {
      h += '<div class="tagrow"><div class="tagrow__dim">' + r.key +
           '<div class="tagrow__id" style="margin:0">' + (r.choiceId || '— หมดเวลา') +
           ' · ' + (r.score == null ? 'ไม่มีข้อมูล' : r.score + '/5') +
           '</div></div><div><p class="tagrow__tag">' + r.tag + '</p>' +
           '<p class="tagrow__advice">' + r.advice + '</p>' +
           (r.note ? '<p class="tagrow__advice" style="color:var(--amber)">' + r.note + '</p>' : '') +
           '</div></div>';
    });
    h += '</div></div>';

    h += '<div class="card"><h2 class="card__h">บันทึกการตัดสินใจ (raw log)</h2>' +
         '<p class="card__note">choice_id · ตำแหน่งที่แสดง · response_time_ms · timestamp — ตามที่เอกสารกำหนดให้ระบบบันทึก</p>' +
         '<table class="logtable"><thead><tr><th>#</th><th>question</th><th>choice_id</th>' +
         '<th>slot</th><th>score</th><th>time (ms)</th><th>timestamp</th></tr></thead><tbody>';
    S.decisions.forEach(function (d, i) {
      h += '<tr><td>' + (i + 1) + '</td><td class="mono">' + d.questionId + '</td>' +
           '<td class="mono">' + (d.choiceId || '—') + '</td><td>' + (d.displayedPosition || '—') +
           '</td><td>' + (d.score == null ? '—' : d.score) + '</td><td>' + d.responseTimeMs + '</td><td>' +
           new Date(d.timestamp).toLocaleTimeString('th-TH') + '</td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<div class="fb__cta"><p><b>ช่วยบอกความเห็นหน่อยครับ</b>' +
         '<span>นี่คือรอบทดสอบ (UAT) — ความเห็นของท่านจะถูกส่งกลับมาที่ทีมพัฒนาโดยตรง</span></p>' +
         '<button class="btn btn--primary" id="btn-feedback">ให้ความคิดเห็น ▸</button></div>';

    h += '<div class="card"><p class="note">Research note: “' + META.researchNote + '”</p>' +
         '<p class="status" id="save-status"></p>' +
         '<div class="row"><button class="btn btn--primary" id="btn-json">ดาวน์โหลด JSON</button>' +
         '<button class="btn" id="btn-csv">ดาวน์โหลด CSV</button>' +
         '<button class="btn" id="btn-print">พิมพ์ / บันทึก PDF</button>' +
         '<button class="btn" id="btn-again">เล่นอีกครั้ง</button>' +
         '<button class="btn" data-go="menu">กลับหน้าแรก</button></div></div>';

    $('#result').innerHTML = h;
    show('result');
    $('#screen-result').scrollTop = 0;
    $('#btn-json').onclick = function () { download('json'); };
    $('#btn-csv').onclick = function () { download('csv'); };
    $('#btn-print').onclick = function () { window.print(); };
    $('#btn-feedback').onclick = function () { buildFeedback(); show('feedback'); };
    $('#btn-again').onclick = begin;
    submitSession();
  }

  /* ── send the finished session to the server (if there is one) ─────────── */
  function submitSession(retry) {
    var n = $('#save-status');
    if (!n) return;
    if (!state.backend) {
      n.className = 'status';
      n.textContent = 'โหมดเดี่ยว — ผลถูกเก็บในเครื่องนี้ (localStorage) ' +
        'กรุณาดาวน์โหลด JSON/CSV เก็บไว้';
      return;
    }
    n.className = 'status';
    n.textContent = 'กำลังบันทึกผลขึ้นเซิร์ฟเวอร์…';
    fetch('api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.session)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'save failed');
        state.session.savedToServer = true;
        n.className = 'status status--ok';
        n.textContent = 'บันทึกผลขึ้นเซิร์ฟเวอร์แล้ว · session ' + d.sessionId;
      })
      .catch(function (e) {
        n.className = 'status status--bad';
        n.innerHTML = 'บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (' + esc(e.message || e) + ') — ' +
          'ผลยังอยู่ในเครื่องนี้ <button class="btn" id="btn-retry">ลองอีกครั้ง</button>';
        var b = $('#btn-retry');
        if (b) b.onclick = function () { submitSession(true); };
      });
  }

  /* ══════════ หน้าสุดท้าย: feedback (UAT) ══════════ */
  var FB_QUESTIONS = [
    { key: 'overall', q: 'ภาพรวมของต้นแบบนี้', hint: '1 = แย่มาก · 5 = ดีมาก' },
    { key: 'clarity', q: 'เนื้อเรื่องและคำถามเข้าใจง่ายแค่ไหน', hint: '1 = สับสน · 5 = ชัดเจนมาก' },
    { key: 'realism', q: 'สถานการณ์สมจริง/ใกล้เคียงงานจริงแค่ไหน', hint: '1 = ไม่สมจริง · 5 = สมจริงมาก' },
    { key: 'usability', q: 'การกดเลือกคำตอบในวีดีโอใช้งานง่ายแค่ไหน', hint: '1 = ยากมาก · 5 = ง่ายมาก' },
    { key: 'time', q: 'เวลา 20 วินาทีต่อข้อเหมาะสมไหม', hint: '1 = ไม่เหมาะ · 5 = เหมาะสมดี' },
    { key: 'recommend', q: 'จะแนะนำให้หน่วยงานอื่นลองใช้ไหม', hint: '1 = ไม่แนะนำ · 5 = แนะนำแน่นอน' }
  ];
  var fbScores = {};

  function buildFeedback() {
    var wrap = $('#fb-rates');
    if (wrap.childNodes.length) return;            // สร้างครั้งเดียวพอ
    FB_QUESTIONS.forEach(function (item) {
      var row = el('div', 'fbrow');
      var q = el('div', 'fbrow__q');
      q.appendChild(document.createTextNode(item.q));
      q.appendChild(el('small', null, item.hint));
      row.appendChild(q);
      var rate = el('div', 'rate');
      [1, 2, 3, 4, 5].forEach(function (n) {
        var b = el('button', null, String(n));
        b.type = 'button';
        b.setAttribute('aria-label', item.q + ' = ' + n);
        b.onclick = function () {
          fbScores[item.key] = n;
          var all = rate.querySelectorAll('button');
          for (var i = 0; i < all.length; i++) all[i].classList.toggle('is-on', i < n);
        };
        rate.appendChild(b);
      });
      row.appendChild(rate);
      wrap.appendChild(row);
    });
  }

  function sendFeedback(e) {
    if (e) e.preventDefault();
    var n = $('#fb-status');
    var val = function (id) { return ($(id).value || '').trim(); };
    var body = {
      sessionId: (state.session && state.session.sessionId) || null,
      callsign: (state.session && state.session.callsign) || '',
      unit: (state.session && state.session.unit) || '',
      accessCode: state.code || '',
      scores: fbScores,
      like: val('#fb-like'),
      issue: val('#fb-issue'),
      suggest: val('#fb-suggest'),
      name: val('#fb-name'),
      contact: val('#fb-contact'),
      finishedGame: !!(state.session && state.session.finishedAt),
      userAgent: navigator.userAgent,
      screen: window.innerWidth + 'x' + window.innerHeight,
      submittedAt: new Date().toISOString()
    };
    var empty = !Object.keys(fbScores).length && !body.like && !body.issue && !body.suggest;
    if (empty) {
      n.hidden = false;
      n.className = 'status status--bad';
      n.textContent = 'ช่วยให้คะแนนอย่างน้อยหนึ่งข้อ หรือเขียนความเห็นสักบรรทัดก่อนส่งครับ';
      return;
    }
    n.hidden = false;
    n.className = 'status';
    n.textContent = 'กำลังส่ง…';
    $('#fb-send').disabled = true;

    var done = function (ok, msg) {
      n.className = 'status status--' + (ok ? 'ok' : 'bad');
      n.textContent = msg;
      $('#fb-send').disabled = !ok ? false : true;
    };
    try { localStorage.setItem('aqg.feedback.last', JSON.stringify(body)); } catch (err) {}

    if (!state.backend) {
      download2('aqg-feedback.json', JSON.stringify(body, null, 2));
      return done(true, 'ไม่มีเซิร์ฟเวอร์ — บันทึกเป็นไฟล์ให้แล้ว กรุณาส่งไฟล์กลับมาให้ทีมงาน ขอบคุณครับ');
    }
    fetch('api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'ส่งไม่สำเร็จ');
        done(true, 'ส่งเรียบร้อย ขอบคุณมากครับ 🙏 ความเห็นของท่านช่วยให้ต้นแบบนี้ดีขึ้นจริงๆ');
      })
      .catch(function (err) {
        done(false, 'ส่งไม่สำเร็จ (' + esc(err.message || err) + ') — กดส่งอีกครั้งได้');
      });
  }

  function download2(name, body) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ── persistence / export ─────────────────────────────────────────────── */
  function saveSession(s) {
    try {
      var all = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      all.push(s);
      localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(-50)));
    } catch (e) { /* blocked storage — the result still shows */ }
  }
  function download(kind) {
    var s = state.session, name = 'aqg-' + s.sessionId, body, type;
    if (kind === 'json') {
      body = JSON.stringify(s, null, 2);
      type = 'application/json';
      name += '.json';
    } else {
      var cols = ['sessionId', 'callsign', 'unit', 'stageId', 'questionId', 'dimension',
        'choiceId', 'score', 'displayedPosition', 'displayedOrder', 'responseTimeMs',
        'timedOut', 'mode', 'timestamp'];
      var lines = [cols.join(',')];
      s.decisions.forEach(function (d) {
        lines.push(cols.map(function (c) {
          var v = (c in d) ? d[c] : s[c];
          if (Array.isArray(v)) v = v.join('|');
          v = v == null ? '' : String(v);
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(','));
      });
      body = '﻿' + lines.join('\r\n');
      type = 'text/csv;charset=utf-8';
      name += '.csv';
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: type }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ── static screens ───────────────────────────────────────────────────── */
  function fillStatic() {
    $('#menu-sub').textContent = META.subtitle;
    $('#menu-struct').textContent = META.structure;

    META.intro.forEach(function (p) { $('#intro-body').appendChild(el('p', null, p)); });
    [
      'ทั้งหมด 3 ด่าน / 6 จุดตัดสินใจ — ตัวเลือกปรากฏในวีดีโอและกดเลือกได้ทุกข้อ',
      'มีเวลาตัดสินใจ ' + META.timerSeconds + ' วินาทีต่อข้อ (กดปุ่ม A–E บนคีย์บอร์ดได้)',
      'คะแนนผูกกับเนื้อหาตัวเลือก (choice_id) ไม่ใช่ตำแหน่งบนจอ',
      'ระบบบันทึกคำตอบ ตำแหน่งที่แสดง และเวลาที่ใช้ตัดสินใจทุกข้อ',
      'ผลการประเมินจะแสดงหลังทำครบทุกสถานการณ์เท่านั้น'
    ].forEach(function (t) { $('#intro-rules').appendChild(el('li', null, t)); });

    [
      META.subtitle,
      META.structure,
      'เกณฑ์คะแนน: A=5, B=4, C=3, D=2, E=1 ผูกกับ choice_id คงที่ (เช่น S1_1_A) — คะแนนอ้างอิงจากเนื้อหา ไม่ใช่ตำแหน่งบนจอ',
      'ด่านที่ 3 (S7 — GRIT-Perseverance) เป็น Anchor/Benchmark หลักของเครื่องมือ และเป็นตัวพยากรณ์ผลปฏิบัติงานที่มีน้ำหนักสูงสุดตามผลถดถอย (β=+0.300)',
      'ตัวเลือกบนจอมาจากวีดีโอต้นฉบับ ซึ่งสลับตำแหน่งไว้แล้ว — ระบบบันทึกตำแหน่งที่แสดงทุกครั้งเพื่อวิเคราะห์ position bias ภายหลัง',
      'Research note: “' + META.researchNote + '”'
    ].forEach(function (p) { $('#about-body').appendChild(el('p', null, p)); });
  }

  function begin() {
    /* a replay must not inherit anything from the previous run */
    stopTimer();
    closeQuestion(true);
    state.pending = [];
    state.usedFallback = null;
    state.prefetched = null;
    state.locked = false;
    state.session = {
      sessionId: 'AQG-' + Date.now().toString(36).toUpperCase(),
      callsign: ($('#in-callsign').value || '').trim(),
      unit: ($('#in-unit').value || '').trim(),
      accessCode: state.code || '',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      timerSeconds: META.timerSeconds,
      mode: PANEL_MODE ? 'panel' : 'video',
      decisions: []
    };
    state.flow = buildFlow();
    runStep(0);
  }

  /* ── S00 title / briefing video ───────────────────────────────────────────
     Plays once after START (or after LOGIN), then hands over to the rules
     panel. Skippable, and if the file is missing it goes straight through. */
  function playTitle() {
    var T = $('#video-title');
    if (!META.titleVideo || !T) return show('intro');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      T.pause();
      T.ontimeupdate = T.onended = T.onerror = null;
      show('intro');
    }
    T.ontimeupdate = function () {
      $('#title-time').textContent = fmt(T.currentTime) + ' / ' + fmt(T.duration);
    };
    T.onended = finish;
    T.onerror = function () {
      if (META.titleVideoFallback && T.src.indexOf(META.titleVideoFallback) === -1) {
        T.src = META.titleVideoFallback;
        T.load();
        T.play();
        return;
      }
      finish();
    };
    $('#btn-title-skip').onclick = finish;
    if (!T.src) T.src = META.titleVideo;
    show('title');
    try { T.currentTime = 0; } catch (e) {}
    var p = T.play();
    if (p && p.catch) p.catch(function () { /* blocked — the skip button still works */ });
  }

  /* ── player controls ──────────────────────────────────────────────────── */
  function toggleMute() {
    if (!V) return;
    V.muted = !V.muted;
    $('#btn-mute').textContent = V.muted ? 'เปิดเสียง' : 'เสียง';
    $('#btn-mute').classList.toggle('is-off', V.muted);
  }
  function toggleFull() {
    var d = document, t = d.getElementById('screen-video');
    var fs = d.fullscreenElement || d.webkitFullscreenElement;
    if (fs) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else if (t.requestFullscreen || t.webkitRequestFullscreen) {
      (t.requestFullscreen || t.webkitRequestFullscreen).call(t);
    }
    setTimeout(placeHotspots, 120);
  }

  /* ── wiring ───────────────────────────────────────────────────────────── */
  function init() {
    fillStatic();
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-go]');
      if (!t) return;
      stopTimer();
      closeQuestion(true);
      if (V) V.pause();
      if ($('#video-title')) $('#video-title').pause();
      /* entering the assessment goes through the S00 title/briefing video */
      if (t.dataset.go === 'intro') {
        /* โหมดบังคับรหัส: กด START ต้องไปหน้ารหัสก่อน ไม่งั้นผู้เล่นจะเล่นจนจบ
           แล้วเซิร์ฟเวอร์ปฏิเสธการบันทึก = เสียข้อมูลไปทั้งรอบ */
        if (state.backend && state.backend.requireCode && !state.code) {
          show('login');
          loginStatus('ต้องใส่รหัสเข้าเล่นก่อนเริ่มการประเมิน', 'bad');
          $('#in-code').focus();
          return;
        }
        return playTitle();
      }
      show(t.dataset.go);
    });
    $('#btn-begin').onclick = begin;
    $('#btn-stage-go').onclick = next;
    $('#btn-login').onclick = doLogin;
    $('#fb-form').onsubmit = sendFeedback;
    $('#in-code').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
    $('#btn-mute').onclick = toggleMute;
    $('#btn-full').onclick = toggleFull;
    $('#timer').setAttribute('aria-live', 'off');
    document.addEventListener('fullscreenchange', placeHotspots);
    window.addEventListener('orientationchange', function () { setTimeout(placeHotspots, 250); });
    probeBackend();

    document.addEventListener('keydown', function (e) {
      if (state.screen === 'video' || state.q) {
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); return toggleFull(); }
        if (e.key === 'm' || e.key === 'M') { e.preventDefault(); return toggleMute(); }
      }
      if (state.screen === 'stagecard' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        next();
      } else if (state.q) {
        var k = e.key.toUpperCase();
        var i = LETTERS.indexOf(k);
        if (i < 0 && /^[1-5]$/.test(e.key)) i = +e.key - 1;
        if (i >= 0) {
          var nodes = document.querySelectorAll('#qlayer .hot, #qlayer .opt');
          if (nodes[i]) nodes[i].click();
        }
      } else if (state.screen === 'video' && (e.key === 'Escape' || e.key === ' ')) {
        e.preventDefault();
        skip();
      } else if (state.screen === 'title' && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        $('#btn-title-skip').click();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
