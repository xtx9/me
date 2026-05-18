/* ══════════════════════════════════════════════════════════════════
   js/terminal-commands.js
   명령어 처리 — JSON 기반 명령어 로딩, help 렌더러, 명령어 실행기

   포함 범위:
     - CMDS_LIST      : commands.json 에서 로드한 명령어 정의 배열
     - loadCommands   : commands.json 비동기 로드
     - renderHelp     : help 메뉴 DOM 생성 함수
     - renderDocViewer: iframe 문서 뷰어 렌더러
     - runCommand     : 사용자 입력 파싱 → execCmd 위임
     - execCmd        : action 타입별 동적 디스패치

   action 타입:
     "lines"   — commands.json 의 output 배열을 터미널에 출력
     "exec"    — function 필드에 매핑된 JS 함수를 직접 호출
     "iframe"  — url 필드의 문서를 출력창 내 뷰어로 표시
     "youtube" — YouTube URL 자동 감지 (help 표시 전용, 직접 실행 안 함)

   의존 파일:
     - terminal-state.js   (output, cmdHistory, histIdx)
     - terminal-output.js  (appendText, appendLines, appendNode,
                            getYouTubeId, renderYouTube)
══════════════════════════════════════════════════════════════════ */

/* ── 명령어 목록 (commands.json 로드 후 채워짐) ────────────────── */
let CMDS_LIST = [];

/* ── commands.json 비동기 로드 ──────────────────────────────────── */
async function loadCommands() {
  try {
    const res = await fetch('data/json/commands.json');
    if (!res.ok) throw new Error('commands.json 로드 실패');
    const data = await res.json();
    CMDS_LIST = data.commands || [];
  } catch (e) {
    CMDS_LIST = [];
    console.warn('[commands] JSON 로드 실패, 빈 목록으로 대체:', e.message);
  }
}

/* ── help 메뉴 렌더러 ────────────────────────────────────────────── */
function renderHelp() {
  const wrap = document.createElement('div');
  wrap.className = 'help-table';

  const label = document.createElement('div');
  label.style.cssText = 'color:var(--dim);font-size:11px;margin-bottom:4px';
  label.textContent = 'Available commands — click to run:';
  wrap.appendChild(label);

  CMDS_LIST.forEach(({ name, desc, action }) => {
    const isInfo = action === 'youtube';

    const row = document.createElement('div');
    row.className = 'help-row';

    const btn = document.createElement('button');
    btn.className = 'help-cmd' + (isInfo ? ' help-cmd--info' : '');
    btn.textContent = name;
    if (!isInfo) {
      btn.onclick = e => { e.stopPropagation(); runCommand(name); };
    } else {
      btn.style.cssText = 'cursor:default;opacity:.5';
    }

    const d = document.createElement('span');
    d.className = 'help-desc';
    d.textContent = '— ' + desc;

    row.appendChild(btn);
    row.appendChild(d);
    wrap.appendChild(row);
  });

  return wrap;
}

/* ── 오버레이 생성 / 제거 헬퍼 ─────────────────────────────────── */
function _createDocOverlay() {
  _removeDocOverlay();
  const ov = document.createElement('div');
  ov.id = 'doc-overlay';
  document.getElementById('app').appendChild(ov);
  return ov;
}

function _removeDocOverlay() {
  const ov = document.getElementById('doc-overlay');
  if (ov) ov.remove();
}

/* ── 문서 뷰어 (iframe 렌더러) ───────────────────────────────────── */
function renderDocViewer(url, title) {
  /* 기존 뷰어가 열려 있으면 제거 후 재생성 */
  const existing = document.querySelector('.doc-viewer');
  if (existing) existing.remove();
  _removeDocOverlay();

  const appEl      = document.getElementById('app');
  const titlebarEl = document.getElementById('titlebar');

  /* ── 래퍼 ── */
  const wrap = document.createElement('div');
  wrap.className = 'doc-viewer doc-viewer--fullscreen';

  /* 타이틀바 아래쪽 좌표를 동적으로 계산해 전체화면 top 지정 */
  function _applyFullscreenTop() {
    const rect = titlebarEl.getBoundingClientRect();
    wrap.style.top = rect.bottom + 'px';
  }

  /* ── 제목 바 ── */
  const bar = document.createElement('div');
  bar.className = 'doc-viewer-bar';

  const barLeft = document.createElement('div');
  barLeft.className = 'doc-viewer-bar-left';

  const titleEl = document.createElement('span');
  titleEl.className = 'doc-viewer-title';
  titleEl.textContent = '[ ' + (title || url) + ' ]';

  const urlEl = document.createElement('span');
  urlEl.className = 'doc-viewer-url';
  urlEl.textContent = url;

  barLeft.appendChild(titleEl);
  barLeft.appendChild(urlEl);

  /* ── 버튼 그룹 ── */
  const actions = document.createElement('div');
  actions.className = 'doc-viewer-actions';

  /* 버튼 1: 축소 / 확대 토글 */
  const btnToggle = document.createElement('button');
  btnToggle.className = 'doc-viewer-btn';
  btnToggle.textContent = '⊟ 축소';
  btnToggle.title = '축소';

  /* 버튼 2: 새 탭 오픈 */
  const btnOpen = document.createElement('button');
  btnOpen.className = 'doc-viewer-btn';
  btnOpen.textContent = '↗ 오픈';
  btnOpen.title = '새 탭에서 열기';
  btnOpen.onclick = () => window.open(url, '_blank', 'noopener,noreferrer');

  /* 버튼 3: 닫기 */
  const btnClose = document.createElement('button');
  btnClose.className = 'doc-viewer-btn doc-viewer-btn--close';
  btnClose.textContent = '✕ 닫기';
  btnClose.title = '닫기';
  btnClose.onclick = () => {
    wrap.remove();
    _removeDocOverlay();
  };

  actions.appendChild(btnToggle);
  actions.appendChild(btnOpen);
  actions.appendChild(btnClose);

  bar.appendChild(barLeft);
  bar.appendChild(actions);

  /* ── 로딩 표시 ── */
  const loading = document.createElement('div');
  loading.className = 'doc-viewer-loading';
  loading.textContent = 'loading ' + url + ' ...';

  /* ── iframe ── */
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = title || url;
  frame.setAttribute('loading', 'lazy');
  frame.onload  = () => loading.remove();
  frame.onerror = () => {
    loading.textContent = '[오류] 문서를 불러올 수 없습니다: ' + url;
  };

  wrap.appendChild(bar);
  wrap.appendChild(loading);
  wrap.appendChild(frame);

  /* ── 전체화면으로 열기 (슬라이드업) ── */
  _applyFullscreenTop();
  appEl.appendChild(wrap);
  _createDocOverlay();

  /* ── 축소 / 확대 토글 ── */
  let isFullscreen = true;

  btnToggle.onclick = () => {
    if (isFullscreen) {
      /* 전체화면 → 축소(인라인) */
      wrap.classList.remove('doc-viewer--fullscreen');
      wrap.classList.add('doc-viewer--minimized');
      wrap.style.top = '';
      btnToggle.textContent = '⊞ 확대';
      btnToggle.title = '확대';
      _removeDocOverlay();
      /* #output 아래쪽에 인라인으로 이동 */
      output.appendChild(wrap);
      output.scrollTop = output.scrollHeight;
      isFullscreen = false;
    } else {
      /* 축소 → 전체화면 */
      wrap.classList.remove('doc-viewer--minimized');
      wrap.classList.add('doc-viewer--fullscreen');
      btnToggle.textContent = '⊟ 축소';
      btnToggle.title = '축소';
      appEl.appendChild(wrap);
      _applyFullscreenTop();
      _createDocOverlay();
      isFullscreen = true;
    }
  };
}

/* ══════════════════════════════════════════════════════════════════
   exec action 전용 JS 함수들
   — 동적 처리가 필요한 명령어만 여기에 정의
   — 정적 출력 명령어는 commands.json 의 "lines" action 으로 관리
══════════════════════════════════════════════════════════════════ */

function cmdHelp() {
  appendNode(renderHelp(), true);
}

function cmdDate() {
  appendText(new Date().toString(), 'c-white', true);
}

function cmdClear() {
  output.innerHTML = '';
}

/* ── 명령어 진입점 ───────────────────────────────────────────────── */
function runCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  appendText(`guest@system:~$ ${trimmed}`, 'c-green', true);
  cmdHistory.unshift(trimmed);
  histIdx = -1;

  /* YouTube URL 자동 감지 */
  const ytId = getYouTubeId(trimmed);
  if (ytId) { renderYouTube(trimmed, ytId); return; }

  const parts = trimmed.split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const args  = parts.slice(1);
  execCmd(cmd, args, trimmed);
}

/* ── 명령어 실행기 ───────────────────────────────────────────────── */
function execCmd(cmd, args, full) {
  const fullLower = full.toLowerCase();

  /* CMDS_LIST 에서 일치하는 항목 탐색 (전체 문자열 우선, 이후 첫 단어) */
  const entry = CMDS_LIST.find(({ name, action }) => {
    if (action === 'youtube') return false;
    const n = name.toLowerCase();
    return n === fullLower || n === cmd;
  });

  if (entry) {
    switch (entry.action) {

      /* ─ lines — JSON output 배열을 터미널에 직접 출력 ─ */
      case 'lines':
        if (Array.isArray(entry.output) && entry.output.length) {
          appendLines(entry.output, entry.class || 'c-white', true);
        }
        break;

      /* ─ exec — function 필드의 JS 함수 호출 ─ */
      case 'exec': {
        const fn = window[entry.function];
        if (typeof fn === 'function') {
          fn(args, full, entry);
        } else {
          appendText(`[오류] 함수를 찾을 수 없음: ${entry.function}`, 'c-red', true);
        }
        break;
      }

      /* ─ iframe — 문서 뷰어로 출력 ─ */
      case 'iframe':
        renderDocViewer(entry.url, entry.title || entry.name);
        break;

      /* 향후 추가 예정:
         case 'node':    DOM 컴포넌트 렌더링
         case 'dynamic': 외부 데이터 fetch 후 출력
      */

      default:
        appendText(`[오류] 알 수 없는 action: ${entry.action}`, 'c-red', true);
    }
    return;
  }

  /* 등록되지 않은 명령어 */
  appendText(`bash: ${cmd}: command not found. Type 'help' for available commands.`, 'c-red', true);
}

/* ── 초기 로드 ───────────────────────────────────────────────────── */
loadCommands();
