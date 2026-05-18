/* ══════════════════════════════════════════════════════════════════
   js/terminal-output.js
   화면 출력 — DOM 렌더링 헬퍼 및 미디어 출력 함수

   포함 범위:
     - textToNodes   : 문자열 → URL 파싱 후 DocumentFragment 반환
     - appendRaw     : 임의 노드를 출력 줄(.line.glow)로 삽입
     - appendText    : 텍스트 한 줄 출력 (색상 클래스 지정)
     - appendLines   : 여러 줄 일괄 출력
     - appendNode    : DOM 노드를 출력 줄로 삽입
     - makeBtn       : 컨트롤 버튼 생성 헬퍼
     - makeRange     : 볼륨/탐색 슬라이더 생성 헬퍼
     - renderImage   : 이미지 파일 출력
     - getYouTubeId  : YouTube URL 에서 영상 ID 추출
     - renderYouTube : YouTube iframe 임베드 출력

   의존 파일: terminal-state.js (output, scrollBottom, now, appendText)
   사용 파일: terminal-commands.js / terminal-input.js / audio-visualizer.js / video-player.js
══════════════════════════════════════════════════════════════════ */

/* ── 텍스트 → 노드 변환 ──────────────────────────────────────────── */
/* URL 포함 문자열을 파싱해 <a> 링크와 텍스트 노드의 Fragment 로 반환 */
function textToNodes(text) {
  const frag   = document.createDocumentFragment();
  const URL_RE = /(https?:\/\/[^\s]+)/g;
  const parts  = text.split(URL_RE);
  parts.forEach(p => {
    if (/^https?:\/\//.test(p)) {
      const a = document.createElement('a');
      a.href = p; a.textContent = p;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'turl';
      a.onclick = e => e.stopPropagation();
      frag.appendChild(a);
    } else {
      frag.appendChild(document.createTextNode(p));
    }
  });
  return frag;
}

/* ── 기본 출력 헬퍼 ──────────────────────────────────────────────── */

/* 임의 DOM 노드를 .line.glow 행으로 감싸 출력 영역에 추가 */
function appendRaw(node, withTs) {
  const row = document.createElement('div');
  row.className = 'line glow';
  if (withTs) {
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = `[${now()}]`;
    row.appendChild(ts);
  }
  row.appendChild(node);
  output.appendChild(row);
  scrollBottom();
}

/* 텍스트 한 줄을 지정 색상 클래스로 출력 */
function appendText(text, colorClass, withTs) {
  if (text === '') {
    /* 빈 문자열은 spacer(여백 줄) 처리 */
    const s = document.createElement('div');
    s.className = 'line spacer';
    output.appendChild(s);
    scrollBottom();
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = `text ${colorClass}`;
  wrap.appendChild(textToNodes(text));
  appendRaw(wrap, withTs);
}

/* 문자열 배열을 동일 색상으로 한 줄씩 출력 */
function appendLines(lines, colorClass, withTs) {
  lines.forEach(l => appendText(l, colorClass, withTs));
}

/* 이미 만들어진 DOM 노드를 출력 줄로 삽입 */
function appendNode(node, withTs) {
  const wrap = document.createElement('div');
  wrap.appendChild(node);
  appendRaw(wrap, withTs);
}

/* ── UI 공통 컴포넌트 헬퍼 ───────────────────────────────────────── */
/* 오디오/비디오 플레이어의 컨트롤 버튼 생성 */
function makeBtn(label, onclick) {
  const b = document.createElement('button');
  b.className = 'ctrl-btn';
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

/* 오디오/비디오 플레이어의 볼륨·탐색 슬라이더 생성 */
function makeRange(init, onchange) {
  const r = document.createElement('input');
  r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05; r.value = init;
  r.oninput = () => onchange(parseFloat(r.value));
  return r;
}

/* ── 이미지 출력 ─────────────────────────────────────────────────── */
/* 파일 객체를 받아 메타 정보와 함께 이미지를 출력 영역에 표시 */
function renderImage(file) {
  const url = URL.createObjectURL(file);
  const div = document.createElement('div');
  div.className = 'img-out';

  const meta = document.createElement('div');
  meta.className = 'media-meta';

  const img = document.createElement('img');
  img.src = url;
  img.onload = () => {
    meta.innerHTML =
      `<span>FILE: ${file.name}</span>` +
      `<span>SIZE: ${(file.size / 1024).toFixed(1)} KB</span>` +
      `<span>RES: ${img.naturalWidth} x ${img.naturalHeight} px</span>`;
    scrollBottom();
  };
  img.onerror = () => { meta.textContent = '이미지를 불러올 수 없습니다.'; };

  div.appendChild(meta);
  div.appendChild(img);

  appendText(`guest@system:~$ [file attached: ${file.name}]`, 'c-green', true);
  appendNode(div, false);
}

/* ── YouTube 출력 ────────────────────────────────────────────────── */

/* YouTube URL 에서 영상 ID 문자열을 추출해 반환 (없으면 null) */
function getYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/embed\/([^/?]+)/);
      if (m) return m[1];
    }
  } catch (e) {}
  return null;
}

/* YouTube 영상을 iframe 으로 임베드해 출력 영역에 표시 */
function renderYouTube(url, videoId) {
  const wrap = document.createElement('div');
  wrap.className = 'yt-wrap';

  const meta = document.createElement('div');
  meta.className = 'media-meta';
  meta.innerHTML = `<span>YouTube</span><span>${url}</span>`;
  wrap.appendChild(meta);

  const box    = document.createElement('div');
  box.className = 'yt-frame-box';
  const iframe = document.createElement('iframe');
  iframe.src  = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;
  box.appendChild(iframe);
  wrap.appendChild(box);

  appendNode(wrap, false);
  scrollBottom();
}
