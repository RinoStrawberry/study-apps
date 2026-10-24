/* 어려운 말 위에 작은 뜻 — 글을 읽다 막히는 자리에만 뜻을 얹는다(아마존 Word Wise 같은 것).
 *
 * 자료는 새로 만들지 않는다. 글마다 이미 붙어 있는 어휘·관용구 해설(analysis.vocabulary,
 * analysis.idioms)을 그대로 쓰고, 말의 난이도는 assets/낱말수준.json 에서 읽는다
 * (낱말수준만들기.py 가 글 244편에서 문서 빈도를 세어 1~5로 매긴 표).
 *
 * 쓰는 법:
 *   WordWise.준비().then(...)                 — 난이도 표를 한 번 읽어 둔다
 *   el.innerHTML = WordWise.꾸미기(글, 세션, 4) — 4수준 이상인 말에 뜻을 얹은 HTML
 */
window.WordWise = (function () {
  "use strict";

  var 표 = null;            // { en: {말: 수준}, ja: {...} }
  var 사전 = { en: null, ja: null };   // 앱이 들고 있는 단어 300개 — {표제어: {뜻, 수준}}
  var 읽는중 = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function 준비() {
    if (표) return Promise.resolve(표);
    if (읽는중) return 읽는중;
    읽는중 = fetch("낱말수준.json").then(function (r) {
      if (!r.ok) throw new Error("낱말수준.json 없음");
      return r.json();
    }).then(function (j) {
      표 = (j && j.수준) || { en: {}, ja: {} };
      return 표;
    })["catch"](function () {
      표 = { en: {}, ja: {} };     // 표가 없어도 뜻은 얹는다(모두 5수준으로 본다)
      return 표;
    });
    return 읽는중;
  }

  function 수준(lang, 말) {
    var 칸 = (표 && 표[lang]) || {};
    var v = 칸[말];
    return typeof v === "number" ? v : 5;
  }

  /* 뜻은 한 줄로 짧게 — 글줄 위에 얹는 자리라 길면 읽기를 방해한다. */
  function 짧게(뜻) {
    var s = String(뜻 == null ? "" : 뜻).trim();
    s = s.split(/[;:]/)[0];
    s = s.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    // 뜻을 여럿 늘어놓은 것은 앞의 한두 개만 쓴다 — 글줄 위는 좁다
    var 조각 = s.split(/\s*[,·\/]\s*/).filter(Boolean);
    if (조각.length > 1) {
      var 모음 = [];
      for (var i = 0; i < 조각.length; i++) {
        if (모음.length && 모음.join(" · ").length + 조각[i].length > 10) break;
        모음.push(조각[i]);
        if (모음.join(" · ").length >= 4) break;
      }
      if (모음.length) s = 모음.join(" · ");
    }
    if (s.length > 16) {
      var 자름 = s.slice(0, 16);
      var i = Math.max(자름.lastIndexOf(","), 자름.lastIndexOf(" "), 자름.lastIndexOf("·"));
      s = (i > 8 ? 자름.slice(0, i) : 자름).trim();
      // "~에 대한 강력한" 처럼 꾸미는 말로 끝나면 읽다 말게 되므로 그 끝말을 떼어 낸다
      var 끝말 = s.split(" ").pop();
      if (s.indexOf(" ") > 0 && /(한|된|는|할|적인|스러운)$/.test(끝말)) {
        s = s.slice(0, s.length - 끝말.length).trim();
      }
    }
    return s.replace(/[\s,·\/]+$/, "");
  }

  function 벗기기(말) {
    return String(말 || "").replace(/\s*\([^)]*\)/g, "").trim();
  }

  /* 글에서 찾을 말의 모양. 영어는 굴절(-s/-ed/-ing)까지 받아 준다. */
  function 틀(말, lang) {
    var 안전 = 말.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (lang === "ja") return new RegExp(안전, "g");
    var 조각 = 안전.split(/\s+/);
    var 끝 = 조각.pop();
    var 앞 = 조각.length ? 조각.join("\\s+") + "\\s+" : "";
    var 꼬리;
    if (/y$/.test(끝)) 꼬리 = 끝.slice(0, -1) + "(?:y|ies|ied|ying)";
    else if (/e$/.test(끝)) 꼬리 = 끝.slice(0, -1) + "(?:e|es|ed|ing)";
    else 꼬리 = 끝 + "(?:s|es|ed|ing|'s)?";
    return new RegExp("\\b" + 앞 + 꼬리 + "\\b", "gi");
  }

  function 목표들(session) {
    var an = (session && session.analysis) || {};
    var out = [];
    (an.vocabulary || []).forEach(function (it) {
      var 말 = String(it.word || "").trim();
      var 뜻 = 짧게(it.meaning_ko);
      if (말 && 뜻) out.push({ 말: 말, 뜻: 뜻, 온전한뜻: String(it.meaning_ko || "").trim(), 종류: "word" });
    });
    (an.idioms || []).forEach(function (it) {
      var 말 = 벗기기(it.phrase);
      var 뜻 = 짧게(it.meaning_ko);
      if (말 && 뜻) out.push({ 말: 말, 뜻: 뜻, 온전한뜻: String(it.meaning_ko || "").trim(), 종류: "idiom" });
    });
    return out;
  }

  /* 단어 사전(300개)을 받아 둔다 — 글에 그 말이 나오면 함께 뜻을 얹는다.
     목록은 app.js 가 파이썬에서 받아 넘긴다. */
  function 사전넣기(lang, rows) {
    var 칸 = {};
    (rows || []).forEach(function (w) {
      var 말 = String(w.headword || "").trim();
      var 뜻 = 짧게((w.summary && w.summary.ko) || "");
      if (!말 || !뜻) return;
      칸[말] = { 뜻: 뜻, 온전한뜻: String((w.summary && w.summary.ko) || "").trim(),
                수준: w.level === "easy" ? 2 : w.level === "mid" ? 3 : 4 };
    });
    사전[lang] = 칸;
  }

  function 사전있나(lang) { return !!사전[lang]; }

  var 한말최대 = 3;        // 같은 말이 여러 번 나오면 앞의 몇 번만 얹는다

  /**
   * 글에 뜻을 얹어 HTML 로 돌려준다.
   * @param {string} 글      본문
   * @param {object} session 글 자료(analysis 를 쓴다)
   * @param {number} 최소수준 이 수준 이상인 말에만 뜻을 얹는다(2~5)
   */
  function 고르기(본, session, 최소수준) {
    var lang = (session && session.language) || "en";
    var 벽 = Number(최소수준) || 4;
    var 찾음 = [];

    var 목표 = 목표들(session);
    var 이미 = {};
    목표.forEach(function (t) { 이미[t.말] = true; });
    var 책 = 사전[lang] || {};
    Object.keys(책).forEach(function (말) {
      if (이미[말]) return;
      // 일본어 한 글자(気·手 같은 것)는 다른 낱말 속에도 끼어 있어 얹으면 어지럽다
      if (lang === "ja" && 말.length < 2) return;
      목표.push({ 말: 말, 뜻: 책[말].뜻, 온전한뜻: 책[말].온전한뜻, 종류: "book", 수준: 책[말].수준 });
    });

    목표.forEach(function (t) {
      if ((t.수준 || 수준(lang, t.말)) < 벽) return;
      var re = 틀(t.말, lang);
      var m, 횟수 = 0;
      while ((m = re.exec(본)) !== null) {
        if (m[0].length === 0) { re.lastIndex += 1; continue; }
        찾음.push({ 자리: m.index, 길이: m[0].length, 글자: m[0], 뜻: t.뜻, 온전한뜻: t.온전한뜻 || t.뜻 });
        횟수 += 1;
        if (횟수 >= 한말최대) break;
      }
    });

    // 자리순으로 세우고, 겹치는 것은 긴 쪽(관용구)을 남긴다
    찾음.sort(function (a, b) { return a.자리 - b.자리 || b.길이 - a.길이; });
    var 쓸것 = [];
    var 끝 = -1;
    찾음.forEach(function (f) {
      if (f.자리 < 끝) return;
      쓸것.push(f);
      끝 = f.자리 + f.길이;
    });
    return 쓸것;
  }

  function 꾸미기(글, session, 최소수준) {
    var 본 = String(글 == null ? "" : 글);
    if (!본) return "";
    var 쓸것 = 고르기(본, session, 최소수준);
    if (!쓸것.length) return esc(본);

    var html = "";
    var 커서 = 0;
    쓸것.forEach(function (f) {
      html += esc(본.slice(커서, f.자리));
      var 토씨 = (f.온전한뜻 && f.온전한뜻 !== f.뜻) ? ' title="' + esc(f.온전한뜻) + '"' : "";
      html += '<ruby class="ww"' + 토씨 + ">" + esc(f.글자) + "<rt>" + esc(f.뜻) + "</rt></ruby>";
      커서 = f.자리 + f.길이;
    });
    html += esc(본.slice(커서));
    return html;
  }

  /* 뜻을 얹을 자리만 돌려준다(HTML 로 만들지 않는다) — 타이핑 화면처럼
     이미 글자마다 span 이 박혀 있는 곳에서 쓴다. [{자리, 길이, 뜻}] */
  function 찾기(글, session, 최소수준) {
    var 본 = String(글 == null ? "" : 글);
    if (!본) return [];
    return 고르기(본, session, 최소수준);
  }

  /* 이 글에서 각 수준으로 뜻이 몇 개나 붙는지 — 화면에 안내로 쓴다 */
  function 세기(글, session, 최소수준) {
    var 틀조각 = document.createElement("div");
    틀조각.innerHTML = 꾸미기(글, session, 최소수준);
    return 틀조각.querySelectorAll("ruby.ww").length;
  }

  return { 준비: 준비, 꾸미기: 꾸미기, 찾기: 찾기, 세기: 세기, 짧게: 짧게,
           사전넣기: 사전넣기, 사전있나: 사전있나 };
})();
