// 단어 암기 — 수준별 단어를 카드로 외우고, 목록에서 뜻·예문·어원·문법·유의사항을 끝까지 읽는다.
// 모든 내용은 이 컴퓨터에 들어 있어 API를 쓰지 않는다.
//
// 다 외우지 못해도 쌓이도록 짠 장치(자세한 설명은 '학습 원리' 창):
//   기억 추정   단어마다 지금 떠올릴 확률을 계산하고(망각 곡선) 그 합을 보여 준다.
//   간격 반복   떠올릴 확률이 90%로 떨어질 즈음 다시 보여 준다.
//   인출 연습   뜻 떠올리기 → 예문 빈칸 → 뜻에서 단어로, 굳을수록 어려운 방향으로.
//   뜻 넓히기   핵심 뜻부터, 굳으면 덜 본 뜻을. 같은 뜻도 매번 다른 예문으로.
//   글에서 다시 따라쓰기에서 만난 단어를 기록하고, 안 배운 단어는 먼저 꺼낸다.
//   내 예문     직접 지은 문장을 남긴다(생성 효과).
(function () {
  "use strict";

  function api() { return window.pywebview.api; }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }
  function errText(e) {
    if (e && e.error) return e.error;
    if (e && e.message) return e.message;
    return String(e);
  }

  var LANG_NAME = { en: "영어", ja: "일본어" };
  var GRADES = ["again", "hard", "good"];

  var st = {
    language: "en", level: "easy", explain: "both", view: "cards", ruby: true,
    counts: {}, levelNote: {}, today: 0, streak: 0,
    rows: [], selected: null, find: "",
    words: {},          // id -> 단어(화면용)
    deck: null,         // 지금 도는 카드 묶음
    ready: false, shown: false
  };

  function savePrefs() {
    api().save_vocab_prefs({
      language: st.language, level: st.level, explain: st.explain, view: st.view, ruby: st.ruby
    }).catch(function () {});
  }

  // 같은 단어를 여러 곳에서 동시에 달라고 해도 한 번만 부른다.
  var pending = {};
  function getWord(id, fresh) {
    if (!fresh && st.words[id]) return Promise.resolve(st.words[id]);
    if (pending[id]) return pending[id];
    pending[id] = api().vocab_word(id).then(function (res) {
      delete pending[id];
      if (!res || res.error) throw res || { error: "단어를 불러오지 못했습니다." };
      st.words[id] = res.word;
      return res.word;
    }, function (e) { delete pending[id]; throw e; });
    return pending[id];
  }

  // ── 글자 그리기 ─────────────────────────────────────────────
  function tokensFor(word, path) {
    return (st.ruby && word && word._ruby && word._ruby[path]) || null;
  }
  function rubyOne(t) { return "<ruby>" + esc(t.t) + "<rt>" + esc(t.r) + "</rt></ruby>"; }
  function R(word, path, text) {
    var toks = tokensFor(word, path);
    return toks ? toks.map(function (t) { return t.r ? rubyOne(t) : esc(t.t); }).join("") : esc(text);
  }

  // 예문 그리기. target 구간을 mark(굵게) 또는 blank(빈칸)로 바꿔 그린다.
  function exRender(word, path, text, target, mode) {
    var toks = tokensFor(word, path) || [{ t: text }];
    var s = target ? text.indexOf(target) : -1;
    var e = s < 0 ? -1 : s + target.length;
    var out = "", pos = 0, blanked = false;
    function blank() {
      if (blanked) return "";
      blanked = true;
      var w = Math.max(2.2, target.length * (word.language === "ja" ? 1.05 : 0.6));
      return '<span class="blank" style="width:' + w.toFixed(1) + 'em" aria-label="빈칸"></span>';
    }
    toks.forEach(function (t) {
      var a = pos, b = pos + t.t.length;
      pos = b;
      var hit = s >= 0 && a < e && b > s;
      if (!hit) { out += t.r ? rubyOne(t) : esc(t.t); return; }
      var x = Math.max(s, a) - a, y = Math.min(e, b) - a;
      if (mode === "blank") {
        out += esc(t.t.slice(0, x)) + blank() + esc(t.t.slice(y));
        return;
      }
      if (t.r) { out += '<b class="tg">' + rubyOne(t) + "</b>"; return; }
      out += esc(t.t.slice(0, x)) + '<b class="tg">' + esc(t.t.slice(x, y)) + "</b>" + esc(t.t.slice(y));
    });
    return out;
  }

  // 두 말 해설 한 쌍. 해설 언어 설정에 따라 한국어만 / 원어만 / 함께 보인다.
  function bi(word, obj, path) {
    if (!obj) return "";
    var m = st.explain, h = "";
    if (m !== "native" && obj.ko) h += '<div class="b-ko">' + esc(obj.ko) + "</div>";
    if (m !== "ko" && obj.native) {
      h += '<div class="b-nt" lang="' + esc(word.language) + '">' + R(word, path + ".native", obj.native) + "</div>";
    }
    return '<div class="bi m-' + m + '">' + h + "</div>";
  }
  function posText(obj) {
    if (!obj) return "";
    if (st.explain === "ko") return obj.ko || obj.native || "";
    if (st.explain === "native") return obj.native || obj.ko || "";
    return obj.ko && obj.native ? obj.ko + " · " + obj.native : (obj.ko || obj.native || "");
  }
  function subLine(w) { return w.language === "ja" ? (w.reading || "") : (w.pronunciation || ""); }
  function pct(r) { return Math.round((r || 0) * 100) + "%"; }
  function statusBadge(s) {
    if (!s) return "";
    var cls = s.state === "new" ? "mute" : s.due ? "wait" : s.state === "learned" ? "ok" : "info";
    var extra = s.state === "new" ? "" : " " + pct(s.r);
    return '<span class="k-badge ' + cls + '" title="' + (s.state === "new" ? "아직 카드로 외우지 않은 단어" :
      "지금 떠올릴 확률") + '">' + esc(s.label) + extra + "</span>";
  }
  function showTranslation() { return st.explain !== "native"; }
  function days(n) {
    if (n < 1) return Math.max(1, Math.round(n * 24)) + "시간";
    if (n < 45) return Math.round(n) + "일";
    if (n < 400) return Math.round(n / 30) + "달";
    return (n / 365).toFixed(1) + "년";
  }

  function exItem(word, path, ex, mode) {
    return "<li>" +
      '<div class="ex-t" lang="' + esc(word.language) + '">' + exRender(word, path, ex.text, ex.target, mode || "mark") + "</div>" +
      (showTranslation() && ex.ko ? '<div class="ex-k">' + esc(ex.ko) + "</div>" : "") + "</li>";
  }
  function examplesHTML(word, sense, path, only) {
    var exs = sense.examples || [];
    var idx = only == null ? exs.map(function (_, j) { return j; }) : [only % Math.max(1, exs.length)];
    return '<ul class="vd-ex">' + idx.map(function (j) {
      return exItem(word, path + ".examples." + j + ".text", exs[j] || {});
    }).join("") + "</ul>";
  }
  function chipsHTML(word, list, path) {
    return '<div class="vd-cols">' + (list || []).map(function (c, j) {
      return '<span class="chip col" lang="' + esc(word.language) + '">' + R(word, path + "." + j, c) + "</span>";
    }).join("") + "</div>";
  }
  function pointsHTML(word, list, path) {
    return '<ul class="vd-points">' + (list || []).map(function (x, i) {
      return "<li>" + bi(word, x, path + "." + i) + "</li>";
    }).join("") + "</ul>";
  }
  function heading(title, cnt) {
    return '<h4 class="vd-h">' + esc(title) + (cnt ? '<span class="cnt">' + esc(cnt) + "</span>" : "") + "</h4>";
  }

  // 나의 기억 — 지금 떠올릴 확률, 다음 복습, 뜻별로 본 횟수, 글에서 만난 곳, 내 예문
  function memoryHTML(w) {
    var s = w.status || {}, m = w.memory || {};
    var h = heading("나의 기억");
    if (s.state === "new") {
      h += '<div class="vd-mem"><p class="mem-note">아직 카드로 외우지 않은 단어입니다.' +
        (s.enc ? " 따라쓰기에서 " + s.enc + "번 만났습니다. 다음 카드에서 먼저 나옵니다." : "") + "</p></div>";
    } else {
      var seen = m.senses || {};
      h += '<div class="vd-mem">' +
        '<div class="mem-bar"><div class="track"><div class="bar' + (s.r >= 0.9 ? " full" : "") +
        '" style="width:' + pct(s.r) + '"></div></div><span>지금 떠올릴 확률 <b>' + pct(s.r) + "</b></span></div>" +
        '<div class="mem-facts">' +
        "<span>본 횟수 <b>" + (s.reps || 0) + "</b></span>" +
        "<span>잊은 횟수 <b>" + (s.lapses || 0) + "</b></span>" +
        "<span>기억 유지 약 <b>" + days(s.s || 0) + "</b></span>" +
        (m.next ? "<span>다음 복습 <b>" + esc(m.next) + "</b></span>" : "") +
        (s.enc ? "<span>글에서 만남 <b>" + s.enc + "번</b></span>" : "") +
        "</div>" +
        '<div class="mem-senses">' + (w.senses || []).map(function (_, i) {
          var n = seen[String(i)] || 0;
          return '<span class="chip' + (n ? " on" : "") + '">뜻 ' + (i + 1) + (n ? " · " + n + "번" : " · 아직") + "</span>";
        }).join("") + "</div></div>";
    }
    var enc = m.encounters || [];
    if (enc.length) {
      h += heading("따라쓰기에서 만난 문장", enc.length + "곳") + '<ul class="vd-ex">' + enc.map(function (x) {
        var t = x.text || "", f = x.form || "";
        var i = f ? t.indexOf(f) : -1;
        var body = i < 0 ? esc(t) : esc(t.slice(0, i)) + '<b class="tg">' + esc(f) + "</b>" + esc(t.slice(i + f.length));
        return '<li><div class="ex-t" lang="' + esc(w.language) + '">' + body + '</div><div class="ex-k">' + esc(x.title || "") + "</div></li>";
      }).join("") + "</ul>";
    }
    h += heading("내 예문") +
      '<div class="vd-mine"><textarea class="k-in" rows="2" data-mine="' + esc(w.id) + '" lang="' + esc(w.language) +
      '" placeholder="이 단어로 직접 문장을 지어 보세요. 스스로 만든 문장이 가장 오래 남습니다.">' + esc(m.mine || "") + "</textarea>" +
      '<button type="button" class="k-btn ghost sm" data-mine-save="' + esc(w.id) + '">저장</button></div>';
    return h;
  }

  // 활용표 — 꼴이 바뀌는 단어(일본어 동사·형용사, 영어 불규칙 변화)에만 있다.
  function conjugationHTML(w) {
    var c = w.conjugation;
    if (!c || !(c.rows || []).length) return "";
    var rows = c.rows.map(function (r, i) {
      return "<tr><th>" + esc(r.label) + "</th><td lang=\"" + esc(w.language) + "\">" +
        R(w, "conjugation.rows." + i + ".form", r.form) + "</td><td class=\"vd-conj-note\">" +
        (r.note ? esc(r.note) : "") + "</td></tr>";
    }).join("");
    return heading("활용", c.kind || "") + '<div class="vd-conj"><table><tbody>' + rows + "</tbody></table></div>";
  }

  // 문형 — 이 단어가 들어가는 문장 틀.
  function patternsHTML(w) {
    var ps = w.patterns || [];
    if (!ps.length) return "";
    return heading("문형", ps.length + "가지") + '<div class="vd-pattern">' + ps.map(function (p, i) {
      var base = "patterns." + i;
      return '<div class="vd-pat">' +
        '<div class="vd-pat-form" lang="' + esc(w.language) + '">' + R(w, base + ".pattern", p.pattern) + "</div>" +
        '<div class="vd-pat-note">' + bi(w, p.note, base + ".note") + "</div>" +
        '<div class="vd-pat-ex" lang="' + esc(w.language) + '">' + R(w, base + ".example", p.example) + "</div>" +
        '<div class="vd-pat-ko">' + esc(p.example_ko || "") + "</div>" +
        "</div>";
    }).join("") + "</div>";
  }

  // 헷갈리는 말 — 이웃 단어와 무엇이 다른지.
  function confusablesHTML(w) {
    var cs = w.confusables || [];
    if (!cs.length) return "";
    return heading("헷갈리는 말", cs.length + "개") + '<div class="vd-conf">' + cs.map(function (c, i) {
      var base = "confusables." + i;
      return '<div class="vd-conf-row">' +
        '<div class="vd-conf-w" lang="' + esc(w.language) + '">' + R(w, base + ".word", c.word) + "</div>" +
        '<div class="vd-conf-d">' + bi(w, c.difference, base + ".difference") +
        (c.example ? '<div class="vd-conf-ex" lang="' + esc(w.language) + '">' + R(w, base + ".example", c.example) + "</div>" : "") +
        "</div></div>";
    }).join("") + "</div>";
  }

  // 단어 하나를 끝까지 풀어 보인다(목록 오른쪽 칸, 카드의 '자세히' 창 모두 이것을 쓴다).
  function detailHTML(w) {
    var h = "";
    var sub = subLine(w);
    h += '<div class="vd-head"><div class="vd-title">' +
      '<div class="vd-hw" lang="' + esc(w.language) + '">' + esc(w.headword) + "</div>" +
      (sub ? '<div class="vd-sub">' + esc(sub) + "</div>" : "") +
      "</div>" + statusBadge(w.status) + "</div>";
    h += '<div class="vd-pos"><span class="chip">' + esc(posText(w.pos)) + "</span></div>";
    h += '<div class="vd-summary">' + bi(w, w.summary, "summary") + "</div>";

    var senses = w.senses || [];
    h += heading("뜻과 예문", senses.length + "가지 뜻");
    senses.forEach(function (s, i) {
      var p = "senses." + i;
      h += '<div class="vd-sense">' +
        '<div class="vd-sense-head"><span class="vd-num">뜻 ' + (i + 1) + "</span>" +
        '<span class="chip">' + esc(posText(s.pos)) + "</span></div>" +
        '<div class="vd-meaning">' + bi(w, s.meaning, p + ".meaning") + "</div>" +
        '<div class="vd-usage">' + bi(w, s.usage, p + ".usage") + "</div>" +
        '<span class="vd-lab">자주 함께 쓰는 말</span>' + chipsHTML(w, s.collocations, p + ".collocations") +
        '<span class="vd-lab">예문</span>' + examplesHTML(w, s, p) +
        "</div>";
    });

    h += heading("문법적 성격") + pointsHTML(w, w.grammar, "grammar");
    h += conjugationHTML(w) + patternsHTML(w);
    h += heading("어원") + '<div class="vd-ety">' + bi(w, w.etymology, "etymology") + "</div>";
    h += heading("유의사항") + pointsHTML(w, w.cautions, "cautions");
    h += confusablesHTML(w);

    var rel = w.related || {};
    var relRows = [["비슷한 말", "synonyms"], ["반대말", "antonyms"], ["파생어·관련어", "derived"]]
      .filter(function (r) { return (rel[r[1]] || []).length; });
    if (relRows.length) {
      h += heading("관련어") + '<div class="vd-rel">' + relRows.map(function (r) {
        return '<span class="lab">' + r[0] + "</span>" + chipsHTML(w, rel[r[1]], "related." + r[1]);
      }).join("") + "</div>";
    }
    h += memoryHTML(w);
    return h;
  }

  // 내 예문 저장(목록 칸과 자세히 창 어디서든)
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-mine-save]");
    if (!b) return;
    var id = b.getAttribute("data-mine-save");
    var ta = b.parentNode.querySelector("textarea[data-mine]");
    api().vocab_save_mine(id, ta.value).then(function (res) {
      if (res && res.error) { toast(res.error); return; }
      if (st.words[id]) st.words[id].memory.mine = res.mine;
      toast(res.mine ? "내 예문을 저장했습니다." : "내 예문을 지웠습니다.");
    }).catch(function (err) { toast("저장 중 오류: " + errText(err)); });
  });

  // ── 위쪽 고르기 줄과 요약 ─────────────────────────────────
  function setPressed(groupId, value) {
    $(groupId).querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === value));
    });
  }
  function renderControls() {
    setPressed("vLang", st.language);
    setPressed("vLevel", st.level);
    setPressed("vExplain", st.explain);
    setPressed("vView", st.view);
    $("vExplainNative").textContent = LANG_NAME[st.language];
    $("vRubyWrap").classList.toggle("hidden", st.language !== "ja");
    $("vRubyChk").checked = st.ruby;
    $("vLevelNote").textContent = (st.levelNote[st.language] || {})[st.level] || "";
    $("vCards").classList.toggle("hidden", st.view !== "cards");
    $("vBrowse").classList.toggle("hidden", st.view !== "list");
  }
  function renderStats() {
    var c = st.counts[st.language + "-" + st.level] ||
      { total: 0, learned: 0, due: 0, new: 0, studied: 0, expected: 0 };
    $("vExpected").textContent = (c.expected || 0).toFixed(1);
    $("vLearned").textContent = c.learned;
    $("vDue").textContent = c.due;
    $("vNew").textContent = c.new;
    $("vBarText").textContent = c.learned + " / " + c.total + " 익힘";
    var bar = $("vBar");
    bar.style.width = (c.total ? Math.round(c.learned * 100 / c.total) : 0) + "%";
    bar.classList.toggle("full", c.total > 0 && c.learned === c.total);
    $("vDay").textContent = "오늘 " + st.today + "번 답함" + (st.streak ? " · " + st.streak + "일째 이어서" : "");
  }
  function applyOverview(o) {
    st.counts = o.counts || {};
    st.levelNote = o.level_note || {};
    st.today = o.today || 0;
    st.streak = o.streak || 0;
  }
  function refreshCounts() {
    return api().vocab_overview().then(function (o) { applyOverview(o); renderStats(); });
  }

  // ── 목록 + 상세 ─────────────────────────────────────────────
  function summaryFor(row) {
    var s = row.summary || {};
    return st.explain === "native" ? (s.native || s.ko || "") : (s.ko || s.native || "");
  }
  function loadList() {
    var lang = st.language, lv = st.level;
    return api().vocab_list(lang, lv).then(function (res) {
      if (lang !== st.language || lv !== st.level) return;
      st.rows = res.rows || [];
      if (!st.rows.some(function (r) { return r.id === st.selected; })) {
        st.selected = st.rows.length ? st.rows[0].id : null;
      }
      renderList();
      renderDetail();
    }).catch(function (e) { toast("단어 목록을 불러오는 중 오류: " + errText(e)); });
  }
  function matchesFind(r) {
    var q = st.find.trim().toLowerCase();
    if (!q) return true;
    var s = r.summary || {};
    return [r.headword, r.reading, s.ko, s.native].some(function (x) {
      return String(x || "").toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderList() {
    var box = $("vList");
    var rows = st.rows.filter(matchesFind);
    if (!st.rows.length) { box.innerHTML = '<div class="vlist-empty">이 수준에는 아직 단어가 없습니다.</div>'; return; }
    if (!rows.length) { box.innerHTML = '<div class="vlist-empty">찾는 단어가 없습니다.</div>'; return; }
    box.innerHTML = rows.map(function (r) {
      var rd = st.language === "ja" ? r.reading : "";
      return '<button type="button" class="vrow" role="option" data-id="' + esc(r.id) + '" aria-selected="' +
        String(r.id === st.selected) + '">' +
        '<span class="vrow-hw" lang="' + esc(st.language) + '">' + esc(r.headword) +
        (rd ? '<span class="vrow-rd">' + esc(rd) + "</span>" : "") + "</span>" +
        statusBadge(r.status) +
        '<span class="vrow-sum">' + esc(summaryFor(r)) + "</span>" +
        "</button>";
    }).join("");
  }
  function renderDetail(fresh) {
    var box = $("vDetail");
    if (!st.selected) {
      box.innerHTML = '<div class="vdetail-empty">왼쪽에서 단어를 고르면 뜻·예문·어원·문법·유의사항을 여기서 볼 수 있습니다.</div>';
      return;
    }
    var id = st.selected;
    getWord(id, fresh).then(function (w) {
      if (id !== st.selected) return;
      box.innerHTML = detailHTML(w);
      if (!fresh) box.scrollTop = 0;
    }).catch(function (e) { box.innerHTML = '<div class="vdetail-empty">' + esc(errText(e)) + "</div>"; });
  }
  function selectRow(id, fresh) {
    st.selected = id;
    $("vList").querySelectorAll(".vrow").forEach(function (x) {
      x.setAttribute("aria-selected", String(x.dataset.id === st.selected));
    });
    renderDetail(fresh);
  }
  $("vList").addEventListener("click", function (e) {
    var b = e.target.closest(".vrow");
    if (b) selectRow(b.dataset.id, true);
  });
  $("vList").addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var rows = Array.prototype.slice.call($("vList").querySelectorAll(".vrow"));
    var i = rows.findIndex(function (x) { return x.dataset.id === st.selected; });
    var n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) { e.preventDefault(); n.focus(); n.click(); }
  });
  $("vFind").addEventListener("input", function () { st.find = this.value; renderList(); });

  // ── 카드 ────────────────────────────────────────────────────
  var KIND_HINT = {
    meaning: "뜻을 먼저 떠올려 본 뒤 뒤집어 보세요.",
    cloze: "빈칸에 들어갈 말을 떠올려 보세요. 활용형까지 맞히면 더 좋습니다.",
    produce: "이 뜻을 나타내는 단어를 떠올려 보세요."
  };
  var KIND_NAME = { meaning: "뜻 떠올리기", cloze: "예문 빈칸", produce: "뜻에서 단어로" };

  function startDeck(everything) {
    var lang = st.language, lv = st.level;
    st.deck = null;
    return api().vocab_study(lang, lv, 20, !!everything).then(function (res) {
      if (lang !== st.language || lv !== st.level) return;
      st.deck = {
        lang: lang, level: lv, cards: res.cards || [], i: 0, flipped: false, busy: false,
        done: false, again: {}, tally: { again: 0, hard: 0, good: 0 }, everything: !!everything
      };
      if (!st.deck.cards.length) { st.deck.done = true; renderDeckEmpty(); return; }
      showCard();
    }).catch(function (e) { toast("카드를 준비하는 중 오류: " + errText(e)); });
  }
  function cardShell(show) {
    $("vCard").classList.toggle("hidden", !show);
    $("vCardActions").classList.toggle("hidden", !show);
    $("vCardNote").classList.toggle("hidden", show);
    document.querySelector("#vCards .vcard-top").classList.toggle("hidden", !show);
  }
  function current() { var d = st.deck; return d && d.cards[d.i]; }
  function renderDeckProgress() {
    var d = st.deck, c = current();
    $("vCardCount").textContent = "카드 " + Math.min(d.i + 1, d.cards.length) + " / " + d.cards.length +
      (c ? " · " + KIND_NAME[c.kind] : "");
    $("vCardBar").style.width = Math.round(d.i * 100 / d.cards.length) + "%";
  }
  function showCard() {
    var d = st.deck;
    if (!d) return;
    if (d.i >= d.cards.length) { finishDeck(); return; }
    cardShell(true);
    d.flipped = false;
    renderDeckProgress();
    var c = current();
    getWord(c.id).then(function (w) {
      if (st.deck !== d || current() !== c) return;
      renderFront(w, c);
      var nx = d.cards[d.i + 1];
      if (nx) getWord(nx.id).catch(function () {});
    }).catch(function (e) { toast(errText(e)); });
  }
  function senseOf(w, c) { return (w.senses || [])[c.sense] || (w.senses || [])[0] || {}; }
  function exampleOf(w, c) {
    var exs = senseOf(w, c).examples || [];
    return { ex: exs[c.example % Math.max(1, exs.length)] || {}, j: c.example % Math.max(1, exs.length) };
  }
  function renderFront(w, c) {
    var sub = subLine(w), h = "";
    if (c.kind === "cloze") {
      var e = exampleOf(w, c), p = "senses." + c.sense + ".examples." + e.j + ".text";
      h = '<div class="vc-kind">' + KIND_NAME.cloze + "</div>" +
        '<div class="vc-cloze ex-t" lang="' + esc(w.language) + '">' + exRender(w, p, e.ex.text || "", e.ex.target || "", "blank") + "</div>" +
        (showTranslation() && e.ex.ko ? '<div class="vc-cloze-ko">' + esc(e.ex.ko) + "</div>" : "");
    } else if (c.kind === "produce") {
      var s = senseOf(w, c);
      h = '<div class="vc-kind">' + KIND_NAME.produce + "</div>" +
        '<div class="vd-pos"><span class="chip">' + esc(posText(s.pos)) + "</span></div>" +
        '<div class="vc-meaning">' + bi(w, s.meaning, "senses." + c.sense + ".meaning") + "</div>";
    } else {
      h = '<div class="vc-kind">' + KIND_NAME.meaning + "</div>" +
        '<div class="vc-hw" lang="' + esc(w.language) + '">' + esc(w.headword) + "</div>" +
        (sub ? '<div class="vc-sub">' + esc(sub) + "</div>" : "") +
        '<div class="vd-pos"><span class="chip">' + esc(posText(w.pos)) + "</span></div>";
    }
    $("vCardFront").innerHTML = h + '<div class="vc-hint">' + KIND_HINT[c.kind] + "</div>";
    $("vCardFront").classList.remove("hidden");
    $("vCardBack").classList.add("hidden");
    $("vFlip").classList.remove("hidden");
    $("vGrade").classList.add("hidden");
    $("vCard").scrollTop = 0;
  }
  // 뒷면: 이번에 물은 뜻을 맨 위에, 나머지 뜻은 짧게. 매번 다른 '기억 고리'를 하나 곁들인다.
  function hookHTML(w, c) {
    var reps = (w.status && w.status.reps) || 0;
    var s = senseOf(w, c);
    var pick = [
      function () { return w.etymology ? ["어원", bi(w, w.etymology, "etymology")] : null; },
      function () { return (s.collocations || []).length ? ["자주 함께 쓰는 말", chipsHTML(w, s.collocations, "senses." + c.sense + ".collocations")] : null; },
      function () { return (w.cautions || []).length ? ["유의사항", bi(w, w.cautions[reps % w.cautions.length], "cautions." + (reps % w.cautions.length))] : null; }
    ];
    for (var k = 0; k < 3; k++) {
      var got = pick[(reps + k) % 3]();
      if (got) return '<div class="vcb-hook"><span class="vd-lab">기억 고리 · ' + got[0] + "</span>" + got[1] + "</div>";
    }
    return "";
  }
  function renderBack(w, c) {
    var sub = subLine(w);
    var h = '<div class="vcb-head"><span class="vc-hw" lang="' + esc(w.language) + '">' + esc(w.headword) + "</span>" +
      (sub ? '<span class="vc-sub">' + esc(sub) + "</span>" : "") +
      '<span class="chip">' + esc(posText(w.pos)) + "</span>" + statusBadge(w.status) + "</div>";
    var s = senseOf(w, c), e = exampleOf(w, c), p = "senses." + c.sense;
    h += '<div class="vcb-now"><span class="vd-num">이번 뜻 · 뜻 ' + (c.sense + 1) + "</span>" +
      '<div class="vd-meaning">' + bi(w, s.meaning, p + ".meaning") + "</div>" +
      '<ul class="vd-ex">' + exItem(w, p + ".examples." + e.j + ".text", e.ex) + "</ul></div>";
    h += hookHTML(w, c);
    var others = (w.senses || []).map(function (x, i) { return i; }).filter(function (i) { return i !== c.sense; });
    if (others.length) {
      h += '<span class="vd-lab">다른 뜻</span>';
      others.forEach(function (i) {
        var q = "senses." + i;
        h += '<div class="vcb-sense"><span class="vd-num">뜻 ' + (i + 1) + "</span><div>" +
          '<div class="vd-meaning">' + bi(w, w.senses[i].meaning, q + ".meaning") + "</div></div></div>";
      });
    }
    $("vCardBack").innerHTML = h;
    $("vCardFront").classList.add("hidden");
    $("vCardBack").classList.remove("hidden");
    $("vFlip").classList.add("hidden");
    $("vGrade").classList.remove("hidden");
    $("vCard").scrollTop = 0;
  }
  function flip() {
    var d = st.deck;
    if (!d || d.done || d.flipped) return;
    var c = current();
    getWord(c.id).then(function (w) { d.flipped = true; renderBack(w, c); });
  }
  function grade(g) {
    var d = st.deck;
    if (!d || d.done || !d.flipped || d.busy) return;
    var c = current();
    d.busy = true;
    api().vocab_grade(c.id, g, c.sense).then(function (res) {
      d.busy = false;
      if (res && res.error) { toast(res.error); return; }
      d.tally[g] += 1;
      var w = st.words[c.id];
      if (w) {
        w.status = res.status;
        var ss = w.memory.senses || (w.memory.senses = {});
        ss[String(c.sense)] = (ss[String(c.sense)] || 0) + 1;
      }
      // 간격 반복이 눈에 보이도록 다음에 언제 다시 나오는지 알려 준다
      if (g === "again") toast("이번 묶음 끝에 한 번 더 나옵니다. 잊어도 쌓은 것은 남습니다.");
      else toast("다음 복습은 약 " + days(res.status.s) + " 뒤입니다.");
      if (g === "again" && !d.again[c.id]) {
        d.again[c.id] = 1;
        // 다시 볼 때는 쉬운 방향(뜻 떠올리기)으로, 다른 예문으로
        d.cards.push({ id: c.id, kind: "meaning", sense: c.sense, example: c.example + 1 });
      }
      d.i += 1;
      refreshCounts();
      showCard();
    }).catch(function (e) { d.busy = false; toast("저장 중 오류: " + errText(e)); });
  }
  function note(html) { cardShell(false); $("vCardNote").innerHTML = html; }
  function renderDeckEmpty() {
    var c = st.counts[st.language + "-" + st.level] || {};
    if (!c.total) { note("<h4>이 수준에는 아직 단어가 없습니다</h4><p>다른 수준을 골라 보세요.</p>"); return; }
    note("<h4>지금 외울 카드를 모두 마쳤습니다</h4>" +
      "<p>복습할 때가 된 단어도, 새 단어도 없습니다. 외운 단어는 떠올릴 확률이 90% 아래로 떨어질 즈음 다시 나옵니다. " +
      "더 연습하고 싶으면 때가 안 된 단어까지 한 바퀴 돌 수 있습니다.</p>" +
      '<div class="k-bar"><button type="button" class="k-btn" data-act="all">모든 단어로 한 바퀴 더</button>' +
      '<button type="button" class="k-btn ghost" data-act="list">단어 목록 보기</button></div>');
  }
  function finishDeck() {
    var d = st.deck;
    d.done = true;
    $("vCardBar").style.width = "100%";
    var t = d.tally;
    refreshCounts().then(function () {
      var c = st.counts[st.language + "-" + st.level] || {};
      var 남은 = (c.due || 0) + (c.new || 0);
      note("<h4>이번 카드를 모두 넘겼습니다</h4>" +
        '<div class="tally">' +
        '<div class="vstat"><b>' + t.good + "</b><span>알아요</span></div>" +
        '<div class="vstat"><b>' + t.hard + "</b><span>헷갈려요</span></div>" +
        '<div class="vstat"><b>' + t.again + "</b><span>몰라요</span></div></div>" +
        "<p>지금 기억하고 있을 단어는 <b>" + (c.expected || 0).toFixed(1) + "개</b>(추정)입니다. " +
        "몰랐던 단어도 이번에 본 만큼 다음에 덜 들여 되찾습니다." +
        (남은 ? " 아직 볼 카드가 " + 남은 + "장 남았습니다." : "") + "</p>" +
        '<div class="k-bar">' +
        (남은 ? '<button type="button" class="k-btn" data-act="next">이어서 외우기</button>' : "") +
        '<button type="button" class="k-btn' + (남은 ? " ghost" : "") + '" data-act="all">모든 단어로 한 바퀴 더</button>' +
        '<button type="button" class="k-btn ghost" data-act="list">단어 목록 보기</button></div>');
    });
  }
  $("vCardNote").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    if (b.dataset.act === "next") startDeck(false);
    else if (b.dataset.act === "all") startDeck(true);
    else if (b.dataset.act === "list") setView("list");
  });
  $("vFlip").addEventListener("click", flip);
  $("vGrade").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-g]");
    if (b) grade(b.dataset.g);
  });
  $("vCard").addEventListener("click", function (e) {
    if (st.deck && !st.deck.flipped && !e.target.closest("button")) flip();
  });

  // ── 창(자세히·학습 원리) ─────────────────────────────────────
  var lastFocus = null;
  function openModal(title, html) {
    $("vModalTitle").textContent = title;
    $("vModalBody").innerHTML = html;
    lastFocus = document.activeElement;
    $("vModal").classList.remove("hidden");
    $("vModal").querySelector(".k-modal-body").scrollTop = 0;
    $("vModalClose").focus();
  }
  function closeModal() {
    $("vModal").classList.add("hidden");
    $("vModal").dataset.word = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("vMore").addEventListener("click", function () {
    var c = current();
    if (!c) return;
    getWord(c.id).then(function (w) {
      openModal(w.headword + " 자세히 보기", detailHTML(w));
      $("vModal").dataset.word = c.id;
    });
  });
  $("vModalClose").addEventListener("click", closeModal);
  $("vModal").addEventListener("click", function (e) { if (e.target === $("vModal")) closeModal(); });

  var HOW = [
    ["다 외우지 않아도 쌓입니다",
      "단어마다 지금 떠올릴 수 있을 확률을 계산합니다. 확률은 시간이 지나면 망각 곡선을 따라 서서히 떨어지고, " +
      "복습할 때마다 떨어지는 속도가 느려집니다. 위쪽의 '지금 기억하고 있을 단어(추정)'는 이 확률을 모두 더한 값이라, " +
      "반쯤 아는 단어도 반만큼 셉니다. 일부를 잊고 일부를 기억하는 것 자체가 정상적인 과정이며, 그 합이 조금씩 커지는 것이 실력입니다."],
    ["잊을 즈음 다시 봅니다",
      "떠올릴 확률이 90%로 떨어질 무렵 카드를 다시 보여 줍니다(간격 반복). 조금 잊은 뒤에 애써 떠올리면, " +
      "쉽게 떠올렸을 때보다 기억이 훨씬 오래 갑니다(바람직한 어려움). 그래서 간격은 2일, 8일, 3주, 두 달로 점점 벌어집니다."],
    ["잊어도 처음부터가 아닙니다",
      "한 번 익힌 단어는 잊어도 다시 익히는 데 처음보다 덜 듭니다(절약 효과). '몰라요'를 눌러도 쌓은 기억이 사라지지 않고, " +
      "다시 볼 간격만 짧아집니다."],
    ["보기보다 떠올리기",
      "눈으로 읽는 것보다 스스로 떠올리는 것이 오래 남습니다(인출 연습). 막 배운 단어는 뜻을 떠올리고, " +
      "굳어 갈수록 예문의 빈칸 채우기, 뜻에서 단어 떠올리기처럼 더 어려운 방향으로 넘어갑니다. " +
      "알아보는 어휘가 쓸 수 있는 어휘로 옮겨 가는 순서입니다."],
    ["뜻을 하나씩 넓힙니다",
      "뜻이 여럿인 단어는 핵심 뜻부터 다지고, 굳으면 덜 본 뜻을 골라 보여 줍니다. 같은 뜻도 매번 다른 예문으로 보여 줍니다. " +
      "여러 맥락에서 만난 단어일수록 실제 글에서 알아보고 쓸 수 있습니다."],
    ["글에서 다시 만납니다",
      "따라쓰기를 마치면 그 글에 나온 단어장 단어를 찾아 기록합니다. 이미 배운 단어는 글에서 만난 것만으로 가벼운 복습이 되고, " +
      "아직 안 배운 단어는 다음 카드에서 먼저 나옵니다. 한 단어를 제대로 알려면 여러 맥락에서 열 번 안팎 만나야 합니다."],
    ["조금씩, 자주",
      "한 번에 새 단어는 10개까지만 더합니다. 한꺼번에 많이 넣으면 대부분 새어 나갑니다. 매일 짧게 하는 편이 " +
      "한 번에 몰아서 하는 것보다 오래 남습니다(분산 학습). 위쪽에 오늘 답한 수와 이어 온 날 수가 보입니다."],
    ["내 문장으로",
      "단어 목록의 '내 예문'에 그 단어로 직접 문장을 지어 남길 수 있습니다. 스스로 만든 문장은 주어진 문장보다 깊이 새겨집니다(생성 효과)."]
  ];
  var HOW_REF = "근거: Ebbinghaus(1885) 망각 곡선과 절약 효과 · Cepeda 외(2006) 분산 학습 · Bjork(1994) 바람직한 어려움 · " +
    "Roediger·Karpicke(2006) 인출 연습 · Laufer·Goldstein(2004) 수용·산출 어휘 · Webb(2007) 맥락 속 반복 노출 · " +
    "Nation(2007) 네 갈래 학습 · Slamecka·Graf(1978) 생성 효과. 기억 계산은 FSRS-4.5(자유 간격 반복 스케줄러)의 기본값을 씁니다.";
  $("vHow").addEventListener("click", function () {
    openModal("이렇게 외웁니다", '<div class="vhow">' + HOW.map(function (x) {
      return '<section><h4 class="vd-h">' + esc(x[0]) + "</h4><p>" + esc(x[1]) + "</p></section>";
    }).join("") + '<p class="vhow-ref">' + esc(HOW_REF) + "</p></div>");
  });

  // ── 전환 ────────────────────────────────────────────────────
  function rerenderText() {
    renderControls();
    renderList();
    if (st.view === "list") renderDetail();
    var d = st.deck, c = current();
    if (d && !d.done && c) {
      getWord(c.id).then(function (w) { d.flipped ? renderBack(w, c) : renderFront(w, c); });
    }
    var mw = $("vModal").dataset.word;
    if (!$("vModal").classList.contains("hidden") && mw) {
      getWord(mw).then(function (w) { $("vModalBody").innerHTML = detailHTML(w); });
    }
  }
  function setView(v) {
    st.view = v;
    renderControls();
    savePrefs();
    if (v === "list") { loadList(); return; }
    var d = st.deck;
    if (!d || d.done || d.lang !== st.language || d.level !== st.level) startDeck(false);
  }
  function selectionChanged() {
    st.selected = null; st.find = ""; $("vFind").value = "";
    renderControls();
    renderStats();
    refreshCounts();      // 다른 언어·수준의 수치는 그사이 달라졌을 수 있다
    savePrefs();
    loadList();
    if (st.view === "cards") startDeck(false);
    else st.deck = null;
  }
  $("vLang").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === st.language) return;
    st.language = b.dataset.v;
    selectionChanged();
  });
  $("vLevel").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === st.level) return;
    st.level = b.dataset.v;
    selectionChanged();
  });
  $("vExplain").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === st.explain) return;
    st.explain = b.dataset.v;
    savePrefs();
    rerenderText();
  });
  $("vView").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === st.view) return;
    setView(b.dataset.v);
  });
  $("vRubyChk").addEventListener("change", function () {
    st.ruby = this.checked;
    savePrefs();
    rerenderText();
  });

  // 키보드: Space·Enter 뒤집기, 1·2·3 답하기, Esc 창 닫기
  document.addEventListener("keydown", function (e) {
    if ($("tab-vocab").classList.contains("hidden")) return;
    if (!$("vModal").classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); closeModal(); }
      return;
    }
    if (st.view !== "cards" || !st.deck || st.deck.done) return;
    var tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === " " || e.key === "Enter") {
      if (tag === "button") return;
      if (!st.deck.flipped) { e.preventDefault(); flip(); }
      return;
    }
    if (st.deck.flipped && (e.key === "1" || e.key === "2" || e.key === "3")) {
      e.preventDefault();
      grade(GRADES[Number(e.key) - 1]);
    }
  });

  // 따라쓰기 완료 화면에서 만난 단어를 누르면 이리로 온다
  window.vocabOpenWord = function (id) {
    var w = st.words[id];
    var go = function (word) {
      st.language = word.language; st.level = word.level; st.view = "list";
      st.selected = id; st.find = ""; $("vFind").value = "";
      savePrefs();
      // 탭을 누른 것과 똑같이 연다(목록을 불러오며 이 단어를 골라 둔다)
      document.querySelector('#navTabs .k-tab[data-tab="vocab"]').click();
    };
    if (w) go(w); else getWord(id).then(go).catch(function (e) { toast(errText(e)); });
  };

  // ── 시작 ────────────────────────────────────────────────────
  function show() {
    if (!st.ready) return;
    renderControls();
    renderStats();
    if (!st.shown) {
      st.shown = true;
      loadList();
      if (st.view === "cards") startDeck(false);
    } else {
      refreshCounts();
      if (st.view === "list") loadList();
    }
  }
  $("navTabs").addEventListener("click", function (e) {
    var b = e.target.closest('.k-tab[data-tab="vocab"]');
    if (b) show();
  });
  document.addEventListener("pywebviewready", function () {
    api().vocab_overview().then(function (o) {
      applyOverview(o);
      var p = o.prefs || {};
      if (p.language) st.language = p.language;
      if (p.level) st.level = p.level;
      if (p.explain) st.explain = p.explain;
      if (p.view) st.view = p.view;
      if (typeof p.ruby === "boolean") st.ruby = p.ruby;
      st.ready = true;
      renderControls();
      renderStats();
      if (!$("tab-vocab").classList.contains("hidden")) show();
    }).catch(function (e) { toast("단어 자료를 불러오는 중 오류: " + errText(e)); });
  });
})();
