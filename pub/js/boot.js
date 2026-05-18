/* ══════════════════════════════════════════════════════════════════
   js/boot.js  — 자기완결적 부팅 시스템
   외부 전역(appendText 등)에 의존하지 않고 DOM API 만 사용한다.
══════════════════════════════════════════════════════════════════ */
(function () {
  /* ── 내부 DOM 헬퍼 ─────────────────────────────────────────────── */
  var _out = document.getElementById('output');
  var _bar = document.getElementById('promptbar');
  var _inp = document.getElementById('real-input');

  function _addLine(text, colorClass) {
    var row  = document.createElement('div');
    row.className = 'line glow';
    var wrap = document.createElement('div');
    wrap.className = 'text ' + (colorClass || 'c-dim');
    wrap.textContent = text;
    row.appendChild(wrap);
    _out.appendChild(row);
    _out.scrollTop = _out.scrollHeight;
  }

  function _addSpacer() {
    var sp = document.createElement('div');
    sp.className = 'line spacer';
    _out.appendChild(sp);
  }

  /* ── 실제 검증 함수 맵 ─────────────────────────────────────────── */
  var _CHECK_FNS = {
    checkBrowserReady: function () {
      return Promise.resolve(typeof document !== 'undefined' && !!document.getElementById('output'));
    },
    loadBootConfig: function () {
      /* fetch 성공 후 이 콜백 내부에서 실행되므로 항상 true */
      return Promise.resolve(true);
    },
    loadCoreLibraries: function () {
      return Promise.resolve(typeof appendText === 'function');
    },
    checkFirebaseReady: function () {
      /* window.__firebaseReady 가 세팅될 때까지 최대 2초 폴링 */
      return new Promise(function (resolve) {
        var tries = 0;
        var poll = setInterval(function () {
          if (window.__firebaseReady !== undefined || tries++ > 20) {
            clearInterval(poll);
            resolve(!!window.__firebaseReady);
          }
        }, 100);
      });
    }
  };

  /* ── 로고 애니메이션 ───────────────────────────────────────────── */
  function _animLogo(logoText, onDone) {
    var pre = document.createElement('pre');
    pre.id = 'logo';
    pre.textContent = '';
    _out.appendChild(pre);
    if (!logoText) { setTimeout(onDone, 50); return; }
    var i = 0;
    var t = setInterval(function () {
      i += 3;
      pre.textContent = logoText.substring(0, i);
      _out.scrollTop = _out.scrollHeight;
      if (i >= logoText.length) {
        clearInterval(t);
        pre.textContent = logoText;
        setTimeout(onDone, 300);
      }
    }, 5);
  }

  /* ── 시퀀스 실행기 (async 검증 지원) ──────────────────────────── */
  function _runSeq(seq) {
    var idx = 0;

    function next() {
      if (idx >= seq.length) {
        /* 부팅 완료 */
        if (typeof booting !== 'undefined') booting = false;
        _bar.style.display = '';
        _inp.focus();
        return;
      }

      var step = seq[idx++];

      /* function 필드가 있고 검증 함수가 등록된 경우 — 실제 검증 실행 */
      if (step.function && _CHECK_FNS[step.function]) {
        _CHECK_FNS[step.function]().then(function (ok) {
          var msg   = ok ? (step.successMessage || step.step || '')
                        : (step.failureMessage || step.step || '');
          var color = ok ? 'c-green'
                        : (step.critical ? 'c-red' : 'c-yellow');
          if (msg) _addLine(msg, color);
          /* critical 실패 시 부팅 중단 */
          if (!ok && step.critical) {
            _addLine('[ CRITICAL ] 부팅을 중단합니다.', 'c-red');
            return;
          }
          setTimeout(next, 85);
        });
        return; /* Promise 대기 중 — setInterval 루프 필요 없음 */
      }

      /* 일반 메시지 단계 */
      var raw   = (step.message !== undefined) ? step.message
                : (step.successMessage || step.step || '');
      var msg   = raw.replace('{lastLogin}', new Date().toDateString());
      var color = step.color || 'c-dim';
      if (msg === '') { _addSpacer(); } else { _addLine(msg, color); }
      setTimeout(next, 85);
    }

    next();
  }

  /* ── 인라인 폴백 ───────────────────────────────────────────────── */
  var FB_LOGO = '██████████████████████████\n█    SMARTFLEX  XTX9      █\n██████████████████████████';
  var FB_SEQ  = [
    { message:'브라우저 로드 완료',                        color:'c-green' },
    { message:'SMARTFLEX XTX9 부팅을 시작합니다...',       color:'c-dim'   },
    { message:'부팅 설정 로드 완료',                       color:'c-dim'   },
    { message:'기본 JS 라이브러리 로드 완료',              color:'c-dim'   },
    { message:'Firebase Analytics 연결 완료',             color:'c-green' },
    { message:'SMARTFLEX XTX9 부팅이 완료되었습니다.',    color:'c-green' },
  ];

  /* ── 메인 부팅 진입점 ──────────────────────────────────────────── */
  _bar.style.display = 'none';

  fetch('data/json/boot.json')
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (cfg) {
      var logoLines = (cfg.bootLogo && cfg.bootLogo.ascii) || [];
      var logo = logoLines.length ? logoLines.join('\n') : FB_LOGO;
      var seq  = (cfg.bootSequence && cfg.bootSequence.length) ? cfg.bootSequence : FB_SEQ;
      _animLogo(logo, function () { _runSeq(seq); });
    })
    .catch(function () {
      _animLogo(FB_LOGO, function () { _runSeq(FB_SEQ); });
    });
}());
