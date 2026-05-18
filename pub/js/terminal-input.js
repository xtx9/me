/* ══════════════════════════════════════════════════════════════════
   js/terminal-input.js
   입력창 — 사용자 입력 처리 및 이벤트 리스너 등록

   포함 범위:
     - flashSend   : 전송 버튼 플래시 애니메이션
     - sendInput   : 입력값 제출 처리
     - autoResize  : textarea 자동 높이 조절
     - 이벤트 리스너:
         realInput   → input (autoResize)
         realInput   → keydown (Enter 실행, ↑↓ 히스토리)
         fileInput   → change (이미지/비디오/오디오/기타 파일 처리)
         #terminal   → click (입력창 포커스)

   의존 파일:
     - terminal-state.js    (realInput, promptbar, fileInput,
                             cmdHistory, histIdx, booting, focusInput)
     - terminal-output.js   (appendText, appendLines)
     - terminal-commands.js (runCommand)
     - audio-visualizer.js  (renderAudio)
     - video-player.js      (renderVideo)
══════════════════════════════════════════════════════════════════ */

/* ── 전송 버튼 플래시 효과 ───────────────────────────────────────── */
/* 전송 시 ➤ 버튼에 flash 클래스를 붙여 CSS 애니메이션을 트리거한다 */
function flashSend() {
  const btn = document.querySelector('.send-btn');
  btn.classList.remove('flash');
  void btn.offsetWidth; /* reflow — 제거 후 즉시 재추가가 가능하도록 */
  btn.classList.add('flash');
  btn.addEventListener('animationend', () => btn.classList.remove('flash'), { once: true });
}

/* ── 입력 제출 ───────────────────────────────────────────────────── */
/* 전송 버튼 클릭 또는 Enter 키 입력 시 호출 */
function sendInput() {
  const val = realInput.value;
  realInput.value = '';
  realInput.style.height = 'auto';
  flashSend();
  runCommand(val);
  realInput.focus();
}

/* ── textarea 자동 높이 조절 ─────────────────────────────────────── */
/* 입력 내용에 따라 textarea 높이를 동적으로 늘리거나 줄인다 */
function autoResize() {
  realInput.style.height = 'auto';
  realInput.style.height = realInput.scrollHeight + 'px';
}

/* ── 이벤트 리스너 등록 ──────────────────────────────────────────── */

/* textarea 자동 높이 조절 */
realInput.addEventListener('input', autoResize);

/* 키보드 단축키 처리 */
realInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    /* Enter — 명령 실행 (Shift+Enter 는 줄바꿈) */
    e.preventDefault();
    const val = realInput.value;
    realInput.value = '';
    realInput.style.height = 'auto';
    flashSend();
    runCommand(val);

  } else if (e.key === 'ArrowUp' && !realInput.value.includes('\n')) {
    /* ↑ — 이전 히스토리 탐색 */
    e.preventDefault();
    if (histIdx < cmdHistory.length - 1) histIdx++;
    realInput.value = cmdHistory[histIdx] || '';
    autoResize();

  } else if (e.key === 'ArrowDown' && !realInput.value.includes('\n')) {
    /* ↓ — 다음 히스토리 탐색 */
    e.preventDefault();
    if (histIdx > 0) {
      histIdx--;
      realInput.value = cmdHistory[histIdx] || '';
    } else if (histIdx === 0) {
      histIdx = -1;
      realInput.value = '';
    }
    autoResize();
  }
});

/* 파일 첨부 처리 */
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = ''; /* 같은 파일 재첨부 허용을 위해 초기화 */

  if (file.type.startsWith('image/')) {
    renderImage(file);
  } else if (file.type.startsWith('video/')) {
    renderVideo(file);
  } else if (file.type.startsWith('audio/')) {
    renderAudio(file);
  } else {
    /* 이미지/비디오/오디오 외 파일 — 메타 정보만 출력 */
    appendText(`guest@system:~$ [file attached: ${file.name}]`, 'c-green', true);
    appendLines([
      `FILE: ${file.name}`,
      `SIZE: ${(file.size / 1024).toFixed(1)} KB`,
      `TYPE: ${file.type || 'unknown'}`,
    ], 'c-white', true);
  }
});

/* 터미널 영역 클릭 시 입력창 포커스 */
document.getElementById('terminal').addEventListener('click', focusInput);
