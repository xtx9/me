/* ══════════════════════════════════════════════════════════════════
   js/terminal-state.js
   페이지 초기화 — DOM 참조, 전역 상태, 공통 유틸리티 함수

   포함 범위:
     - DOM 요소 참조 상수 (output, realInput, promptbar 등)
     - 앱 상태 변수 (cmdHistory, histIdx, booting)
     - 공통 유틸 함수 (now, fmtTime, scrollBottom, focusInput)
     - 시계 (타이틀바 우측 실시간 시각)

   의존 파일: 없음 (가장 먼저 로드)
   사용 파일: terminal-output.js / terminal-commands.js / terminal-input.js / boot.js
══════════════════════════════════════════════════════════════════ */

/* ── DOM 참조 상수 ───────────────────────────────────────────────── */
/* document.getElementById 를 반복 호출하지 않도록 상수로 캐싱한다 */
const output    = document.getElementById('output');
const realInput = document.getElementById('real-input');
const titleText = document.getElementById('title-text');
const promptbar = document.getElementById('promptbar');
const fileInput = document.getElementById('file-input');

/* ── 앱 상태 변수 ────────────────────────────────────────────────── */
let cmdHistory = []; /* 입력 히스토리 (↑↓ 키 탐색용) */
let histIdx    = -1; /* 현재 히스토리 포인터 */
let booting    = true; /* 부팅 중 여부 — 부팅 완료 시 false 로 변경 */

/* ── 공통 유틸리티 함수 ──────────────────────────────────────────── */

/* 현재 시각을 HH:MM:SS 형식 문자열로 반환 */
function now() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

/* 초(second) 값을 MM:SS 형식으로 변환 (오디오/비디오 플레이어용) */
function fmtTime(s) {
  if (!isFinite(s)) return '00:00';
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/* 출력 영역을 항상 최하단으로 스크롤 */
function scrollBottom() {
  output.scrollTop = output.scrollHeight;
}

/* 텍스트 드래그 중이 아닐 때만 입력창에 포커스 */
function focusInput() {
  if (!booting && !window.getSelection().toString()) realInput.focus();
}

/* ── 실시간 시계 (타이틀바 우측) ─────────────────────────────────── */
/* IIFE 로 즉시 실행해 페이지 로드 직후부터 시각이 표시되게 한다 */
(function tickClock() {
  const el = document.getElementById('clock');
  function update() {
    const n  = new Date();
    const hh = String(n.getHours()).padStart(2, '0');
    const mm = String(n.getMinutes()).padStart(2, '0');
    const ss = String(n.getSeconds()).padStart(2, '0');
    el.textContent = hh + ':' + mm + ':' + ss;
  }
  update();
  setInterval(update, 1000);
}());
