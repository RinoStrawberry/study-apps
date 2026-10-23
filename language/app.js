(function () {
  "use strict";

  var state = { candidates: [], session: null, startTime: null };

  function api() { return window.pywebview.api; }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // pywebview 쪽에서 처리하지 못한 예외는 여기로 reject되어 들어온다.
  function errText(e) {
    if (e && e.error) return e.error;
    if (e && e.message) return e.message;
    return String(e);
  }

  // ---- 앱 고르기(위 줄) · 갈래 탭(아래 줄) ----
  // 위 줄에서 외국어 공부·컴활 1급·한국사 1급 중 하나를 고르고, 아래 줄은 고른 앱의 갈래다.
  // 자격시험 앱은 갈래를 자기 화면 안에 갖고 있어 아래 줄을 접는다.
  var EXAM_APPS = { computer: ["frameComputer", "apps/computer.html"],
                    history2: ["frameHistory2", "apps/history.html"] };
  var EXAM_KEY = { computer: "kh-computer-1", history2: "hist1" };   // 시험앱이 쓰는 저장키
  var 외국어갈래 = "today";   // 외국어 공부로 돌아왔을 때 다시 펼칠 갈래

  var 지금앱 = "language";   // 지금 보고 있는 앱 — 테마를 누구에게 맞출지 정한다

  function setTab(name) {
    외국어갈래 = name;
    지금앱 = "language";
    호스트테마("light");       // 외국어 공부 화면은 밝은 결 하나로 둔다
    document.querySelectorAll("#appSeg .appseg-btn").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.app === "language"));
    });
    document.getElementById("navTabs").classList.remove("hidden");
    document.querySelector(".content").classList.remove("app-mode");
    document.querySelectorAll("#navTabs .k-tab").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.tab === name));
    });
    document.querySelectorAll(".screen").forEach(function (s) {
      s.classList.toggle("hidden", s.id !== "tab-" + name);
    });
  }
  document.getElementById("navTabs").addEventListener("click", function (e) {
    var b = e.target.closest(".k-tab");
    if (!b || b.disabled) return;
    setTab(b.dataset.tab);
    // 기록 탭은 시작할 때 한 번만 불러오면 그 뒤에 쌓인 글이 안 보이므로, 누를 때마다 새로 읽는다.
    if (b.dataset.tab === "history") loadHistory();
  });

  // ---- 자격시험 앱 기록: 참 기록은 파이썬이 들고 있다 ----
  // 창(WebView2)이 InPrivate 로 뜨는 탓에 브라우저 저장소는 창을 닫으면 지워진다. 그래서
  // 띄우기 전에 파이썬에 둔 기록을 저장소에 심고, 프레임 안에서 바뀐 것은 storage 사건으로
  // 받아 다시 파이썬에 적는다. 시험앱 쪽 코드는 한 줄도 건드리지 않는다.
  var 보낼것 = {};          // 저장키 -> {이름: 값(또는 null=지움)}
  var 보내기예약 = null;

  function 저장소키(저장키, 이름) { return "kh1:" + 저장키 + ":" + 이름; }

  function 심기(저장키) {
    if (!저장키) return Promise.resolve();
    return api().exam_load(저장키).then(function (res) {
      var 자료 = (res && res.자료) || {};
      Object.keys(자료).forEach(function (이름) {
        try {
          localStorage.setItem(저장소키(저장키, 이름), JSON.stringify({ v: 1, d: 자료[이름] }));
        } catch (e) { /* 저장소를 못 쓰면 기록 없이 뜬다 */ }
      });
    });
  }

  function 흘리기() {
    보내기예약 = null;
    Object.keys(보낼것).forEach(function (저장키) {
      var 묶음 = 보낼것[저장키];
      delete 보낼것[저장키];
      api().exam_write(저장키, 묶음)["catch"](function () { /* 다음 쓰기에서 다시 간다 */ });
    });
  }

  window.addEventListener("storage", function (e) {
    if (!e.key || e.key.indexOf("kh1:") !== 0) return;
    var 나머지 = e.key.slice(4);
    var 자리 = 나머지.indexOf(":");
    if (자리 < 0) return;
    var 저장키 = 나머지.slice(0, 자리);
    var 이름 = 나머지.slice(자리 + 1);
    if (이름 === "__t") return;                      // 엔진이 저장소를 쓸 수 있나 보는 검사키
    if (저장키 !== EXAM_KEY.computer && 저장키 !== EXAM_KEY.history2) return;
    var 값 = null;
    if (e.newValue !== null) {
      try {
        var 봉투 = JSON.parse(e.newValue);
        값 = (봉투 && 봉투.d !== undefined) ? 봉투.d : 봉투;
      } catch (err) { return; }
    }
    if (!보낼것[저장키]) 보낼것[저장키] = {};
    보낼것[저장키][이름] = 값;
    if (보내기예약) clearTimeout(보내기예약);
    보내기예약 = setTimeout(흘리기, 150);
    if (이름 === "설정" && EXAM_KEY[지금앱] === 저장키) 호스트테마(테마읽기(값));
  });
  window.addEventListener("pagehide", 흘리기);

  // ---- 테마: 보고 있는 시험앱이 어두우면 학습실 상단바도 따라 어두워진다 ----
  function 테마읽기(설정) { return (설정 && 설정.테마) || "auto"; }

  function 시험앱테마(저장키) {
    try {
      var raw = localStorage.getItem(저장소키(저장키, "설정"));
      if (!raw) return "auto";
      var 봉투 = JSON.parse(raw);
      return 테마읽기(봉투 && 봉투.d !== undefined ? 봉투.d : 봉투);
    } catch (e) { return "auto"; }
  }

  function 호스트테마(테마) {
    var 어둡게 = 테마 === "dark" || (테마 === "auto" && window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", 어둡게 ? "dark" : "light");
  }

  function mountExamApp(app) {
    var spec = EXAM_APPS[app];
    if (!spec) return;
    var el = document.getElementById(spec[0]);
    if (!el || el.dataset.loaded === "1") return;
    el.dataset.loaded = "1";
    function 띄우기() { el.src = spec[1]; 호스트테마(시험앱테마(EXAM_KEY[app])); }
    // 엔진은 뜨자마자 저장소를 동기로 읽는다 — 심기가 반드시 먼저다.
    심기(EXAM_KEY[app]).then(띄우기, 띄우기);
  }

  function setApp(app) {
    if (!EXAM_APPS[app]) { setTab(외국어갈래); if (외국어갈래 === "history") loadHistory(); return; }
    지금앱 = app;
    document.querySelectorAll("#appSeg .appseg-btn").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.app === app));
    });
    document.getElementById("navTabs").classList.add("hidden");
    document.querySelector(".content").classList.add("app-mode");
    document.querySelectorAll(".screen").forEach(function (s) {
      s.classList.toggle("hidden", s.id !== "tab-" + app);
    });
    mountExamApp(app);
    호스트테마(시험앱테마(EXAM_KEY[app]));
  }
  document.getElementById("appSeg").addEventListener("click", function (e) {
    var b = e.target.closest(".appseg-btn");
    if (!b) return;
    setApp(b.dataset.app);
  });

  function setLearnPanel(name) {
    document.querySelectorAll("#learnTabs .k-tab").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.panel === name));
    });
    document.querySelectorAll(".learn-panel").forEach(function (p) {
      p.classList.toggle("on", p.id === "panel-" + name);
    });
  }
  document.getElementById("learnTabs").addEventListener("click", function (e) {
    var b = e.target.closest(".k-tab");
    if (!b) return;
    setLearnPanel(b.dataset.panel);
  });

  function unlockTabs() {
    document.querySelectorAll('#navTabs .k-tab[data-locked="1"]').forEach(function (b) {
      b.disabled = false;
    });
  }

  // 외부 링크는 브라우저에서 연다
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a.ext");
    if (!a) return;
    e.preventDefault();
    api().open_external(a.getAttribute("href"));
  });

  // 오래 걸리는 단일 호출 동안에도 화면이 멈춘 게 아님을 보여주는 경과 시간 표시.
  // 실제 검색 단계까지는 알 수 없어 정직하게 "경과 시간"만 보여준다.
  function startTicker(el, baseMsg) {
    var start = Date.now();
    el.innerHTML = '<div class="k-note">' + baseMsg + ' <span class="tick">(0초 경과)</span></div>';
    var tick = el.querySelector(".tick");
    var timer = setInterval(function () {
      var sec = Math.round((Date.now() - start) / 1000);
      if (tick) tick.textContent = "(" + sec + "초 경과)";
    }, 1000);
    return function stop() { clearInterval(timer); };
  }

  // ---- 오늘의 글 ----
  document.getElementById("findBtn").addEventListener("click", function () {
    var lang = document.querySelector('input[name="lang"]:checked').value;
    var genre = document.getElementById("genreInput").value;
    var difficulty = document.getElementById("difficultySelect").value;
    var btn = this;
    var statusEl = document.getElementById("findStatus");
    btn.disabled = true;
    document.getElementById("candidateList").innerHTML = "";
    var stopTicker = startTicker(statusEl, "실제로 존재하는 글을 웹에서 검색하는 중입니다. 여러 차례 검색해 확인하므로 30초~1분 정도 걸릴 수 있습니다.");
    api().find_candidates(lang, genre, difficulty).then(function (res) {
      stopTicker();
      btn.disabled = false;
      statusEl.innerHTML = "";
      if (res && res.error) { toast(res.error); return; }
      state.candidates = res.candidates || [];
      renderCandidates();
    }).catch(function (e) {
      stopTicker();
      btn.disabled = false;
      statusEl.innerHTML = "";
      toast("글을 찾는 중 오류: " + errText(e));
    });
  });

  function renderCandidates() {
    var box = document.getElementById("candidateList");
    box.innerHTML = state.candidates.map(function (c, i) {
      return '' +
        '<div class="k-card">' +
        '<b>' + esc(c.title) + '</b>' +
        '<p>' + esc(c.source || "") + (c.length_hint ? " · " + esc(c.length_hint) : "") + '</p>' +
        '<p class="why">' + esc(c.why || "") + '</p>' +
        '<p><a class="ext" href="' + esc(c.url) + '">원문 링크 보기</a></p>' +
        '<div class="k-bar" style="padding-left:0;border-top:0;">' +
        '<button class="k-btn sm" data-idx="' + i + '">이 글로 필사 시작</button>' +
        '</div></div>';
    }).join("");
    box.querySelectorAll("button[data-idx]").forEach(function (btn) {
      btn.addEventListener("click", function () { chooseCandidate(Number(btn.dataset.idx), btn); });
    });
  }

  function chooseCandidate(idx, btn) {
    var candidate = state.candidates[idx];
    var lang = document.querySelector('input[name="lang"]:checked').value;
    var genre = document.getElementById("genreInput").value;
    var difficulty = document.getElementById("difficultySelect").value;
    var statusEl = document.getElementById("findStatus");
    btn.disabled = true;
    // 실제로 원문 확보(가져오기+본문 판별)와 학습 자료 생성은 별도의 네트워크
    // 호출이라, 그 경계에서 화면 문구를 바꿔 지금 어느 단계인지 정직하게 보여준다.
    var stopTicker = startTicker(statusEl, "원문을 가져와 실제 본문만 골라내는 중입니다.");
    api().fetch_source(candidate, lang, difficulty, genre).then(function (res) {
      stopTicker();
      if (res && res.error) { statusEl.innerHTML = ""; btn.disabled = false; toast(res.error); return; }
      stopTicker = startTicker(statusEl, "학습 자료(구성·핵심 문장·관용구·어휘·번역)를 만드는 중입니다.");
      return api().analyze_source(res.draft).then(function (res2) {
        stopTicker();
        statusEl.innerHTML = "";
        btn.disabled = false;
        if (res2 && res2.error) { toast(res2.error); return; }
        state.session = res2.session;
        unlockTabs();
        renderPassage(res2.session);
        renderLearn(res2.session);
        loadHistory();
        setTab("write");
      });
    }).catch(function (e) {
      stopTicker();
      statusEl.innerHTML = "";
      btn.disabled = false;
      toast("처리 중 오류: " + errText(e));
    });
  }

  // ---- 필사 ----
  // 기본은 **문단 단위**다. 문단을 통째로 옮겨 쓰되, 지금 치고 있는 문장만 밝게 보여 주어
  // 시선이 흩어지지 않게 하고, 맞게 친 글자와 틀린 글자를 그때그때 색으로 구분해 준다.
  // 채점(점수·속도)은 하지 않는다 — 맞았는지 재는 도구가 아니라 손으로 옮겨 적으며
  // 익히는 도구이고, 색 구분은 지금 어디가 어긋났는지 바로 알려 주는 길잡이일 뿐이다.
  //
  // 문장 단위는 일부러 고를 때만 쓰는 모드다. 번역을 띄우지 않는 대신, 그 문장에 들어 있는
  // 관용구·어휘와 핵심 문장 여부를 함께 보여 준다.
  //
  // 조각을 나눌 때 뒤따르던 공백·줄바꿈(sep)을 함께 기억한다. 그래야 조각+sep을 이어
  // 붙였을 때 원문이 한 글자도 어긋나지 않게 복원된다.

  var EN_ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|Inc|Ltd|Co|No|Fig|Vol|Ch|approx|e\.g|i\.e|U\.S|U\.K)\.)$/i;

  function splitSentences(t, lang) {
    var enders = lang === "ja" ? "。！？" : ".!?";
    var closers = "\"'’”)]」】";
    var out = [], start = 0, i, j, k;
    for (i = 0; i < t.length; i++) {
      if (enders.indexOf(t[i]) === -1) continue;
      j = i + 1;
      while (j < t.length && enders.indexOf(t[j]) !== -1) j++;   // ?! 처럼 겹친 것
      while (j < t.length && closers.indexOf(t[j]) !== -1) j++;  // 닫는 따옴표까지
      var head = t.slice(start, j).replace(/\s+$/, "");
      // 일본어는 공백이 없어도 문장이 끝난다. 영어는 뒤에 공백이나 끝이 와야 문장 끝이다.
      if (lang !== "ja" && j < t.length && !/\s/.test(t[j])) continue;
      // Mr. · U.S. · J. K. 처럼 마침표가 문장 끝이 아닌 경우를 걸러 낸다.
      if (lang !== "ja" && (EN_ABBR.test(head) || /(?:^|\s)[A-Z]\.$/.test(head))) continue;
      k = j;
      while (k < t.length && /\s/.test(t[k])) k++;
      out.push({ text: t.slice(start, j), sep: t.slice(j, k), off: start });
      start = k;
      i = k - 1;
    }
    if (start < t.length) out.push({ text: t.slice(start), sep: "", off: start });
    return out;
  }

  // 조각마다 (문단 번호, 문단 안에서의 시작 위치)를 함께 남긴다.
  // 그 두 값이 있어야 요미가나 토큰을 그 조각만큼 잘라낼 수 있다.
  function splitUnits(session, mode) {
    var lang = session.language || "en";
    var paras = session.paragraphs || [session.practice_target];
    var out = [];
    if (mode === "para") {
      paras.forEach(function (p, pi) {
        out.push({ text: p, sep: pi < paras.length - 1 ? "\n\n" : "", para: pi, off: 0 });
      });
      return { units: out, paraCount: paras.length };
    }
    paras.forEach(function (p, pi) {
      splitSentences(p, lang).forEach(function (u) { u.para = pi; out.push(u); });
      if (out.length) out[out.length - 1].sep += (pi < paras.length - 1 ? "\n\n" : "");
    });
    return { units: out, paraCount: paras.length };
  }

  // 나눈 조각을 도로 이으면 원문이 그대로 나와야 한다. 안 그러면 뒤에서 뒤죽박죽이 된다.
  function unitsLossless(units, target) {
    return units.map(function (u) { return u.text + u.sep; }).join("") === target;
  }

  // 요미가나 토큰(문단 단위)에서 이 조각에 해당하는 만큼만 잘라낸다.
  // 걸쳐 있는 토큰은 읽는 법을 버린다 — 반쪽짜리 한자에 루비를 붙이면 틀린 정보가 된다.
  function rubyFor(u) {
    var all = (state.session && state.session.ruby) || null;
    if (!all || !all[u.para]) return null;
    var toks = all[u.para], from = u.off, to = u.off + u.text.length;
    var pos = 0, out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].t, s = pos, e = pos + t.length;
      pos = e;
      if (e <= from || s >= to) continue;
      if (s >= from && e <= to) { out.push(toks[i]); continue; }
      out.push({ t: t.slice(Math.max(from - s, 0), Math.min(to - s, t.length)) });
    }
    return out;
  }

  // 원문을 글자 단위 span으로 그린다. 한자 묶음에는 <ruby>로 요미가나를 얹는다.
  // span 하나하나에 조각 안에서의 위치(i)와 몇 번째 문장인지(si)를 새겨 둔다.
  function buildTarget(u) {
    var toks = (state.showRuby && rubyFor(u)) || [{ t: u.text }];
    var lang = (state.session && state.session.language) || "en";
    // 문장 경계(문단 모드에서 지금 치는 문장만 밝히려면 필요하다)
    var bounds = state.mode === "para"
      ? splitSentences(u.text, lang).map(function (s) { return s.off; })
      : [0];
    function sentIndexAt(i) {
      var si = 0;
      for (var b = 0; b < bounds.length; b++) if (i >= bounds[b]) si = b;
      return si;
    }
    var html = "", idx = 0;
    for (var t = 0; t < toks.length; t++) {
      var tok = toks[t], spans = "";
      for (var c = 0; c < tok.t.length; c++) {
        var ch = tok.t[c];
        // 띄어쓰기를 &nbsp;로 그리면 **거기서 줄을 못 바꾼다**. 그래서 영어가
        // `grey ch/eck`처럼 낱말 한복판에서 잘렸다. 칸은 `white-space: pre-wrap`이
        // 이미 공백을 살려 두므로, 보통 공백을 그대로 써서 줄바꿈 자리를 남긴다.
        spans += '<span class="ch" data-i="' + idx + '" data-si="' + sentIndexAt(idx) + '">' +
          esc(ch) + "</span>";
        idx++;
      }
      html += (tok.r) ? "<ruby>" + spans + "<rt>" + esc(tok.r) + "</rt></ruby>" : spans;
    }
    state.sentCount = bounds.length;
    return html;
  }

  function setupUnits() {
    var s = state.session;
    var split = splitUnits(s, state.mode);
    var units = split.units;
    if (!unitsLossless(units, s.practice_target)) {
      // 문장으로 정확히 나누지 못하는 글이 있다. 문단은 원문 배열 그대로라 언제나 안전하다.
      if (state.mode !== "para") toast("이 글은 문장으로 정확히 나누지 못해 문단 단위로 보여 드립니다.");
      state.mode = "para";
      var r = document.querySelector('input[name="mode"][value="para"]');
      if (r) r.checked = true;
      split = splitUnits(s, "para");
      units = split.units;
    }
    state.units = units;
    state.paraCount = split.paraCount;
    state.typedUnits = units.map(function () { return ""; });
    state.idx = 0;
    state.startTime = null;

    document.getElementById("stageTitle").textContent =
      state.mode === "para" ? "이번 문단" : "이번 문장";
    document.getElementById("unitHint").textContent = state.mode === "para"
      ? "지금 치는 문장이 밝게 표시됩니다. 다 쓰면 다음 문단으로 넘어가세요."
      : "번역 없이 문장에만 집중하는 모드입니다. Enter로 다음 문장.";
    document.getElementById("transBtn").classList.toggle("hidden", state.mode !== "para");
    document.getElementById("doneBox").classList.add("hidden");
    document.getElementById("finishBtn").disabled = true;
    document.getElementById("unitInput").disabled = false;
    renderUnit();
  }

  function renderUnit() {
    var u = state.units[state.idx];
    var box = document.getElementById("unitTarget");
    box.innerHTML = u ? buildTarget(u) : "";
    state.chars = box.querySelectorAll(".ch");

    var prev = state.idx > 0 ? state.units[state.idx - 1] : null;
    document.getElementById("unitPrev").textContent = prev ? prev.text : "";
    document.getElementById("unitCount").textContent = u
      ? (state.mode === "para"
          ? "— 문단 " + (state.idx + 1) + " / " + state.units.length
          : "— 문장 " + (state.idx + 1) + " / " + state.units.length +
            " · 문단 " + (u.para + 1) + " / " + state.paraCount)
      : "";

    var input = document.getElementById("unitInput");
    input.value = state.typedUnits[state.idx] || "";
    input.rows = Math.min(10, Math.max(3, Math.ceil((u ? u.text.length : 0) / 46)));
    input.focus();
    document.getElementById("unitBackBtn").disabled = state.idx === 0;
    renderUnitTrans();
    renderUnitAid();
    diffUnit(input.value);
  }

  // 맞게 친 글자와 틀린 글자를 그때그때 구분해 준다(점수는 매기지 않는다).
  // 문단 모드에서는 커서가 있는 문장만 밝히고 나머지는 흐리게 둔다.
  function diffUnit(typed) {
    var u = state.units[state.idx];
    if (!u || !state.chars) return;
    var chars = state.chars, target = u.text;
    var curSent = -1;
    for (var i = 0; i < chars.length; i++) {
      var cls = "ch";
      if (i < typed.length) cls += (typed[i] === target[i]) ? " ok" : " bad";
      else if (i === typed.length) { cls += " cur"; curSent = +chars[i].dataset.si; }
      chars[i].className = cls;
    }
    if (curSent === -1 && chars.length) curSent = +chars[chars.length - 1].dataset.si;
    if (state.mode === "para" && state.sentCount > 1) {
      for (var j = 0; j < chars.length; j++) {
        if (+chars[j].dataset.si !== curSent) chars[j].className += " dim";
      }
    }
    state.typedUnits[state.idx] = typed;
    var pct = target.length ? Math.min(typed.length / target.length, 1) * 100 : 0;
    document.getElementById("unitBar").style.width = pct + "%";
    var done = typed === target;
    document.getElementById("unitBar").classList.toggle("done", done);
    var stage = document.querySelector(".unit-stage");
    if (done && !state._wasDone) { stage.classList.add("just-done"); setTimeout(function () { stage.classList.remove("just-done"); }, 700); }
    state._wasDone = done;
    return done;
  }

  // 이 조각의 번역(문단 모드에서만). 문단 모드에서는 문단 번역과 단위가 정확히 맞는다.
  function unitTranslation(u) {
    if (!u || !state.session) return null;
    var a = state.session.analysis || {};
    var norm = function (s) { return String(s == null ? "" : s).replace(/\s+/g, ""); };
    var ks = a.key_sentences || [], key = norm(u.text);
    for (var i = 0; i < ks.length; i++) {
      if (norm(ks[i].quote) === key) {
        var t = pick(ks[i], "translation_ko", "translation", "ko");
        if (t) return { text: t, scope: "문장" };
      }
    }
    var tr = a.translation || [];
    for (var j = 0; j < tr.length; j++) {
      if (tr[j].paragraph_index === u.para) {
        var p = pick(tr[j], "ko_natural", "ko");
        if (p) return { text: p, scope: "문단" };
      }
    }
    return null;
  }

  function renderUnitTrans() {
    var box = document.getElementById("unitTrans");
    if (state.mode !== "para" || !state.showTrans) { box.classList.add("hidden"); return; }
    var t = unitTranslation(state.units[state.idx]);
    box.innerHTML = t
      ? '<span class="scope">' + t.scope + ' 번역</span>' + esc(t.text)
      : '<span class="scope">번역 없음</span>';
    box.classList.remove("hidden");
  }

  // 문장 모드는 번역을 띄우지 않는 대신, 그 문장에 실제로 들어 있는 것을 짚어 준다.
  // (핵심 문장 여부 · 그 문장에 나온 관용구와 어휘의 뜻)
  function renderUnitAid() {
    var box = document.getElementById("unitAid");
    var u = state.units[state.idx];
    if (state.mode !== "sent" || !u || !state.session) { box.classList.add("hidden"); return; }
    var a = state.session.analysis || {};
    var norm = function (s) { return String(s == null ? "" : s).replace(/\s+/g, ""); };
    var text = norm(u.text), chips = "";
    var ks = a.key_sentences || [];
    for (var i = 0; i < ks.length; i++) {
      if (norm(ks[i].quote) === text) { chips += '<span class="chip key">핵심 문장</span>'; break; }
    }
    (a.idioms || []).forEach(function (x) {
      var p = pick(x, "phrase", "idiom", "expression");
      if (p && text.indexOf(norm(p)) !== -1) {
        chips += '<span class="chip idiom">' + esc(p) + '<em>' + esc(pick(x, "meaning_ko", "meaning")) + '</em></span>';
      }
    });
    (a.vocabulary || []).forEach(function (x) {
      var w = pick(x, "word", "term", "expression");
      if (w && text.indexOf(norm(w)) !== -1) {
        chips += '<span class="chip vocab">' + esc(w) + '<em>' + esc(pick(x, "meaning_ko", "meaning")) + '</em></span>';
      }
    });
    if (!chips) { box.classList.add("hidden"); return; }
    box.innerHTML = chips;
    box.classList.remove("hidden");
  }

  document.getElementById("transBtn").addEventListener("click", function () {
    state.showTrans = !state.showTrans;
    this.textContent = state.showTrans ? "번역 숨기기" : "번역 보기";
    this.setAttribute("aria-pressed", String(state.showTrans));
    renderUnitTrans();
    document.getElementById("unitInput").focus();
  });

  document.getElementById("rubyChk").addEventListener("change", function () {
    state.showRuby = this.checked;
    renderUnit();
  });

  document.getElementById("modePick").addEventListener("change", function (e) {
    if (!e.target.name || e.target.name !== "mode" || !state.session) return;
    state.mode = e.target.value;
    document.getElementById("modeHelp").textContent = state.mode === "para"
      ? "문단을 통째로 옮겨 씁니다. 지금 치는 문장이 밝게 표시되고, 맞게 친 글자와 틀린 글자가 바로 구분됩니다."
      : "문장을 하나씩만 보여 줍니다. 번역은 뜨지 않고, 그 문장에 나온 관용구·어휘를 대신 짚어 줍니다.";
    setupUnits();
  });

  function goUnit(delta) {
    var next = state.idx + delta;
    if (next < 0) return;
    if (next >= state.units.length) { finishStage(); return; }
    state.idx = next;
    state._wasDone = false;
    renderUnit();
  }

  function finishStage() {
    document.getElementById("doneBox").classList.remove("hidden");
    document.getElementById("doneText").textContent =
      (state.mode === "para" ? "모든 문단을" : "모든 문장을") +
      " 훑었습니다. 완료를 누르면 기록에 남고, 학습 탭에서 이어서 공부할 수 있습니다.";
    document.getElementById("finishBtn").disabled = false;
    document.getElementById("unitInput").blur();
  }

  document.getElementById("unitInput").addEventListener("input", function () {
    if (!state.startTime) state.startTime = Date.now();
    diffUnit(this.value);
  });

  document.getElementById("unitInput").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    // 문단 안에는 줄바꿈이 없다(문단끼리는 조각으로 나뉘어 있다).
    e.preventDefault();
    goUnit(1);
  });

  document.getElementById("unitBackBtn").addEventListener("click", function () { goUnit(-1); });
  document.getElementById("unitSkipBtn").addEventListener("click", function () { goUnit(1); });

  // 출처·이용조건 — 라이선스가 붙은 글은 화면에 출처를 그대로 보여야 한다(CC BY-SA 등).
  function renderLicense(session) {
    var 상자들 = ["licenseBox", "licenseBoxLearn"].map(function (id) {
      return document.getElementById(id);
    }).filter(Boolean);
    if (!상자들.length) return;
    var lic = session["이용조건"] || {};
    var src = session.source || {};
    var url = src.url || "";
    var 라이선스 = lic["라이선스"] || "";
    var 표시 = lic["표시"] || "";
    if (!표시) {
      // 표시 문구를 따로 쓰지 않는 글도 출처는 보여야 한다 — 글 정보로 한 줄을 만든다.
      var 조각 = [];
      if (src.source_name) 조각.push(src.source_name);
      if (src.title) 조각.push(src.title);
      표시 = 조각.join(" — ");
    }
    var 덧말 = [];
    if (url && 표시.indexOf(url) < 0) 덧말.push(url);
    if (lic["배포"] === "내부") {
      덧말.push("이용 범위는 개인 학습입니다. 다른 곳에 옮겨 실으려면 이용 조건을 먼저 확인합니다.");
    }
    상자들.forEach(function (box) {
      box.textContent = "";
      if (!표시 && !url) { box.classList.add("hidden"); return; }
      box.classList.remove("hidden");
      var head = document.createElement("div");
      head.className = "lic-head";
      head.textContent = "출처" + (라이선스 ? " · " + 라이선스 : "");
      box.appendChild(head);
      var body = document.createElement("div");
      body.className = "lic-body";
      body.textContent = 표시 || url;
      box.appendChild(body);
      if (!덧말.length) return;
      var note = document.createElement("div");
      note.className = "lic-note";
      note.textContent = 덧말.join("\n");
      box.appendChild(note);
    });
  }

  function renderPassage(session) {
    var meta = document.getElementById("sourceMeta");
    var truncNote = session.truncated ? " (발췌 — 원문 일부)" : "";
    meta.textContent = "— " + (session.source.title || "") + " · " +
      (session.source.source_name || "") + truncNote;
    renderLicense(session);
    // 전문은 접어 둔다 — 띄워 놓으면 눈이 훑기만 하고 손이 따라가지 않는다.
    var full = document.getElementById("fullText");
    full.textContent = session.practice_target || "";
    full.classList.add("hidden");
    var btn = document.getElementById("fullTextBtn");
    btn.textContent = "전문 보기";
    btn.setAttribute("aria-expanded", "false");
    // 사용자가 고른 표시 설정은 글이 바뀌어도 유지한다.
    var tb = document.getElementById("transBtn");
    tb.textContent = state.showTrans ? "번역 숨기기" : "번역 보기";
    tb.setAttribute("aria-pressed", String(!!state.showTrans));
    // 요미가나는 일본어 글에서만 뜻이 있다.
    var isJa = session.language === "ja";
    document.getElementById("rubyWrap").classList.toggle("hidden", !isJa);
    document.getElementById("rubyChk").checked = state.showRuby !== false;
    state.showRuby = isJa && state.showRuby !== false;
    // 쓰는 단위는 사용자가 고른 값을 따르고, 고른 적이 없으면 기본값(문단)으로 시작한다.
    var picked = document.querySelector('input[name="mode"]:checked');
    state.mode = state.mode || (picked ? picked.value : "para");
    if (picked) picked.checked = false;
    var want = document.querySelector('input[name="mode"][value="' + state.mode + '"]');
    if (want) want.checked = true;
    setupUnits();
  }

  document.getElementById("fullTextBtn").addEventListener("click", function () {
    var full = document.getElementById("fullText");
    var 펼침 = full.classList.toggle("hidden") === false;
    this.textContent = 펼침 ? "전문 접기" : "전문 보기";
    this.setAttribute("aria-expanded", String(펼침));
  });

  function finishTyping() {
    if (!state.units) return;
    // 문장을 원문의 구분자 그대로 이어 붙인다 — 기록에는 실제로 친 내용이 그대로 남는다.
    var typed = state.units.map(function (u, i) {
      return (state.typedUnits[i] || "") + u.sep;
    }).join("");
    var elapsed = state.startTime ? (Date.now() - state.startTime) / 1000 : 0;
    api().save_typing_result(state.session.id, typed, elapsed).then(function (res) {
      if (res && res.error) { toast(res.error); return; }
      document.getElementById("unitInput").disabled = true;
      toast("저장했습니다 — 학습 탭에서 이어서 공부해 보세요.");
      showMetWords(res.encounters || []);
      loadHistory();
    }).catch(function (e) { toast("저장 중 오류: " + errText(e)); });
  }
  // 옮겨 쓴 글에서 만난 단어장 단어. 글 속 맥락에서 다시 만나는 것도 단어를 익히는 한 갈래다.
  function showMetWords(met) {
    var box = document.getElementById("doneWords");
    if (!met.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    document.getElementById("doneBox").classList.remove("hidden");
    var 새 = met.filter(function (m) { return m.new; }).length;
    box.innerHTML = '<p class="k-help">이 글에서 단어장 단어 ' + met.length + "개를 만났습니다. " +
      (새 ? "아직 안 외운 " + 새 + "개는 다음 카드에서 먼저 나오고, " : "") +
      "이미 외운 단어는 글에서 만난 것만으로 가벼운 복습이 됩니다.</p>" +
      '<div class="done-chips">' + met.map(function (m) {
        return '<button type="button" class="chip col" data-word="' + esc(m.id) + '">' + esc(m.headword) +
          (m.new ? ' <span class="k-badge mute">새 단어</span>' : "") + "</button>";
      }).join("") + "</div>";
    box.classList.remove("hidden");
  }
  document.getElementById("doneWords").addEventListener("click", function (e) {
    var b = e.target.closest("[data-word]");
    if (b && window.vocabOpenWord) window.vocabOpenWord(b.getAttribute("data-word"));
  });
  document.getElementById("finishBtn").addEventListener("click", finishTyping);
  document.getElementById("stopBtn").addEventListener("click", finishTyping);

  // ---- 학습 ----
  // 글마다 항목 이름이 제각각이라(phrase/idiom/expression 등) 한 이름만 읽으면 화면이 빈다.
  // 있을 수 있는 이름을 차례로 훑어 처음 값이 있는 것을 쓴다.
  function pick(obj) {
    for (var i = 1; i < arguments.length; i++) {
      var v = obj[arguments[i]];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return "";
  }

  function renderLearn(session) {
    var a = (session && session.analysis) || {};
    var paras = (session && session.paragraphs) || [];
    document.getElementById("overviewText").textContent = a.overview || "";

    document.getElementById("panel-structure").innerHTML = (a.structure || []).map(function (s) {
      return '<div class="learn-item"><div class="quote">문단 ' + s.paragraph_index + " — " + esc(s.role) + '</div><p>' + esc(s.note) + "</p></div>";
    }).join("") || "<p>내용이 없습니다.</p>";

    document.getElementById("panel-sentences").innerHTML = (a.key_sentences || []).map(function (s) {
      var flag = s.verified === false ? '<span class="unverified">[원문과 정확히 일치하지 않을 수 있음]</span>' : "";
      var why = pick(s, "why", "reason", "reason_ko", "explain_ko");
      var trans = pick(s, "translation_ko", "translation", "ko");
      return '<div class="learn-item"><div class="quote">' + esc(s.quote) + flag + '</div>' +
        (why ? '<p>' + esc(why) + '</p>' : "") +
        (trans ? '<p>번역: ' + esc(trans) + '</p>' : "") + "</div>";
    }).join("") || "<p>내용이 없습니다.</p>";

    document.getElementById("panel-idioms").innerHTML = (a.idioms || []).map(function (s) {
      var phrase = pick(s, "phrase", "idiom", "expression", "quote");
      var reading = pick(s, "reading");
      var note = pick(s, "usage_note", "usage_note_ko", "business_note_ko", "business_usage_ko", "note_ko");
      return '<div class="learn-item"><div class="quote">' + esc(phrase) +
        (reading ? ' <span class="reading">(' + esc(reading) + ')</span>' : "") + '</div>' +
        '<p>' + esc(pick(s, "meaning_ko", "meaning")) + '</p>' +
        (note ? '<p>' + esc(note) + '</p>' : "") + "</div>";
    }).join("") || "<p>내용이 없습니다.</p>";

    document.getElementById("panel-vocab").innerHTML = (a.vocabulary || []).map(function (s) {
      var word = pick(s, "word", "term", "expression");
      var reading = pick(s, "reading");
      var syn = pick(s, "synonyms", "synonyms_ja", "alternatives");
      if (Array.isArray(syn)) syn = syn.join(", ");
      var vnote = pick(s, "note_ko", "usage_note", "note");
      return '<div class="learn-item"><div class="quote">' + esc(word) +
        (reading ? ' <span class="reading">(' + esc(reading) + ')</span>' : "") + '</div>' +
        '<p>' + esc(pick(s, "meaning_ko", "meaning")) + '</p>' +
        (syn ? '<p>유의어: ' + esc(syn) + '</p>' : "") +
        (vnote ? '<p class="why">' + esc(vnote) + '</p>' : "") + "</div>";
    }).join("") || "<p>내용이 없습니다.</p>";

    document.getElementById("panel-paraphrase").innerHTML = (a.paraphrase || []).map(function (s) {
      var flag = s.verified === false ? '<span class="unverified">[원문과 정확히 일치하지 않을 수 있음]</span>' : "";
      var alts = (pick(s, "alternatives", "alternatives_ja") || []).map(function (t) { return '<div class="alt">- ' + esc(t) + "</div>"; }).join("");
      var pnote = pick(s, "note_ko", "note");
      return '<div class="learn-item"><div class="quote">' + esc(s.original) + flag + "</div>" + alts +
        (pnote ? '<p class="why">' + esc(pnote) + '</p>' : "") + "</div>";
    }).join("") || "<p>내용이 없습니다.</p>";

    document.getElementById("panel-grammar").innerHTML = (a.grammar || []).map(function (s) {
      var flag = (s.verified === false || s.diagram_ok === false)
        ? '<span class="unverified">[원문과 정확히 일치하지 않을 수 있음]</span>' : "";
      var examples = (s.examples || []).map(function (t) { return '<div class="alt">- ' + esc(t) + "</div>"; }).join("");
      var pitfall = s.pitfall_ko ? '<p>흔한 실수: ' + esc(s.pitfall_ko) + '</p>' : "";
      // 문법 용어는 한국어를 앞세우고, 그 언어에서 실제로 쓰는 원래 용어를 괄호에 넣는다.
      var native = pick(s, "term_native", "term_ja", "term_en");
      var head = s.term_ko
        ? esc(s.term_ko) + (native ? " (" + esc(native) + ")" : "")
        : esc(native);
      return '<div class="learn-item">' +
        '<div class="quote">' + head + flag + '</div>' +
        '<p>' + esc(s.quote) + '</p>' +
        '<p class="why">' + esc(s.diagram) + '</p>' +
        '<p>' + esc(s.explain_ko) + '</p>' +
        examples + pitfall +
        '</div>';
    }).join("") || "<p>내용이 없습니다.</p>";

    document.getElementById("panel-translation").innerHTML = (a.translation || []).map(function (s) {
      var notes = (s.notes || []).map(function (n) {
        return '<div class="alt">- ' + esc(n.source_phrase) + ": " + esc(n.issue) + " → " + esc(n.choice) +
          (n.reason ? " (" + esc(n.reason) + ")" : "") + "</div>";
      }).join("");
      // 번역만 있으면 무엇을 옮긴 것인지 알 수 없다. 해당 문단 원문을 함께 보여 준다.
      var src = paras[s.paragraph_index];
      // 문체 설명(register_ko)은 왜 그렇게 옮겼는지를 알려 주는 대목이라 함께 보여 준다.
      var reg = pick(s, "register_ko", "register", "tone_ko");
      return '<div class="learn-item"><div class="quote">문단 ' + s.paragraph_index + '</div>' +
        (src ? '<p class="src-para">' + esc(src) + '</p>' : "") +
        '<p>직역: ' + esc(s.ko_literal) + '</p>' +
        '<p>번역: ' + esc(s.ko_natural) + '</p>' +
        (reg ? '<p class="why">문체: ' + esc(reg) + '</p>' : "") +
        notes +
        "</div>";
    }).join("") || "<p>내용이 없습니다.</p>";

    setLearnPanel("structure");
  }

  // ---- 기록 ----
  // 글이 수백 편으로 늘어, 언어로 추려 보고 여러 기준으로 줄 세울 수 있게 한다.
  // 줄 세우는 기준은 main.py의 HISTORY_SORTS와 같아야 한다(저장할 때 거기서 거른다).
  var SORTS = ["date", "title", "difficulty", "genre", "status", "language"];
  // 기준마다 두 방향을 말로 적는다. [오름차순, 내림차순]
  var DIR_LABEL = {
    date: ["오래된 것부터", "최근 것부터"],
    title: ["오름차순", "내림차순"],
    difficulty: ["쉬운 것부터", "어려운 것부터"],
    genre: ["오름차순", "내림차순"],
    status: ["안 쓴 글부터", "쓴 글부터"],
    language: ["영어부터", "일본어부터"]
  };
  // 기준을 처음 고를 때의 방향 — 날짜만 최근 것이 위로 오게 한다.
  var DIR_DEFAULT = { date: "desc" };
  var DIFF_NAME = { easy: "쉬움", mid: "보통", hard: "어려움" };
  var DIFF_RANK = { easy: 0, mid: 1, hard: 2 };
  var LANG_RANK = { en: 0, ja: 1 };
  // 제목은 그 글의 언어 규칙으로 비교한다 — 일본어는 가나 오십음 순, 영어는 알파벳 순.
  // numeric: 나눠 실은 글의 「（2/10）」이 「（10/10）」보다 앞에 오게 한다.
  function makeColl(loc) {
    try { return new Intl.Collator(loc, { numeric: true, sensitivity: "base" }); } catch (e) { return null; }
  }
  var COLL = { en: makeColl("en"), ja: makeColl("ja"), ko: makeColl("ko") };
  // 맨 앞의 따옴표·괄호는 순서를 정할 때 보지 않는다(「日本…」은 に 자리에 온다).
  var LEAD_MARKS = /^[\s「『【〈《（(［\["'“‘]+/;
  function cmpText(a, b, lang) {
    a = a || ""; b = b || "";
    var ka = a.replace(LEAD_MARKS, "") || a, kb = b.replace(LEAD_MARKS, "") || b;
    var coll = COLL[lang] || COLL.ko;
    return coll ? coll.compare(ka, kb) : cmpPlain(ka, kb);
  }
  function cmpPlain(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function rankOf(table, v) { return Object.prototype.hasOwnProperty.call(table, v) ? table[v] : 99; }
  // 언어가 다른 두 제목은 영어를 앞에 두고, 같은 언어끼리는 그 언어 규칙으로 비교한다.
  function cmpTitle(a, b) {
    return (rankOf(LANG_RANK, a.language) - rankOf(LANG_RANK, b.language)) ||
      cmpText(a.title, b.title, a.language);
  }

  var hist = { rows: [], language: "all", sort: "date", dir: "desc", find: "", prefsApplied: false };

  // 나눠 실은 글(제목 끝 「（n/m）」)은 한 묶음으로 줄 세운다. 날짜·제목은 편마다 값이 달라
  // 방향을 뒤집으면 10편부터 거꾸로 나오므로, 묶음 전체가 같은 값을 갖게 해 둔다.
  // 묶음 안에서는 방향과 상관없이 아래의 제목 비교(오름차순)가 1편부터 차례로 세운다.
  var PART_RE = /（(\d+)\/(\d+)）\s*$/;
  function seriesInfo(rows) {
    var info = {}, first = {};
    rows.forEach(function (r) {
      var title = r.title || "", m = PART_RE.exec(title);
      var base = m ? title.slice(0, m.index) : title;
      var key = m ? r.language + "\u0000" + base + "\u0000" + m[2] : "#" + r.id;
      var d = (r.created_at || "") + "\u0000" + r.id;
      if (!Object.prototype.hasOwnProperty.call(first, key) || d < first[key]) first[key] = d;
      info[r.id] = { key: key, base: base };
    });
    rows.forEach(function (r) { info[r.id].date = first[info[r.id].key]; });
    return info;
  }

  // 값이 비었거나 알 수 없는 글 — 방향과 상관없이 늘 맨 뒤에 둔다.
  function histMissing(key, r) {
    switch (key) {
      case "title": return !r.title;
      case "genre": return !r.genre;
      case "difficulty": return !Object.prototype.hasOwnProperty.call(DIFF_RANK, r.difficulty);
      case "language": return !Object.prototype.hasOwnProperty.call(LANG_RANK, r.language);
      case "date": return !r.created_at;
      default: return false;
    }
  }
  function histPrimary(key, info) {
    switch (key) {
      case "title": return function (a, b) {
        var ia = info[a.id], ib = info[b.id];
        return (rankOf(LANG_RANK, a.language) - rankOf(LANG_RANK, b.language)) ||
          cmpText(ia.base, ib.base, a.language) || cmpPlain(ia.key, ib.key);
      };
      case "difficulty": return function (a, b) { return rankOf(DIFF_RANK, a.difficulty) - rankOf(DIFF_RANK, b.difficulty); };
      case "genre": return function (a, b) { return cmpText(a.genre, b.genre, "ko"); };
      case "status": return function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); };
      case "language": return function (a, b) { return rankOf(LANG_RANK, a.language) - rankOf(LANG_RANK, b.language); };
      default: return function (a, b) { return cmpPlain(info[a.id].date, info[b.id].date); };
    }
  }
  function sortHistory(rows, key, dir, info) {
    info = info || seriesInfo(rows);
    var first = histPrimary(key, info), sign = dir === "desc" ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var ma = histMissing(key, a), mb = histMissing(key, b);
      if (ma !== mb) return ma ? 1 : -1;
      var c = ma ? 0 : first(a, b);
      if (c) return c * sign;
      // 같은 값끼리는 제목 순서를 지켜, 나눠 실은 글이 1편부터 차례로 붙어 있게 한다.
      return cmpTitle(a, b) || cmpPlain(a.id, b.id);
    });
  }
  // 전각·반각, 대소문자를 가리지 않고 찾는다.
  function foldText(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFKC");
    return s.toLowerCase();
  }
  function histMatches(r, q) {
    return !q || foldText(r.title).indexOf(q) >= 0 || foldText(r.genre).indexOf(q) >= 0;
  }

  function saveHistoryPrefs() {
    api().save_history_prefs({ language: hist.language, sort: hist.sort, dir: hist.dir })
      .catch(function () {});
  }

  function renderHistoryControls() {
    document.querySelectorAll("#hLang button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === hist.language));
    });
    document.getElementById("hSort").value = hist.sort;
    var lab = DIR_LABEL[hist.sort] || DIR_LABEL.date;
    var asc = document.getElementById("hDirAsc"), desc = document.getElementById("hDirDesc");
    asc.textContent = lab[0];
    desc.textContent = lab[1];
    asc.setAttribute("aria-pressed", String(hist.dir === "asc"));
    desc.setAttribute("aria-pressed", String(hist.dir === "desc"));
    document.querySelectorAll("#histHead th[data-sort]").forEach(function (th) {
      var on = th.dataset.sort === hist.sort;
      th.setAttribute("aria-sort", on ? (hist.dir === "asc" ? "ascending" : "descending") : "none");
      th.querySelector(".th-mark").textContent = on ? (hist.dir === "asc" ? "▲" : "▼") : "";
    });
  }

  function renderHistory() {
    var q = foldText(hist.find.trim());
    var found = hist.rows.filter(function (r) { return histMatches(r, q); });
    var n = { all: found.length, en: 0, ja: 0 };
    found.forEach(function (r) { if (n[r.language] != null) n[r.language] += 1; });
    ["all", "en", "ja"].forEach(function (k) {
      document.getElementById("hN" + k).textContent = " " + n[k];
    });
    var shown = hist.language === "all" ? found
      : found.filter(function (r) { return r.language === hist.language; });
    // 묶음의 날짜는 찾기로 일부 편만 남아도 흔들리지 않게 전체 글에서 정한다.
    shown = sortHistory(shown, hist.sort, hist.dir, seriesInfo(hist.rows));

    var total = hist.rows.length;
    document.getElementById("histCount").textContent =
      shown.length === total ? "모두 " + total + "편" : total + "편 가운데 " + shown.length + "편";

    var body = document.getElementById("historyBody");
    if (!shown.length) {
      body.innerHTML = '<tr class="hist-empty"><td colspan="6">' +
        (total ? "고른 조건에 맞는 글이 없습니다." : "아직 모아둔 글이 없습니다.") + "</td></tr>";
      renderHistoryControls();
      return;
    }
    body.innerHTML = shown.map(function (r) {
      var badge = r.done
        ? '<span class="k-badge ok">완료</span>'
        : '<span class="k-badge mute">미필사</span>';
      var day = String(r.created_at || "").slice(0, 10);
      return '<tr data-id="' + esc(r.id) + '" tabindex="0">' +
        '<td class="c-date" title="' + esc(r.created_at) + '">' + esc(day) + "</td>" +
        '<td class="c-nowrap">' + (r.language === "ja" ? "일본어" : "영어") + "</td>" +
        '<td class="c-title">' + esc(r.title) + "</td>" +
        '<td class="c-nowrap">' + esc(DIFF_NAME[r.difficulty] || r.difficulty || "") + "</td>" +
        '<td class="c-genre" title="' + esc(r.genre) + '">' + esc(r.genre) + "</td>" +
        '<td class="c-nowrap">' + badge + "</td>" +
        "</tr>";
    }).join("");
    renderHistoryControls();
  }

  function loadHistory() {
    api().list_history().then(function (res) {
      hist.rows = res.rows || [];
      // 저장해 둔 보기는 처음 한 번만 따른다 — 그 뒤로는 화면에서 고른 것이 앞선다.
      if (!hist.prefsApplied) {
        var p = res.prefs || {};
        if (p.language === "all" || p.language === "en" || p.language === "ja") hist.language = p.language;
        if (SORTS.indexOf(p.sort) >= 0) hist.sort = p.sort;
        if (p.dir === "asc" || p.dir === "desc") hist.dir = p.dir;
        hist.prefsApplied = true;
      }
      renderHistory();
    }).catch(function (e) { toast("기록을 불러오는 중 오류: " + errText(e)); });
  }

  // 고르기가 바뀌면 새 순서의 맨 위부터 보여 준다(탭을 다시 열 때는 보던 자리를 둔다).
  function historyToTop() { document.querySelector(".hist-wrap").scrollTop = 0; }

  function setHistorySort(key, dir) {
    if (SORTS.indexOf(key) < 0) return;
    hist.sort = key;
    hist.dir = dir || DIR_DEFAULT[key] || "asc";
    renderHistory();
    historyToTop();
    saveHistoryPrefs();
  }

  document.getElementById("hLang").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === hist.language) return;
    hist.language = b.dataset.v;
    renderHistory();
    historyToTop();
    saveHistoryPrefs();
  });
  document.getElementById("hSort").addEventListener("change", function (e) {
    setHistorySort(e.target.value);
  });
  document.getElementById("hDir").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === hist.dir) return;
    setHistorySort(hist.sort, b.dataset.v);
  });
  // 표 머리를 누르면 그 기준으로 줄 세우고, 같은 머리를 다시 누르면 방향을 뒤집는다.
  document.getElementById("histHead").addEventListener("click", function (e) {
    var b = e.target.closest(".th-sort");
    if (!b) return;
    var key = b.parentNode.dataset.sort;
    if (key === hist.sort) setHistorySort(key, hist.dir === "asc" ? "desc" : "asc");
    else setHistorySort(key);
  });
  document.getElementById("hFind").addEventListener("input", function (e) {
    hist.find = e.target.value;
    renderHistory();
    historyToTop();
  });
  // 줄마다 따로 듣지 않고 표 한 곳에서 받는다(다시 그릴 때마다 붙일 필요가 없다).
  var historyBody = document.getElementById("historyBody");
  historyBody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (tr) openSession(tr.dataset.id);
  });
  historyBody.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    e.preventDefault();
    openSession(tr.dataset.id);
  });
  renderHistoryControls();   // 목록이 오기 전에도 방향 단추에 말이 적혀 있게

  function openSession(id) {
    api().get_session(id).then(function (res) {
      if (res && res.error) { toast(res.error); return; }
      state.session = res.session;
      unlockTabs();
      // 필사는 문장마다 따로 기록되므로 지난 입력을 그대로 되살리지 않는다.
      // 대신 처음부터 다시 칠 수 있게 준비해 둔다.
      renderPassage(res.session);
      var p = res.session.practice;
      renderLearn(res.session);
      // 아직 안 쓴 글은 필사부터, 이미 쓴 글은 학습 내용부터 보여준다.
      setTab(p ? "learn" : "write");
    }).catch(function (e) { toast("기록을 여는 중 오류: " + errText(e)); });
  }

  // ---- 설정 ----
  function loadSettings() {
    api().get_status().then(function (s) {
      document.getElementById("modelSelect").value = s.model;
      document.querySelector('input[name="lang"][value="' + s.default_language + '"]').checked = true;
      document.getElementById("difficultySelect").value = s.default_difficulty;
      var badge = document.getElementById("keyStatus");
      badge.textContent = s.has_key ? "키 등록됨" : "키 미등록";
      badge.className = "k-badge " + (s.has_key ? "ok" : "mute");
    }).catch(function (e) { toast("설정을 불러오는 중 오류: " + errText(e)); });
  }

  document.getElementById("saveSettingsBtn").addEventListener("click", function () {
    var lang = document.querySelector('input[name="lang"]:checked').value;
    api().save_settings(
      document.getElementById("apiKeyInput").value,
      document.getElementById("modelSelect").value,
      lang,
      document.getElementById("difficultySelect").value
    ).then(function () {
      document.getElementById("apiKeyInput").value = "";
      toast("설정을 저장했습니다.");
      loadSettings();
    }).catch(function (e) { toast("저장 중 오류: " + errText(e)); });
  });

  document.getElementById("clearKeyBtn").addEventListener("click", function () {
    api().clear_api_key().then(function () { toast("API 키를 삭제했습니다."); loadSettings(); })
      .catch(function (e) { toast("삭제 중 오류: " + errText(e)); });
  });

  // ---- 출처·저작권 고지 ----
  (function () {
    var 단추 = document.getElementById("noticeBtn");
    var 창 = document.getElementById("noticeModal");
    if (!단추 || !창) return;
    단추.addEventListener("click", function () {
      var 본문 = document.getElementById("noticeBody");
      본문.textContent = "불러오는 중…";
      창.classList.remove("hidden");
      api().read_notice().then(function (res) {
        본문.textContent = (res && res.text) || (res && res.error) || "고지를 읽지 못했습니다.";
      }, function (e) { 본문.textContent = errText(e); });
    });
    document.getElementById("noticeClose").addEventListener("click", function () {
      창.classList.add("hidden");
    });
    창.addEventListener("click", function (e) { if (e.target === 창) 창.classList.add("hidden"); });
  })();

  document.addEventListener("pywebviewready", function () {
    loadSettings();
    loadHistory();
  });
})();
