/* ══════════════════════════════════════════════════════════════════
   video-player.js — 동영상 플레이어 모듈 (v3.0 개선판)
   파일명: js/video-player.js

   ─── 의존성 ────────────────────────────────────────────────────────
   terminal.html 의 전역 함수 (이 파일보다 먼저 로드됨):
     makeBtn(label, fn)       : 컨트롤 버튼 DOM 생성
     makeRange(init, fn)      : 볼륨 슬라이더 DOM 생성
     fmtTime(s)               : 초 → "00:00" 형식 변환
     appendText(t, c, ts)     : 터미널 텍스트 출력
     appendNode(n, ts)        : 터미널 노드 출력
     scrollBottom()           : 터미널 하단 스크롤

   CSS 파일:
     css/terminal.css         : 공통 변수 및 .player, .controls 등 기반 스타일
     css/video-player.css     : 동영상 플레이어 전용 스타일

   ─── v3.0 주요 변경 사항 ─────────────────────────────────────────
   [창크기 조절 버튼] (.vp-size-btn)
     - 클릭 시 3단계 아이콘이 슬라이딩 애니메이션으로 나타남
     - ① 터미널 출력창 크기에 맞춤 (기본, max-width 해제)
     - ② 브라우저 창 전체에 맞춤 (CSS position:fixed)
     - ③ 컴퓨터 모니터 전체화면 (Fullscreen API)
     - 열린 메뉴 외부 클릭 시 자동으로 닫힘

   [FAKE 버튼] (.vp-fake-btn)
     - 활성화(ON) 상태에서 영상이 일시정지되면 imgs/fake.png 이미지로 화면 가림
     - 활성화(ON) 상태에서 영상이 재생되면 이미지 가리개를 숨겨 실제 영상 표시
     - 비활성화(OFF) 상태에서는 아무런 동작 없음
     - 일하는 도중 영상 화면을 들키지 않기 위한 위장 기능

   [컨트롤 바 순서]
     ▶(재생) | 시간 | 🔊 볼륨 | ⟲(반복) | ⤡(창크기) | 🎭(Fake) | 📷(스크린샷) | ⚙(옵션)

   [기타]
     - 이전 버전의 단순 전체화면 버튼 제거, 창크기 버튼으로 통합
   ────────────────────────────────────────────────────────────────── */

/* ════════════════════════════════════════════════════════════════════
   VideoPlayer 클래스
   ─ 생성 흐름: constructor → _buildPlayer → render (터미널에 삽입)
   ─ 재생 흐름: _togglePlay → videoEl.play/pause
   ─ 트랙 전환: _playTrack → videoEl.src 변경 → play
   ─ 창크기   : _toggleSizeMenu → _applySizeMode (3단계)
   ─ FAKE    : _toggleFake → _syncFakeOverlay (pause/play 이벤트에서 동기화)
════════════════════════════════════════════════════════════════════ */
class VideoPlayer {
  /* ─────────────────────────────────────────────────────────────────
     constructor(firstFile)
     첫 번째 동영상 파일을 받아 플레이어 전체 상태를 초기화합니다.
     @param {File} firstFile — 최초 재생할 동영상 파일
  ───────────────────────────────────────────────────────────────── */
  constructor(firstFile) {
    /* ── 플레이리스트 상태 ──────────────────────────── */
    this.playlist = []; /* [{file, url, name, size}] 배열 */
    this.currentIdx = 0; /* 현재 재생 중인 트랙 인덱스 */

    /* ── 반복 모드: 'none' | 'one' | 'all' ── */
    this.repeatMode = "none";

    /* ── 옵션 패널 상태 ── */
    this.activeTab = "info"; /* 'info' | 'add' */
    this.isPanelOpen = false;

    /* ── 창크기 메뉴 상태 ── */
    /* sizeMode: 'normal' | 'browser' | 'monitor'
       normal  : 터미널 출력창 안의 기본 크기 (max-width 제약)
       browser : CSS position:fixed 로 브라우저 창 전체 점유
       monitor : Fullscreen API 로 모니터 전체화면 */
    this.sizeMode = "normal";
    this.isSizeMenuOpen = false; /* 창크기 슬라이딩 메뉴 열림 여부 */

    /* ── FAKE 버튼 상태 ──────────────────────────────
       isFakeOn: true 이면 영상 일시정지 시 fake.png 오버레이 표시 */
    this.isFakeOn = false;

    /* ── 첫 파일 추가 ── */
    this._addTrack(firstFile);

    /* ── DOM 생성 ── */
    this.playerEl = this._buildPlayer();
  }

  /* ─────────────────────────────────────────────────────────────────
     render()
     터미널 출력 영역에 삽입할 최상위 래퍼 요소를 반환합니다.
     meta 영역(파일 정보)과 playerEl을 함께 감쌉니다.
     @returns {HTMLElement} 래퍼 div
  ───────────────────────────────────────────────────────────────── */
  render() {
    const wrap = document.createElement("div");

    /* 파일 메타 정보 영역 — _updateTrackMeta()가 내용을 채웁니다 */
    const meta = document.createElement("div");
    meta.className = "media-meta";
    this._metaEl = meta;
    this._updateTrackMeta();

    wrap.appendChild(meta);
    wrap.appendChild(this.playerEl);
    return wrap;
  }

  /* ═══════════════════════════════════════════════════════════════
     플레이리스트 내부 유틸
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _addTrack(file)
     파일 1개를 플레이리스트에 추가합니다.
     Blob URL을 생성하고 배열에 저장합니다.
     @param {File} file — 추가할 동영상 File 객체
  ───────────────────────────────────────────────────────────────── */
  _addTrack(file) {
    this.playlist.push({
      file,
      url: URL.createObjectURL(file) /* 메모리 참조 URL 생성 */,
      name: file.name,
      size: file.size,
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     _removeTrack(idx)
     플레이리스트에서 idx 번째 항목을 제거합니다.
     현재 재생 중인 트랙을 삭제하면 다음(또는 이전) 트랙으로 이동합니다.
     Blob URL을 해제해 메모리 누수를 방지합니다.
     @param {number} idx — 제거할 트랙 인덱스
  ───────────────────────────────────────────────────────────────── */
  _removeTrack(idx) {
    /* Blob URL 메모리 해제 */
    URL.revokeObjectURL(this.playlist[idx].url);
    this.playlist.splice(idx, 1);

    if (this.playlist.length === 0) {
      /* 모든 트랙 삭제 → 영상 정지 후 src 초기화 */
      this.videoEl.pause();
      this.videoEl.removeAttribute("src");
      this.videoEl.load();
      this._renderPlaylistView();
      this._updateTrackMeta();
      this._updateInfoPanel();
      return;
    }

    /* 인덱스 보정: 배열 끝을 벗어나지 않도록 */
    if (this.currentIdx >= this.playlist.length) {
      this.currentIdx = this.playlist.length - 1;
    }
    this._playTrack(this.currentIdx);
  }

  /* ─────────────────────────────────────────────────────────────────
     _playTrack(idx)
     idx 번째 트랙을 처음부터 재생합니다.
     @param {number} idx — 재생할 트랙 인덱스
  ───────────────────────────────────────────────────────────────── */
  _playTrack(idx) {
    if (idx < 0 || idx >= this.playlist.length) return;

    this.currentIdx = idx;
    this.videoEl.src = this.playlist[idx].url;
    this.videoEl.currentTime = 0;
    this.videoEl.play().catch(() => {}); /* 자동재생 정책 예외 무시 */

    this._updateTrackNameBar();
    this._updateTrackMeta();
    this._renderPlaylistView();
    this._updateInfoPanel();
  }

  /* ─────────────────────────────────────────────────────────────────
     _playNext()
     반복 모드(repeatMode)에 따라 다음 트랙으로 이동합니다.
     영상 종료(ended) 이벤트에서 호출됩니다.
  ───────────────────────────────────────────────────────────────── */
  _playNext() {
    const n = this.playlist.length;
    if (n === 0) return;

    let next = this.currentIdx + 1;

    if (this.repeatMode === "all") {
      /* 전체 반복: 마지막 이후 → 처음 트랙으로 순환 */
      next = next % n;
    } else if (next >= n) {
      /* 반복 없음: 마지막 트랙이면 정지 상태로 전환 */
      this.videoEl.pause();
      if (this.playBtn) this.playBtn.textContent = "▶";
      return;
    }
    this._playTrack(next);
  }

  /* ─────────────────────────────────────────────────────────────────
     _onEnded()
     영상 1개가 자연 종료됐을 때 repeatMode에 따라 분기합니다.
  ───────────────────────────────────────────────────────────────── */
  _onEnded() {
    if (this.repeatMode === "one") {
      /* 1개 반복: 같은 트랙을 처음부터 다시 재생 */
      this.videoEl.currentTime = 0;
      this.videoEl.play().catch(() => {});
    } else {
      this._playNext();
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _updateTrackMeta()
     render()가 반환한 meta 영역의 파일 정보 텍스트를 갱신합니다.
  ───────────────────────────────────────────────────────────────── */
  _updateTrackMeta() {
    if (!this._metaEl) return;
    const t = this.playlist[this.currentIdx];
    if (!t) {
      this._metaEl.innerHTML = "";
      return;
    }
    /* innerHTML 사용: 정적 포맷 문자열이므로 XSS 위험 없음
       파일명은 아래에서 textContent로 별도 처리 */
    this._metaEl.innerHTML =
      `<span></span>` +
      `<span>SIZE: ${(t.size / 1024 / 1024).toFixed(2)} MB</span>` +
      `<span>트랙: ${this.currentIdx + 1} / ${this.playlist.length}</span>`;
    /* 파일명은 XSS 방지를 위해 textContent 사용 */
    this._metaEl.querySelector("span").textContent = `FILE: ${t.name}`;
  }

  /* ─────────────────────────────────────────────────────────────────
     _updateTrackNameBar()
     컨트롤 바 위의 트랙명 표시 바를 현재 트랙으로 갱신합니다.
  ───────────────────────────────────────────────────────────────── */
  _updateTrackNameBar() {
    if (!this.trackNameEl) return;
    const t = this.playlist[this.currentIdx];
    if (!t) {
      this.trackNameEl.querySelector(".vp-track-label").textContent = "—";
      return;
    }
    /* 파일명: textContent로 설정 (XSS 방지) */
    this.trackNameEl.querySelector(".vp-track-label").textContent = t.name;
    this.trackNameEl.querySelector(".vp-track-idx").textContent =
      `${this.currentIdx + 1}/${this.playlist.length}`;
  }

  /* ═══════════════════════════════════════════════════════════════
     DOM 빌더 — 플레이어 전체 구조 생성
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _buildPlayer()
     플레이어 전체 DOM 트리를 생성해 반환합니다.

     구조:
       .player
         .vp-stage                     ← 비디오 + FAKE 오버레이 + 옵션 패널
           video
           .vp-fake-overlay            ← FAKE 이미지 가리개 (기본 숨김)
           .vp-panel                   ← 옵션 패널 (기본 숨김)
         .progress-wrap > .progress-fill
         .vp-track-name
         .controls                     ← 컨트롤 바
         .vp-playlist                  ← 인라인 플레이리스트
         .vp-drop-overlay              ← 드래그앤드롭 힌트
  ───────────────────────────────────────────────────────────────── */
  _buildPlayer() {
    const player = document.createElement("div");
    player.className = "player";
    player.style.position = "relative"; /* 드롭 오버레이의 absolute 기준점 */

    /* ── 비디오 + 패널을 함께 담는 무대(stage) ── */
    const stage = document.createElement("div");
    stage.className = "vp-stage";

    /* ── <video> 요소 ── */
    this.videoEl = document.createElement("video");
    this.videoEl.src = this.playlist[0].url;
    this.videoEl.preload = "metadata";
    /* playsinline: iOS 등 모바일에서 인라인 재생 강제 */
    this.videoEl.setAttribute("playsinline", "");
    this.videoEl.style.cssText =
      "width:100%;max-height:220px;background:#000;display:block;cursor:pointer;";

    /* 화면 클릭 → 재생/일시정지 토글 */
    this.videoEl.addEventListener("click", () => this._togglePlay());

    /* 터치 디바이스 명시 처리 (touchend + preventDefault로 이중 발화 방지) */
    this.videoEl.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        this._togglePlay();
      },
      { passive: false },
    );

    stage.appendChild(this.videoEl);

    /* ── FAKE 이미지 오버레이 ──────────────────────────────────────
       isFakeOn=true 이고 영상이 일시정지 상태일 때 표시됩니다.
       imgs/fake.png 이미지로 화면을 완전히 가립니다.
    ────────────────────────────────────────────────────────────── */
    this.fakeOverlayEl = document.createElement("div");
    this.fakeOverlayEl.className = "vp-fake-overlay";

    /* fake.png 이미지 요소 */
    const fakeImg = document.createElement("img");
    fakeImg.src = "imgs/fake.png";
    fakeImg.alt = "작업 화면";
    fakeImg.style.cssText =
      "width:100%;height:100%;object-fit:cover;display:block;";
    this.fakeOverlayEl.appendChild(fakeImg);

    /* FAKE 오버레이도 클릭 시 재생 토글 (화면을 가려도 조작 가능) */
    this.fakeOverlayEl.addEventListener("click", () => this._togglePlay());
    stage.appendChild(this.fakeOverlayEl);

    /* ── 옵션 패널 (정보 / 추가 탭) ── */
    this.panelEl = this._buildOptionPanel();
    stage.appendChild(this.panelEl);

    player.appendChild(stage);

    /* ── 진행 바 ── */
    const prog = document.createElement("div");
    prog.className = "progress-wrap";
    this.fillEl = document.createElement("div");
    this.fillEl.className = "progress-fill";
    this.fillEl.style.width = "0%";
    prog.appendChild(this.fillEl);
    /* 진행바 클릭 → 해당 시간으로 이동 */
    prog.addEventListener("click", (e) => {
      if (!this.videoEl.duration) return;
      const r = prog.getBoundingClientRect();
      this.videoEl.currentTime =
        ((e.clientX - r.left) / r.width) * this.videoEl.duration;
    });
    player.appendChild(prog);

    /* ── 트랙명 표시 바 ── */
    this.trackNameEl = this._buildTrackNameBar();
    player.appendChild(this.trackNameEl);

    /* ── 컨트롤 바 ── */
    player.appendChild(this._buildControls());

    /* ── 플레이리스트 뷰 ── */
    this.playlistEl = document.createElement("div");
    this.playlistEl.className = "vp-playlist";
    player.appendChild(this.playlistEl);
    this._renderPlaylistView();

    /* ── 드래그앤드롭 오버레이 (플레이어 전체 영역) ── */
    player.appendChild(this._buildDropOverlay(player));

    /* ── 확대 모드 탈출 버튼 (browser/monitor 모드에서 우상단에 표시) ── */
    this.exitBtn = document.createElement("button");
    this.exitBtn.className = "vp-exit-btn";
    this.exitBtn.textContent = "✕ 기본 크기로";
    this.exitBtn.title = "기본 크기로 돌아갑니다";
    this.exitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._applySizeMode("normal");
    });
    player.appendChild(this.exitBtn);

    /* ── 비디오 이벤트 연결 ── */
    this._bindVideoEvents();

    return player;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildTrackNameBar()
     현재 재생 중인 파일명 + 트랙 번호를 표시하는 얇은 바를 생성합니다.
     @returns {HTMLElement} .vp-track-name div
  ───────────────────────────────────────────────────────────────── */
  _buildTrackNameBar() {
    const bar = document.createElement("div");
    bar.className = "vp-track-name";

    const icon = document.createElement("span");
    icon.className = "vp-track-icon";
    icon.textContent = "▶";

    const label = document.createElement("span");
    label.className = "vp-track-label";
    /* 파일명: textContent로 설정해 XSS 방지 */
    label.textContent = this.playlist[0]?.name ?? "—";

    const idx = document.createElement("span");
    idx.className = "vp-track-idx";
    idx.textContent = `1/${this.playlist.length}`;

    bar.appendChild(icon);
    bar.appendChild(label);
    bar.appendChild(idx);
    return bar;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildControls()
     컨트롤 바 DOM을 생성합니다. (v3.0)

     버튼 순서:
       ▶(재생/정지) | 시간표시 | [여백] | 🔊 볼륨 | ⟲(반복) | ⤡(창크기) | 🎭(FAKE) | 📷(스크린샷) | ⚙(옵션)

     v3.0 변경:
       - 창크기 버튼(.vp-size-btn) 추가: 클릭 시 3단계 슬라이딩 메뉴
       - FAKE 버튼(.vp-fake-btn) 추가: 위장 화면 토글
       - 이전 전체화면 버튼(⛶/⊞) 제거 → 창크기 버튼으로 통합
     @returns {HTMLElement} .controls div
  ───────────────────────────────────────────────────────────────── */
  _buildControls() {
    const ctrl = document.createElement("div");
    ctrl.className = "controls";

    /* ── 재생/일시정지 버튼 ── */
    this.playBtn = makeBtn("▶", () => this._togglePlay());
    this.playBtn.title = "재생/일시정지 (화면 클릭도 가능)";

    /* ── 시간 표시 ── */
    this.timeDisp = document.createElement("span");
    this.timeDisp.className = "time-disp";
    this.timeDisp.textContent = "00:00 / 00:00";

    /* ── 탄성 여백: 우측 그룹을 오른쪽 끝으로 밀어냄 ── */
    const sf = document.createElement("div");
    sf.className = "spacer-flex";

    /* ── 음소거 토글 버튼 ── */
    this.muteBtn = makeBtn("🔊", () => {
      this.videoEl.muted = !this.videoEl.muted;
      this.muteBtn.textContent = this.videoEl.muted ? "🔇" : "🔊";
    });
    this.muteBtn.title = "음소거 토글";

    /* ── 볼륨 슬라이더 ── */
    const volRange = makeRange(1, (v) => {
      this.videoEl.volume = v;
    });
    volRange.title = "볼륨 조절";

    /* ── 반복 모드 버튼 (3단계 순환: none → one → all) ── */
    this.repeatBtn = this._buildRepeatBtn();

    /* ── 창크기 조절 버튼 + 슬라이딩 메뉴 래퍼 ────────────────────
       버튼 클릭 → 3단계 옵션이 슬라이딩으로 나타남
       옵션 선택 또는 외부 클릭 시 메뉴 닫힘
    ────────────────────────────────────────────────────────────── */
    const sizeWrap = this._buildSizeMenu();

    /* ── FAKE 버튼 ────────────────────────────────────────────────
       활성화(ON): 영상 일시정지 시 imgs/fake.png 이미지로 화면 가림
       비활성화(OFF): 아무런 동작 없음
    ────────────────────────────────────────────────────────────── */
    this.fakeBtn = document.createElement("button");
    this.fakeBtn.className = "ctrl-btn vp-fake-btn";
    this.fakeBtn.textContent = "🎭";
    this.fakeBtn.title = "FAKE OFF — 클릭하면 정지 시 위장 화면을 표시합니다";
    this.fakeBtn.addEventListener("click", () => this._toggleFake());

    /* ── 스크린샷 버튼 ── */
    this.shotBtn = document.createElement("button");
    this.shotBtn.className = "ctrl-btn vp-shot-btn";
    this.shotBtn.textContent = "📷";
    this.shotBtn.title = "현재 화면 스크린샷 — 일시정지 후 PNG로 저장합니다";
    this.shotBtn.addEventListener("click", () => this._takeScreenshot());

    /* ── 옵션 패널 토글 버튼 ── */
    this.optBtn = document.createElement("button");
    this.optBtn.className = "ctrl-btn vp-opt-btn";
    this.optBtn.textContent = "⚙";
    this.optBtn.title = "옵션 — 동영상 정보와 추가 패널을 토글합니다";
    this.optBtn.addEventListener("click", () => this._toggleOptionPanel());

    /* 모든 버튼을 순서대로 컨트롤 바에 추가 */
    [
      this.playBtn,
      this.timeDisp,
      sf,
      this.muteBtn,
      volRange,
      this.repeatBtn,
      sizeWrap /* 창크기 버튼 + 슬라이딩 메뉴 래퍼 */,
      this.fakeBtn,
      this.shotBtn,
      this.optBtn,
    ].forEach((n) => ctrl.appendChild(n));

    return ctrl;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildSizeMenu()
     창크기 조절 버튼 + 3단계 슬라이딩 옵션 메뉴를 생성합니다.

     메뉴 구성 (클릭 시 슬라이딩 등장):
       [■ 기본]  : 터미널 출력창 크기 (max-width 제약 내 기본)
       [⬜ 앱]   : 브라우저 창 전체 (CSS position:fixed)
       [⛶ 모니터]: 컴퓨터 모니터 전체화면 (Fullscreen API)

     현재 활성 모드는 버튼에 .active 클래스로 표시합니다.
     @returns {HTMLElement} .vp-size-wrap div (버튼 + 슬라이딩 메뉴 포함)
  ───────────────────────────────────────────────────────────────── */
  _buildSizeMenu() {
    /* 창크기 래퍼: 버튼과 팝업 메뉴를 함께 담는 relative 컨테이너 */
    const wrap = document.createElement("div");
    wrap.className = "vp-size-wrap";

    /* 창크기 토글 버튼 */
    this.sizeBtn = document.createElement("button");
    this.sizeBtn.className = "ctrl-btn vp-size-btn";
    this.sizeBtn.textContent = "⤡";
    this.sizeBtn.title = "창크기 조절";
    this.sizeBtn.addEventListener("click", (e) => {
      e.stopPropagation(); /* 외부 클릭 감지 이벤트와 충돌 방지 */
      this._toggleSizeMenu();
    });
    wrap.appendChild(this.sizeBtn);

    /* 3단계 슬라이딩 메뉴 컨테이너 */
    const menu = document.createElement("div");
    menu.className = "vp-size-menu";
    this.sizMenuEl = menu;

    /* 3단계 옵션 정의 */
    const SIZE_OPTIONS = [
      {
        key: "normal",
        icon: "▣",
        label: "기본 크기",
        title: "터미널 출력창에 맞는 기본 크기로 표시합니다",
      },
      {
        key: "browser",
        icon: "⬜",
        label: "브라우저 전체",
        title: "브라우저 창 전체를 채우도록 확대합니다 (CSS 전체화면)",
      },
      {
        key: "monitor",
        icon: "⛶",
        label: "모니터 전체",
        title: "컴퓨터 모니터 전체화면으로 전환합니다 (OS 전체화면)",
      },
    ];

    SIZE_OPTIONS.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className =
        "vp-size-option" + (this.sizeMode === opt.key ? " active" : "");
      btn.dataset.sizeKey = opt.key;
      btn.title = opt.title;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._applySizeMode(opt.key);
        this._closeSizeMenu();
      });

      /* 아이콘 */
      const icon = document.createElement("span");
      icon.className = "vp-size-icon";
      icon.textContent = opt.icon;

      /* 레이블 */
      const lbl = document.createElement("span");
      lbl.className = "vp-size-label";
      lbl.textContent = opt.label;

      btn.appendChild(icon);
      btn.appendChild(lbl);
      menu.appendChild(btn);
    });
    this._sizeOptions = menu.querySelectorAll(".vp-size-option");

    wrap.appendChild(menu);

    /* ── 외부 클릭 시 메뉴 자동 닫힘 ──────────────────────────
       document 레벨에서 클릭 이벤트를 감지합니다.
       메뉴 내부 클릭은 위의 stopPropagation으로 걸러집니다.
    ────────────────────────────────────────────────────────────── */
    this._sizeMenuOutsideClick = (e) => {
      if (!wrap.contains(e.target)) {
        this._closeSizeMenu();
      }
    };

    return wrap;
  }

  /* ─────────────────────────────────────────────────────────────────
     _toggleSizeMenu()
     창크기 슬라이딩 메뉴를 열거나 닫습니다.
  ───────────────────────────────────────────────────────────────── */
  _toggleSizeMenu() {
    this.isSizeMenuOpen = !this.isSizeMenuOpen;
    this.sizMenuEl.classList.toggle("open", this.isSizeMenuOpen);
    this.sizeBtn.classList.toggle("active", this.isSizeMenuOpen);

    if (this.isSizeMenuOpen) {
      /* 메뉴 열림: 외부 클릭 감지 리스너 등록 */
      document.addEventListener("click", this._sizeMenuOutsideClick);
    } else {
      /* 메뉴 닫힘: 리스너 해제 */
      document.removeEventListener("click", this._sizeMenuOutsideClick);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _closeSizeMenu()
     창크기 슬라이딩 메뉴를 강제로 닫습니다.
  ───────────────────────────────────────────────────────────────── */
  _closeSizeMenu() {
    this.isSizeMenuOpen = false;
    this.sizMenuEl.classList.remove("open");
    this.sizeBtn.classList.remove("active");
    document.removeEventListener("click", this._sizeMenuOutsideClick);
  }

  /* ─────────────────────────────────────────────────────────────────
     _applySizeMode(mode)
     창크기 모드를 적용합니다.

     'normal'  : CSS 전체화면 해제 + Fullscreen API 해제 (기본 크기로 복원)
     'browser' : CSS position:fixed으로 브라우저 창 전체 점유
                 (.vp-browser-fs 클래스 토글)
     'monitor' : Fullscreen API (requestFullscreen) 호출

     @param {string} mode — 'normal' | 'browser' | 'monitor'
  ───────────────────────────────────────────────────────────────── */
  _applySizeMode(mode) {
    const prev = this.sizeMode;
    this.sizeMode = mode;

    /* ── 이전 모드 해제 ── */
    if (prev === "browser") {
      /* CSS 전체화면 클래스 제거 */
      this.playerEl.classList.remove("vp-browser-fs");
      document.body.style.overflow = "";
    }
    if (prev === "monitor" && document.fullscreenElement) {
      /* Fullscreen API 해제 */
      document.exitFullscreen().catch(() => {});
    }

    /* ── 새 모드 적용 ── */
    if (mode === "browser") {
      /* CSS position:fixed로 브라우저 창 전체 점유 */
      this.playerEl.classList.add("vp-browser-fs");
      document.body.style.overflow = "hidden"; /* 스크롤 방지 */
    } else if (mode === "monitor") {
      /* Fullscreen API: 플레이어 요소를 모니터 전체화면으로 */
      this.playerEl.requestFullscreen().catch((err) => {
        /* iframe 환경 등에서 차단될 수 있으므로 콘솔 경고로 처리 */
        console.warn("[VideoPlayer] Fullscreen API 오류:", err.message);
        /* 실패 시 browser 모드로 폴백 */
        this.sizeMode = "browser";
        this.playerEl.classList.add("vp-browser-fs");
        document.body.style.overflow = "hidden";
      });
    }

    /* ── 메뉴 옵션 버튼 active 상태 동기화 ── */
    this._sizeOptions.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sizeKey === this.sizeMode);
    });

    /* ── 버튼 아이콘 동기화 ── */
    const icons = { normal: "⤡", browser: "⬜", monitor: "⛶" };
    if (this.sizeBtn) this.sizeBtn.textContent = icons[this.sizeMode] ?? "⤡";
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildRepeatBtn()
     반복 모드 순환 버튼을 생성합니다.
     클릭 시: none → one → all → none 순환
     @returns {HTMLButtonElement} .vp-repeat-btn
  ───────────────────────────────────────────────────────────────── */
  _buildRepeatBtn() {
    const btn = document.createElement("button");
    btn.className = "ctrl-btn vp-repeat-btn";
    btn.title = "반복 없음 — 클릭하면 1개 반복으로 바뀝니다";

    /* 아이콘 span */
    const icon = document.createElement("span");
    icon.className = "vp-rep-icon";
    icon.textContent = "⟲";

    /* 상태 레이블 span */
    const label = document.createElement("span");
    label.className = "vp-rep-label";
    label.textContent = "OFF"; /* 초기: 반복 없음 */

    btn.appendChild(icon);
    btn.appendChild(label);
    btn.addEventListener("click", () => this._cycleRepeat());
    return btn;
  }

  /* ═══════════════════════════════════════════════════════════════
     FAKE 버튼 기능
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _toggleFake()
     FAKE 기능을 ON/OFF 토글합니다.

     ON 상태:
       - 영상이 현재 일시정지 중이면 즉시 fake.png 오버레이 표시
       - 재생 시 오버레이 자동 숨김 (play 이벤트에서 처리)
       - 일시정지 시 오버레이 자동 표시 (pause 이벤트에서 처리)
     OFF 상태:
       - fake.png 오버레이를 즉시 숨김
  ───────────────────────────────────────────────────────────────── */
  _toggleFake() {
    this.isFakeOn = !this.isFakeOn;

    /* 버튼 시각 상태 업데이트 */
    this.fakeBtn.classList.toggle("fake-on", this.isFakeOn);
    this.fakeBtn.title = this.isFakeOn
      ? "FAKE ON — 정지 시 위장 화면 표시 중. 클릭하면 끕니다"
      : "FAKE OFF — 클릭하면 정지 시 위장 화면을 표시합니다";

    /* 현재 재생 상태에 따라 오버레이 즉시 동기화 */
    this._syncFakeOverlay();
  }

  /* ─────────────────────────────────────────────────────────────────
     _syncFakeOverlay()
     현재 isFakeOn 상태와 영상 재생/정지 상태를 읽어
     FAKE 오버레이의 표시/숨김을 결정합니다.

     표시 조건: isFakeOn === true AND 영상이 일시정지(paused) 중
     숨김 조건: 위 조건이 아닌 모든 경우

     이 함수는 다음 시점에 호출됩니다:
       - _toggleFake() (FAKE 버튼 클릭)
       - play 이벤트 (영상 재생 시작)
       - pause 이벤트 (영상 일시정지)
       - ended 이벤트 (영상 종료)
  ───────────────────────────────────────────────────────────────── */
  _syncFakeOverlay() {
    if (!this.fakeOverlayEl) return;

    const shouldShow = this.isFakeOn && this.videoEl.paused;
    this.fakeOverlayEl.classList.toggle("show", shouldShow);
  }

  /* ═══════════════════════════════════════════════════════════════
     옵션 패널 (정보 / 추가 탭)
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _buildOptionPanel()
     비디오 영역 위에 떠 있는 옵션 패널을 생성합니다.

     구조:
       .vp-panel
         .vp-panel-tabs (동영상 정보 | 동영상 추가)
         .vp-tab-pane.info   — 파일명/형식/용량/해상도/재생시간
         .vp-tab-pane.add    — 드래그 또는 클릭으로 파일 추가
         .vp-panel-close     — 닫기 버튼
     @returns {HTMLElement} .vp-panel div
  ───────────────────────────────────────────────────────────────── */
  _buildOptionPanel() {
    const panel = document.createElement("div");
    panel.className = "vp-panel";

    /* 패널 클릭이 비디오 재생/정지로 전파되지 않도록 차단 */
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.addEventListener("touchend", (e) => e.stopPropagation(), {
      passive: true,
    });

    /* ── 탭 헤더 ── */
    const tabs = document.createElement("div");
    tabs.className = "vp-panel-tabs";

    /* 동영상 정보 탭 버튼 */
    this.tabInfoBtn = document.createElement("button");
    this.tabInfoBtn.className = "vp-panel-tab active"; /* 기본 활성 */
    this.tabInfoBtn.dataset.tab = "info";
    this.tabInfoBtn.textContent = "동영상 정보";
    this.tabInfoBtn.addEventListener("click", () => this._switchTab("info"));

    /* 동영상 추가 탭 버튼 */
    this.tabAddBtn = document.createElement("button");
    this.tabAddBtn.className = "vp-panel-tab";
    this.tabAddBtn.dataset.tab = "add";
    this.tabAddBtn.textContent = "동영상 추가";
    this.tabAddBtn.addEventListener("click", () => this._switchTab("add"));

    tabs.appendChild(this.tabInfoBtn);
    tabs.appendChild(this.tabAddBtn);
    panel.appendChild(tabs);

    /* ── 탭 1: 동영상 정보 ── */
    this.tabInfoPane = document.createElement("div");
    this.tabInfoPane.className = "vp-tab-pane info active";
    this.tabInfoPane.appendChild(this._buildInfoGrid());
    panel.appendChild(this.tabInfoPane);

    /* ── 탭 2: 동영상 추가 ── */
    this.tabAddPane = document.createElement("div");
    this.tabAddPane.className = "vp-tab-pane add";
    this.tabAddPane.appendChild(this._buildAddZone());
    panel.appendChild(this.tabAddPane);

    /* ── 닫기 버튼 ── */
    const closeBtn = document.createElement("button");
    closeBtn.className = "vp-panel-close";
    closeBtn.textContent = "✕ 닫기";
    closeBtn.title = "옵션 패널 닫기";
    closeBtn.addEventListener("click", () => this._toggleOptionPanel(false));
    panel.appendChild(closeBtn);

    return panel;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildInfoGrid()
     동영상 정보 탭의 내용을 생성합니다.
     FILE / TYPE / SIZE / W×H / 재생시간 행으로 구성됩니다.
     @returns {HTMLElement} .vp-info-grid div
  ───────────────────────────────────────────────────────────────── */
  _buildInfoGrid() {
    const grid = document.createElement("div");
    grid.className = "vp-info-grid";

    /* 정보 필드 정의 (key: _infoValEls 에서 참조, label: 표시명) */
    const fields = [
      ["name", "FILE"],
      ["type", "TYPE"],
      ["size", "SIZE"],
      ["dims", "W × H"],
      ["dur", "재생시간"],
    ];
    this._infoValEls =
      {}; /* 나중에 _updateInfoPanel()에서 값을 갱신하기 위해 참조 보관 */

    fields.forEach(([key, label]) => {
      const row = document.createElement("div");
      row.className = "vp-info-row";

      const lab = document.createElement("span");
      lab.className = "vp-info-label";
      lab.textContent = label;

      const val = document.createElement("span");
      val.className = "vp-info-value";
      val.textContent = "—"; /* 초기값 */

      row.appendChild(lab);
      row.appendChild(val);
      grid.appendChild(row);

      this._infoValEls[key] = val; /* 참조 저장 */
    });

    return grid;
  }

  /* ─────────────────────────────────────────────────────────────────
     _updateInfoPanel()
     현재 재생 중인 트랙의 정보를 동영상 정보 패널에 반영합니다.
     - 실제 해상도는 video.videoWidth / video.videoHeight로 가져옵니다
     - 메타데이터 로드 전이면 '로딩 중…'으로 표시합니다
  ───────────────────────────────────────────────────────────────── */
  _updateInfoPanel() {
    if (!this._infoValEls) return;
    const t = this.playlist[this.currentIdx];
    const els = this._infoValEls;

    if (!t) {
      /* 트랙이 없으면 모든 필드를 '—'으로 초기화 */
      Object.values(els).forEach((el) => (el.textContent = "—"));
      return;
    }

    /* textContent로 설정 (XSS 방지) */
    els.name.textContent = t.name;
    els.type.textContent = t.file.type || "unknown";
    els.size.textContent = `${(t.size / 1024 / 1024).toFixed(2)} MB  (${t.size.toLocaleString()} bytes)`;

    const v = this.videoEl;
    /* readyState >= 1 (HAVE_METADATA) 이후에야 videoWidth 사용 가능 */
    if (v && v.videoWidth) {
      els.dims.textContent = `${v.videoWidth} × ${v.videoHeight} px`;
    } else {
      els.dims.textContent = "메타데이터 로딩 중…";
    }
    if (v && isFinite(v.duration)) {
      els.dur.textContent = fmtTime(v.duration);
    } else {
      els.dur.textContent = "—";
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildAddZone()
     동영상 추가 탭의 드롭존 + 안내 메시지를 생성합니다.
     클릭 또는 드래그앤드롭으로 파일을 추가할 수 있습니다.
     @returns {HTMLElement} .vp-add-wrap div
  ───────────────────────────────────────────────────────────────── */
  _buildAddZone() {
    const wrap = document.createElement("div");
    wrap.className = "vp-add-wrap";

    /* 드롭존 */
    const zone = document.createElement("div");
    zone.className = "vp-drop-zone";
    zone.innerHTML =
      '<span class="vp-dz-icon">🎬</span>' +
      '<span class="vp-dz-title">동영상 파일을 드래그하거나 클릭하세요</span>' +
      '<span class="vp-dz-sub">video/* (mp4, webm, mov 등)</span>';

    /* 숨겨진 파일 input — zone 클릭 시 트리거 */
    const fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.accept = "video/*";
    fileIn.multiple = true;
    fileIn.style.display = "none";
    fileIn.addEventListener("change", () => {
      const files = [...fileIn.files].filter((f) =>
        f.type.startsWith("video/"),
      );
      this._appendFiles(files);
      fileIn.value = ""; /* 같은 파일 재선택 허용을 위해 초기화 */
    });

    zone.addEventListener("click", () => fileIn.click());

    /* 드래그 이벤트: 패널 내부 드롭존 전용 */
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if ([...e.dataTransfer.items].some((i) => i.type.startsWith("video/"))) {
        zone.classList.add("drag-over");
      }
    });
    zone.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove("drag-over");
      const files = [...e.dataTransfer.files].filter((f) =>
        f.type.startsWith("video/"),
      );
      this._appendFiles(files);
    });

    /* 안내 메시지 영역 */
    this._addMsgEl = document.createElement("div");
    this._addMsgEl.className = "vp-add-msg";
    this._addMsgEl.textContent = "";

    wrap.appendChild(zone);
    wrap.appendChild(fileIn);
    wrap.appendChild(this._addMsgEl);
    return wrap;
  }

  /* ─────────────────────────────────────────────────────────────────
     _appendFiles(files)
     동영상 파일 배열을 플레이리스트에 추가하고 UI를 갱신합니다.
     @param {File[]} files — 추가할 동영상 파일 배열
  ───────────────────────────────────────────────────────────────── */
  _appendFiles(files) {
    if (!files || files.length === 0) {
      if (this._addMsgEl)
        this._addMsgEl.textContent = "동영상 파일만 추가할 수 있습니다.";
      return;
    }
    files.forEach((f) => this._addTrack(f));
    this._renderPlaylistView();
    this._updateTrackMeta();
    if (this._addMsgEl) {
      this._addMsgEl.textContent = `${files.length}개 파일을 플레이리스트에 추가했습니다.`;
      /* 2초 후 안내 메시지 자동 제거 */
      setTimeout(() => {
        if (this._addMsgEl) this._addMsgEl.textContent = "";
      }, 2000);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _switchTab(tabName)
     옵션 패널 내 탭을 전환합니다.
     @param {'info'|'add'} tabName — 전환할 탭 키
  ───────────────────────────────────────────────────────────────── */
  _switchTab(tabName) {
    this.activeTab = tabName;

    /* 탭 버튼 active 클래스 토글 */
    this.tabInfoBtn.classList.toggle("active", tabName === "info");
    this.tabAddBtn.classList.toggle("active", tabName === "add");

    /* 탭 콘텐츠 active 클래스 토글 */
    this.tabInfoPane.classList.toggle("active", tabName === "info");
    this.tabAddPane.classList.toggle("active", tabName === "add");
  }

  /* ─────────────────────────────────────────────────────────────────
     _toggleOptionPanel(force)
     옵션 패널을 열거나 닫습니다.
     @param {boolean=} force — true/false 강제 지정, 미지정 시 토글
  ───────────────────────────────────────────────────────────────── */
  _toggleOptionPanel(force) {
    this.isPanelOpen = typeof force === "boolean" ? force : !this.isPanelOpen;
    this.panelEl.classList.toggle("open", this.isPanelOpen);
    this.optBtn.classList.toggle("active", this.isPanelOpen);

    /* 패널 열 때 최신 정보로 갱신 */
    if (this.isPanelOpen) {
      this._switchTab("info"); /* 항상 정보 탭부터 표시 */
      this._updateInfoPanel();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     스크린샷 캡처
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _takeScreenshot()
     현재 비디오 프레임을 PNG로 캡처해 터미널에 다운로드 링크를 표시합니다.

     동작 순서:
       1) 영상이 재생 중이면 일시정지
       2) <canvas>에 현재 프레임 그리기 (실제 해상도 기준)
       3) toBlob → Blob URL 생성 → 다운로드 가능한 a 태그 생성
       4) 터미널 출력 영역에 썸네일 + 다운로드 버튼 표시
  ───────────────────────────────────────────────────────────────── */
  _takeScreenshot() {
    const v = this.videoEl;
    if (!v || !v.videoWidth) {
      if (typeof appendText === "function") {
        appendText(
          "스크린샷 실패: 영상이 아직 준비되지 않았습니다.",
          "c-red",
          true,
        );
      }
      return;
    }

    /* 1) 영상 일시정지 */
    if (!v.paused) v.pause();

    /* 2) 오프스크린 캔버스에 현재 프레임 그리기 */
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    try {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      /* CORS 보호 영상에서 SecurityError 발생 가능 */
      if (typeof appendText === "function") {
        appendText(
          "스크린샷 실패: 보안 정책으로 캡처할 수 없습니다.",
          "c-red",
          true,
        );
      }
      console.warn("[VideoPlayer] screenshot error:", err.message);
      return;
    }

    /* 3) Blob 생성 후 다운로드 링크 발행 */
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const t = this.playlist[this.currentIdx];
      const baseName = (t?.name || "screenshot").replace(/\.[^.]+$/, "");
      const ts = new Date();
      const stamp =
        ts.getFullYear().toString() +
        String(ts.getMonth() + 1).padStart(2, "0") +
        String(ts.getDate()).padStart(2, "0") +
        "_" +
        String(ts.getHours()).padStart(2, "0") +
        String(ts.getMinutes()).padStart(2, "0") +
        String(ts.getSeconds()).padStart(2, "0");
      const filename = `${baseName}_${stamp}.png`;

      /* 4) 터미널 출력 */
      this._emitScreenshotLink(
        url,
        filename,
        canvas.width,
        canvas.height,
        blob.size,
      );
    }, "image/png");
  }

  /* ─────────────────────────────────────────────────────────────────
     _emitScreenshotLink(url, filename, w, h, size)
     스크린샷 다운로드 링크를 터미널에 표시합니다.
     @param {string} url      — Blob URL
     @param {string} filename — 저장 파일명
     @param {number} w, h     — 이미지 해상도
     @param {number} size     — Blob 바이트 크기
  ───────────────────────────────────────────────────────────────── */
  _emitScreenshotLink(url, filename, w, h, size) {
    if (typeof appendText === "function") {
      appendText(`guest@system:~$ screenshot ${filename}`, "c-green", true);
    }

    /* 썸네일 + 다운로드 버튼 박스 */
    const box = document.createElement("div");
    box.className = "vp-shot-out";

    /* 썸네일 이미지 */
    const thumb = document.createElement("img");
    thumb.src = url;
    thumb.alt = filename;
    thumb.className = "vp-shot-thumb";

    /* 정보 + 다운로드 버튼 영역 */
    const info = document.createElement("div");
    info.className = "vp-shot-info";

    const msg = document.createElement("div");
    msg.className = "vp-shot-msg";
    msg.textContent = "스크린샷을 다운로드 하세요";

    const meta = document.createElement("div");
    meta.className = "vp-shot-meta";
    /* textContent로 설정 (파일명에 특수문자 포함 가능) */
    meta.textContent = `FILE: ${filename}  |  ${w} × ${h} px  |  ${(size / 1024).toFixed(1)} KB`;

    /* 다운로드 a 태그 (클릭 시 즉시 다운로드) */
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.className = "vp-shot-btn-dl";
    a.textContent = "⬇ 스크린샷 다운로드";
    /* 다운로드 후 30초 뒤 Blob URL 해제 (메모리 절약) */
    a.addEventListener("click", () => {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });

    info.appendChild(msg);
    info.appendChild(meta);
    info.appendChild(a);

    box.appendChild(thumb);
    box.appendChild(info);

    if (typeof appendNode === "function") {
      appendNode(box, false);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     플레이리스트 뷰
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _renderPlaylistView()
     .vp-playlist 내의 트랙 목록을 현재 playlist 배열 기준으로 다시 그립니다.
     트랙이 1개 이하이면 목록을 숨깁니다.
  ───────────────────────────────────────────────────────────────── */
  _renderPlaylistView() {
    if (!this.playlistEl) return;
    this.playlistEl.innerHTML = "";

    /* 트랙이 1개 이하이면 목록 표시 불필요 */
    if (this.playlist.length <= 1) return;

    this.playlist.forEach((t, i) => {
      const item = document.createElement("div");
      item.className = "vp-pl-item" + (i === this.currentIdx ? " playing" : "");

      /* 재생 중 아이콘 */
      const icon = document.createElement("span");
      icon.className = "vp-pl-icon";
      icon.textContent = i === this.currentIdx ? "▶" : "";

      /* 트랙 번호 */
      const idx = document.createElement("span");
      idx.className = "vp-pl-idx";
      idx.textContent = i + 1;

      /* 파일명: textContent 사용 (XSS 방지) */
      const name = document.createElement("span");
      name.className = "vp-pl-name";
      name.textContent = t.name;

      /* 파일 크기 */
      const sizeLbl = document.createElement("span");
      sizeLbl.className = "vp-pl-size";
      sizeLbl.textContent = (t.size / 1024 / 1024).toFixed(1) + "MB";

      /* 삭제 버튼 */
      const del = document.createElement("button");
      del.className = "vp-pl-del";
      del.textContent = "✕";
      del.title = "플레이리스트에서 제거";
      del.addEventListener("click", (e) => {
        e.stopPropagation(); /* 항목 클릭(재생)으로 전파 방지 */
        this._removeTrack(i);
      });

      item.appendChild(icon);
      item.appendChild(idx);
      item.appendChild(name);
      item.appendChild(sizeLbl);
      item.appendChild(del);

      /* 항목 클릭 → 해당 트랙 재생 */
      item.addEventListener("click", () => this._playTrack(i));

      this.playlistEl.appendChild(item);
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildDropOverlay(playerEl)
     플레이어 전체 영역에 드래그앤드롭 시 표시되는 힌트 오버레이를 생성합니다.
     (옵션 패널의 드롭존과 별개로, 플레이어 위 어디든 파일을 떨어뜨려도 추가 가능)
     @param {HTMLElement} playerEl — 드래그 이벤트를 감시할 플레이어 컨테이너
     @returns {HTMLElement} .vp-drop-overlay div
  ───────────────────────────────────────────────────────────────── */
  _buildDropOverlay(playerEl) {
    const overlay = document.createElement("div");
    overlay.className = "vp-drop-overlay";

    const icon = document.createElement("div");
    icon.className = "vp-drop-icon";
    icon.textContent = "🎬";

    const text = document.createElement("div");
    text.textContent = "동영상을 여기에 놓으면 플레이리스트에 추가됩니다";

    overlay.appendChild(icon);
    overlay.appendChild(text);

    /* 플레이어 전체 영역 드래그 이벤트 */
    playerEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      if ([...e.dataTransfer.items].some((i) => i.type.startsWith("video/"))) {
        overlay.classList.add("show");
      }
    });
    playerEl.addEventListener("dragleave", (e) => {
      /* relatedTarget이 playerEl 밖으로 나갔을 때만 닫힘 */
      if (!playerEl.contains(e.relatedTarget)) {
        overlay.classList.remove("show");
      }
    });
    playerEl.addEventListener("drop", (e) => {
      e.preventDefault();
      overlay.classList.remove("show");
      const files = [...e.dataTransfer.files].filter((f) =>
        f.type.startsWith("video/"),
      );
      if (files.length === 0) return;
      this._appendFiles(files);
    });

    return overlay;
  }

  /* ═══════════════════════════════════════════════════════════════
     재생 제어
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _togglePlay()
     영상 재생/일시정지를 토글합니다.
     화면 클릭/터치, 컨트롤 ▶ 버튼, FAKE 오버레이 클릭이 모두 이 함수를 사용합니다.
  ───────────────────────────────────────────────────────────────── */
  _togglePlay() {
    if (!this.videoEl || !this.videoEl.src) return;
    if (this.videoEl.paused) {
      this.videoEl.play().catch(() => {});
    } else {
      this.videoEl.pause();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     반복 모드
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _cycleRepeat()
     반복 모드를 none → one → all → none 순서로 순환합니다.
  ───────────────────────────────────────────────────────────────── */
  _cycleRepeat() {
    const order = { none: "one", one: "all", all: "none" };
    this.repeatMode = order[this.repeatMode];
    this._updateRepeatUI();
  }

  /* ─────────────────────────────────────────────────────────────────
     _updateRepeatUI()
     repeatMode 상태를 버튼의 스타일과 텍스트에 반영합니다.

     none : dim 색, 테두리 없음    → "⟲ OFF"
     one  : 녹색 + 테두리 + 글로우 → "⟲ 1개"
     all  : 노란색 + 테두리 + 글로우 → "⟲ 전체"
  ───────────────────────────────────────────────────────────────── */
  _updateRepeatUI() {
    if (!this.repeatBtn) return;

    const label = this.repeatBtn.querySelector(".vp-rep-label");

    /* 기존 모드 클래스 제거 후 새 클래스 적용 */
    this.repeatBtn.classList.remove("mode-one", "mode-all");

    const MAP = {
      none: {
        cls: "",
        text: "OFF",
        tip: "반복 없음 — 클릭하면 1개 반복으로 바뀝니다",
      },
      one: {
        cls: "mode-one",
        text: "1개",
        tip: "1개 반복 — 현재 영상을 반복합니다. 클릭하면 전체 반복으로 바뀝니다",
      },
      all: {
        cls: "mode-all",
        text: "전체",
        tip: "전체 반복 — 클릭하면 반복을 끕니다",
      },
    };

    const { cls, text, tip } = MAP[this.repeatMode];
    if (cls) this.repeatBtn.classList.add(cls);
    if (label) label.textContent = text;
    this.repeatBtn.title = tip;
  }

  /* ═══════════════════════════════════════════════════════════════
     비디오 이벤트 바인딩
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _bindVideoEvents()
     <video> 요소의 이벤트를 일괄 연결합니다.
     FAKE 오버레이 동기화도 이 함수에서 처리합니다.
  ───────────────────────────────────────────────────────────────── */
  _bindVideoEvents() {
    const v = this.videoEl;

    /* 재생 시작 → 버튼 ⏸, FAKE 오버레이 숨김 */
    v.addEventListener("play", () => {
      if (this.playBtn) this.playBtn.textContent = "⏸";
      if (this.trackNameEl)
        this.trackNameEl.querySelector(".vp-track-icon").textContent = "▶";
      /* FAKE: 재생 중에는 실제 영상을 보여줌 */
      this._syncFakeOverlay();
    });

    /* 일시정지 → 버튼 ▶, FAKE 오버레이 조건부 표시 */
    v.addEventListener("pause", () => {
      if (this.playBtn) this.playBtn.textContent = "▶";
      if (this.trackNameEl)
        this.trackNameEl.querySelector(".vp-track-icon").textContent = "∥";
      /* FAKE: 정지 시 isFakeOn이면 오버레이 표시 */
      this._syncFakeOverlay();
    });

    /* 영상 종료 → repeatMode 분기, FAKE 오버레이 동기화 */
    v.addEventListener("ended", () => {
      if (this.playBtn) this.playBtn.textContent = "▶";
      this._onEnded();
      this._syncFakeOverlay();
    });

    /* 메타데이터 로드 완료 → 시간 표시 + 정보 패널 초기화 */
    v.addEventListener("loadedmetadata", () => {
      if (this.timeDisp)
        this.timeDisp.textContent = `00:00 / ${fmtTime(v.duration)}`;
      this._updateInfoPanel();
    });

    /* 재생 위치 변경 → 진행바 + 시간 표시 갱신 */
    v.addEventListener("timeupdate", () => {
      if (!v.duration) return;
      const pct = (v.currentTime / v.duration) * 100;
      if (this.fillEl) this.fillEl.style.width = `${pct}%`;
      if (this.timeDisp)
        this.timeDisp.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
    });

    /* ── fullscreenchange 이벤트 ─────────────────────────────────────
       사용자가 ESC 키 등으로 Fullscreen을 해제했을 때
       sizeMode를 'normal'로 복원하고 버튼 UI를 동기화합니다.
    ────────────────────────────────────────────────────────────────── */
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && this.sizeMode === "monitor") {
        /* Fullscreen이 해제됨 → 상태 복원 */
        this.sizeMode = "normal";
        if (this.sizeBtn) this.sizeBtn.textContent = "⤡";
        /* 메뉴 옵션 버튼 active 상태 동기화 */
        this._sizeOptions &&
          this._sizeOptions.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.sizeKey === "normal");
          });
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════════════
   renderVideo(file)
   파일명: js/video-player.js
   terminal.html 의 file input 핸들러에서 호출하는 진입점 함수입니다.
   첫 번째 동영상 파일이면 새 VideoPlayer를 생성해 터미널에 삽입합니다.
   이후 파일 추가는 옵션 패널 "동영상 추가" 탭 또는 드래그앤드롭으로 처리합니다.
   @param {File} file — 재생할 동영상 파일
════════════════════════════════════════════════════════════════════ */
function renderVideo(file) {
  /* appendText / appendNode 는 terminal.html의 전역 함수 */
  appendText(`guest@system:~$ [file attached: ${file.name}]`, "c-green", true);

  const player = new VideoPlayer(file);
  appendNode(player.render(), false);
}
