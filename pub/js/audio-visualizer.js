/**
 * ═══════════════════════════════════════════════════════════════════════
 *  audio-visualizer.js
 *  오디오 비주얼라이저 모듈
 *
 *  포함 내용:
 *    - AudioVisualizer 클래스 (플레이리스트, Web Audio API, Canvas 시각화)
 *    - renderAudio(file) 진입점 함수
 *
 *  외부 의존성 (메인 HTML 전역 스코프):
 *    - fmtTime(s)           : 초 → "00:00" 형식 변환
 *    - makeBtn(lbl, fn)     : 컨트롤 버튼 DOM 생성
 *    - makeRange(init, fn)  : 범위 슬라이더 DOM 생성
 *    - appendText(t,c,ts)   : 터미널 텍스트 출력
 *    - appendNode(n,ts)     : 터미널 노드 출력
 *    - scrollBottom()       : 터미널 하단 스크롤
 *
 *  주요 기능:
 *    ✓ 플레이리스트 순차 재생 (트랙 종료 → 자동으로 다음 재생)
 *    ✓ 자동반복(⇄): 마지막 트랙 종료 후 처음으로 돌아가 반복
 *    ✓ 재생 불가 파일 감지 → ✕ 표시 후 다음 트랙으로 스킵
 *    ✓ AudioContext 재사용 (트랙 전환 시 유지)
 *    ✓ 플레이어 내 플레이리스트 뷰 (드래그로 순서 변경)
 *    ✓ 옵션 패널 플레이리스트 (드래그 재정렬 동기화)
 *    ✓ 3탭 옵션 패널: 사운드 정보 / 사운드 추가 / 비주얼 옵션
 *    ✓ 24가지 시각화 조합 (4소스 × 6이펙트)
 *    ✓ 전체화면 토글
 * ═══════════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════════
   AudioVisualizer 클래스
   ─ 생성 흐름: constructor → _buildDOM → mount (터미널에 삽입)
   ─ 재생 흐름: _startPlay → _reconnectAudio → audioCtx.resume → aud.play → _drawLoop
   ─ 트랙 전환: _playTrack → 새 Audio 요소 → _reconnectAudio → _startPlay
═══════════════════════════════════════════════════════════════════════ */
class AudioVisualizer {

  /* ─────────────────────────────────────────────────────────────────
     constructor(file)
     첫 번째 오디오 파일을 받아 전체 상태와 DOM을 초기화합니다.
     @param {File} file - 최초 로드할 오디오 File 객체
  ───────────────────────────────────────────────────────────────── */
  constructor(file) {
    /* ── 플레이리스트 상태 ──────────────────────────── */
    this.playlist    = [file];    // 재생 목록 (File 객체 배열)
    this.currentIdx  = 0;         // 현재 재생 중인 인덱스
    this.autoRepeat  = false;     // 자동반복 여부 (전체 플레이리스트 루프)
    this.brokenTracks = new Set(); // 재생 불가 트랙 인덱스 집합

    /* ── Web Audio API 관련 객체 ─────────────────────── */
    this.audioCtx   = null;   // AudioContext (최초 재생 시 생성, 이후 재사용)
    this.analyser   = null;   // AnalyserNode (주파수·파형 데이터 제공)
    this.sourceNode = null;   // MediaElementSourceNode (트랙 전환 시 재생성)
    this.animId     = null;   // requestAnimationFrame 핸들

    /* 현재 Audio 요소 (File → createObjectURL) */
    this.aud = new Audio(URL.createObjectURL(file));

    /* ── 비주얼 옵션 (디폴트 프리셋으로 초기화) ────── */
    this.options = this._defaultOptions();

    /* ── 파티클 시스템 ──────────────────────────────── */
    this.particles = []; // 화면 위 활성 파티클 목록 [{x,y,vx,vy,life,...}]

    /* ── 비트 감지 상태 ─────────────────────────────── */
    this.lastBassEnergy = 0;   // 이전 프레임의 저음 에너지 (비교용)
    this.beatCooldown   = 0;   // 비트 감지 후 재감지 방지 쿨다운 (프레임 수)
    this.isBeatNow      = false; // 현재 프레임이 비트 프레임인지
    this.beatFlash      = 0;   // 비트 시 화면 플래시 강도 (0~1, 매 프레임 감쇠)

    /* ── 볼륨 보간값 ────────────────────────────────── */
    this.smoothVolume = 0; // 급격한 볼륨 변화를 부드럽게 보간한 값

    /* ── 스펙트로그램 오프스크린 캔버스 ─────────────── */
    // 매 프레임 주파수 스냅샷을 한 열로 그려 왼쪽으로 스크롤합니다
    this.sgCanvas        = document.createElement('canvas');
    this.sgCanvas.width  = 600;
    this.sgCanvas.height = 220;
    // willReadFrequently: true — getImageData를 매 프레임 호출하므로
    // 브라우저가 GPU 대신 CPU 최적화 경로를 사용하도록 힌트를 줍니다.
    this.sgCtx           = this.sgCanvas.getContext('2d', { willReadFrequently: true });

    /* ── 드래그-리오더 상태 ─────────────────────────── */
    this.dragFromIdx = null; // 드래그 시작 아이템 인덱스

    /* ── 패널/탭 상태 ───────────────────────────────── */
    this.panelOpen = false;
    this.activeTab = 'info';

    /* ── DOM 참조 (buildDOM 이후에 채워집니다) ─────── */
    this.playerEl     = null; // 전체 플레이어 컨테이너 <div.player>
    this.canvas       = null; // 비주얼라이저 <canvas>
    this.ctx2d        = null; // 2D 렌더링 컨텍스트
    this.idleEl       = null; // 재생 전 아이들 막대 오버레이
    this.playBtn      = null; // ▶ / ⏸ 토글 버튼
    this.repeatBtn    = null; // ⇄ 자동반복 버튼
    this.timeDisp     = null; // "00:00 / 00:00" 시간 표시 스팬
    this.fillEl       = null; // 진행 바 채움 막대
    this.visPanel     = null; // 패널 오버레이 루트
    this.tabPanes     = {};   // { info, add, visual } → DOM 요소
    this.tabBtns      = {};   // { info, add, visual } → 탭 버튼
    this.playlistEl   = null; // 패널 내 플레이리스트 컨테이너
    this.mainPlEl     = null; // 플레이어 내 플레이리스트 컨테이너
    this.dropMsgEl    = null; // 파일 추가 탭 인라인 메시지
    this.addFileInput = null; // 숨겨진 <input type=file>
    this.optionCbs    = {};   // { 'freq.barSpectrum': <input> , ... }

    /* ── DOM 전체 구성 ─────────────────────────────── */
    this.wrap = this._buildDOM();
  }

  /* ─────────────────────────────────────────────────────────────────
     _defaultOptions()
     기본 프리셋: 주파수→막대스펙트럼, 볼륨→오실로스코프,
                 비트→파티클, 파형→스펙트로그램
     @returns {Object} options 객체
  ───────────────────────────────────────────────────────────────── */
  _defaultOptions() {
    // 모든 이펙트를 false 로 시작하는 빈 슬롯 생성
    const blank = () => ({
      barSpectrum: false, oscilloscope: false, circularSpectrum: false,
      particles:   false, spectrogram:  false, volumeEffect:     false,
    });
    return {
      freq:   { ...blank(), barSpectrum:  true }, // 주파수 대역 → 막대 스펙트럼
      volume: { ...blank(), oscilloscope: true }, // 볼륨       → 파형 오실로스코프
      beat:   { ...blank(), particles:    true }, // 비트       → 파티클 효과
      wave:   { ...blank(), spectrogram:  true }, // 파형       → 스펙트로그램
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     DOM 구성
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _buildDOM()
     플레이어 전체 DOM 트리를 생성하고 반환합니다.
     구조: wrap > playerEl > visWrap + progressBar + controls + mainPlaylist
  ───────────────────────────────────────────────────────────────── */
  _buildDOM() {
    const wrap = document.createElement('div');

    /* 플레이어 컨테이너 */
    this.playerEl = document.createElement('div');
    this.playerEl.className = 'player';

    /* ① 비주얼라이저 캔버스 영역 */
    const visWrap = document.createElement('div');
    visWrap.className = 'vis-wrap';
    visWrap.title = '클릭하여 재생/일시정지';

    this.canvas        = document.createElement('canvas');
    this.canvas.width  = 600;
    this.canvas.height = 220;
    this.ctx2d         = this.canvas.getContext('2d');
    visWrap.appendChild(this.canvas);

    /* 재생 전 아이들 막대 (정적 장식용) */
    this.idleEl = document.createElement('div');
    this.idleEl.className = 'wave-idle';
    for (let i = 0; i < 40; i++) {
      const b = document.createElement('div');
      b.className = 'bar';
      b.style.height = `${18 + Math.sin(i * .7) * 13}px`;
      this.idleEl.appendChild(b);
    }
    visWrap.appendChild(this.idleEl);

    /* 옵션 패널 오버레이 (클릭이 캔버스로 전파되지 않도록 차단) */
    this.visPanel = this._buildPanel();
    this.visPanel.addEventListener('click', e => e.stopPropagation());
    visWrap.appendChild(this.visPanel);

    /* 캔버스 클릭·터치 → 재생/정지 토글 */
    visWrap.addEventListener('click',    () => this._togglePlay());
    visWrap.addEventListener('touchend', e  => { e.preventDefault(); this._togglePlay(); });
    this.playerEl.appendChild(visWrap);

    /* ② 진행 바 (클릭으로 탐색 가능) */
    const prog = document.createElement('div');
    prog.className = 'progress-wrap';
    this.fillEl = document.createElement('div');
    this.fillEl.className = 'progress-fill';
    this.fillEl.style.width = '0%';
    prog.appendChild(this.fillEl);
    prog.addEventListener('click', e => {
      if (!this.aud.duration) return;
      const r = prog.getBoundingClientRect();
      this.aud.currentTime = ((e.clientX - r.left) / r.width) * this.aud.duration;
    });
    this.playerEl.appendChild(prog);

    /* ③ 컨트롤 바 */
    this.playerEl.appendChild(this._buildControls());

    /* ④ 플레이어 내 플레이리스트 뷰 */
    this.mainPlEl = document.createElement('div');
    this.mainPlEl.className = 'pl-view';
    this.playerEl.appendChild(this.mainPlEl);

    /* 오디오 이벤트 연결 */
    this._bindAudioEvents();

    /* 초기 플레이리스트 렌더링 */
    this._renderMainPlaylist();

    wrap.appendChild(this.playerEl);
    return wrap;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildControls()
     컨트롤 바: ▶ | ⇄ | ↺ | 시간 | [공간] | 볼륨 | ⚙ | ⛶
     @returns {HTMLElement} controls div
  ───────────────────────────────────────────────────────────────── */
  _buildControls() {
    const ctrl = document.createElement('div');
    ctrl.className = 'controls';

    /* 재생/일시정지 버튼 */
    this.playBtn = makeBtn('▶', () => this._togglePlay());
    this.playBtn.title = '재생/일시정지';

    /* ── 자동반복 토글 버튼 ──────────────────────────────────────────
       아이콘(⇄)만으로는 현재 상태를 파악하기 어렵습니다.
       아이콘 + 텍스트 레이블(OFF/ON) + 테두리/글로우로 상태를 명확히 표시합니다.
       OFF → dim 색상, 테두리 없음
       ON  → 녹색 테두리 + 글로우 + 굵은 레이블
       CSS: .repeat-btn, .repeat-btn.repeat-on (audio-player.css 참조)
    ─────────────────────────────────────────────────────────────── */
    this.repeatBtn = document.createElement('button');
    this.repeatBtn.className = 'ctrl-btn repeat-btn';
    this.repeatBtn.title = '자동반복 OFF — 마지막 곡 후 정지합니다. 클릭하면 켜집니다';

    /* 아이콘 span */
    const repeatIcon = document.createElement('span');
    repeatIcon.className = 'repeat-icon';
    repeatIcon.textContent = '⇄';

    /* 상태 레이블 span — _toggleRepeat() 에서 텍스트를 바꿉니다 */
    const repeatLabel = document.createElement('span');
    repeatLabel.className = 'repeat-label';
    repeatLabel.textContent = 'OFF'; /* 초기값: 반복 꺼짐 */

    this.repeatBtn.appendChild(repeatIcon);
    this.repeatBtn.appendChild(repeatLabel);
    this.repeatBtn.addEventListener('click', () => this._toggleRepeat());

    /* 처음부터 다시 재생 */
    const replayBtn = makeBtn('↺', () => { this.aud.currentTime = 0; this._startPlay(); });
    replayBtn.title = '처음부터 다시 재생';

    /* 시간 표시 */
    this.timeDisp = document.createElement('span');
    this.timeDisp.className = 'time-disp';
    this.timeDisp.textContent = '00:00 / 00:00';

    /* 중간 탄성 여백 */
    const sf = document.createElement('div');
    sf.className = 'spacer-flex';

    /* 볼륨 슬라이더 */
    const volRange = makeRange(1, v => { this.aud.volume = v; });
    volRange.title = '볼륨';

    /* 옵션 패널 열기 (⚙) */
    const optBtn = makeBtn('⚙', () => this._togglePanel('info'));
    optBtn.title = '옵션 패널';

    /* 전체화면 토글 (⛶) */
    const fsBtn = makeBtn('⛶', () => this._toggleFullscreen());
    fsBtn.title = '전체화면';

    [this.playBtn, this.repeatBtn, replayBtn, this.timeDisp, sf, volRange, optBtn, fsBtn]
      .forEach(n => ctrl.appendChild(n));

    return ctrl;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildPanel()
     3탭 오버레이 패널: 사운드 정보 / 사운드 추가 / 비주얼 옵션
     @returns {HTMLElement} vis-panel div
  ───────────────────────────────────────────────────────────────── */
  _buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'vis-panel';

    /* 탭 헤더 */
    const tabsEl = document.createElement('div');
    tabsEl.className = 'panel-tabs';

    const TABS = [
      { key: 'info',   label: '현재 사운드 정보' },
      { key: 'add',    label: '사운드 추가'      },
      { key: 'visual', label: '비주얼 옵션'      },
    ];
    TABS.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'panel-tab' + (t.key === 'info' ? ' active' : '');
      btn.textContent = t.label;
      btn.addEventListener('click', () => this._switchTab(t.key));
      this.tabBtns[t.key] = btn;
      tabsEl.appendChild(btn);
    });
    panel.appendChild(tabsEl);

    /* 탭 콘텐츠 영역 */
    this.tabPanes.info   = this._buildTabInfo();
    this.tabPanes.add    = this._buildTabAdd();
    this.tabPanes.visual = this._buildTabVisual();
    Object.values(this.tabPanes).forEach(p => panel.appendChild(p));

    /* 패널 닫기 버튼 */
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close-btn';
    closeBtn.textContent = '✕ 닫기';
    closeBtn.addEventListener('click', () => this._togglePanel());
    panel.appendChild(closeBtn);

    return panel;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildTabInfo()
     탭①: 현재 사운드 파일 정보 표시
  ───────────────────────────────────────────────────────────────── */
  _buildTabInfo() {
    const pane = document.createElement('div');
    pane.className = 'tab-pane active'; // 기본 활성 탭

    const grid = document.createElement('div');
    grid.className = 'info-grid';

    const f = this.playlist[0];
    // 정보 행 목록: data-infoid 속성으로 나중에 내용을 갱신합니다
    [
      { label: '파일명', value: f.name,                               id: 'fname' },
      { label: '크기',   value: `${(f.size / 1024).toFixed(1)} KB`,  id: 'fsize' },
      { label: '확장명', value: f.name.split('.').pop().toUpperCase(),id: 'fext'  },
      { label: '타입',   value: f.type || 'audio/*',                 id: 'ftype' },
      { label: '길이',   value: '로딩 중...',                         id: 'fdur'  },
    ].forEach(r => {
      const row = document.createElement('div'); row.className = 'info-row';
      const lbl = document.createElement('span'); lbl.className = 'info-label'; lbl.textContent = r.label;
      const val = document.createElement('span'); val.className = 'info-value'; val.textContent = r.value;
      val.dataset.infoid = r.id;
      row.appendChild(lbl); row.appendChild(val); grid.appendChild(row);
    });

    pane.appendChild(grid);
    return pane;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildTabAdd()
     탭②: 오디오 파일 추가 (드래그앤드롭 + 클릭 선택) + 플레이리스트
     비오디오 파일은 alert 대신 패널 내 메시지로 안내합니다.
  ───────────────────────────────────────────────────────────────── */
  _buildTabAdd() {
    const pane = document.createElement('div');
    pane.className = 'tab-pane';

    /* 드롭 영역 */
    const drop = document.createElement('div');
    drop.className = 'drop-zone';
    drop.innerHTML = '<span class="drop-zone-icon">♫</span>오디오 파일을 드래그하거나 클릭하여 추가<br><span style="font-size:9px;color:var(--dim)">다중 선택 가능 (MP3, WAV, OGG, FLAC 등)</span>';
    pane.appendChild(drop);

    /* 인라인 오류/안내 메시지 (alert 대신 사용) */
    this.dropMsgEl = document.createElement('div');
    this.dropMsgEl.className = 'drop-msg';
    pane.appendChild(this.dropMsgEl);

    /* 숨겨진 다중 파일 선택 입력 */
    this.addFileInput = document.createElement('input');
    this.addFileInput.type = 'file';
    this.addFileInput.accept = 'audio/*';
    this.addFileInput.multiple = true;
    this.addFileInput.style.display = 'none';
    pane.appendChild(this.addFileInput);

    /* 플레이리스트 (패널 내부) */
    this.playlistEl = document.createElement('div');
    this.playlistEl.className = 'playlist-wrap';
    pane.appendChild(this.playlistEl);
    this._renderPlaylist(); // 초기 렌더링

    /* 클릭 → 파일 선택창 열기 */
    drop.addEventListener('click', () => this.addFileInput.click());

    /* 드래그 이벤트 */
    drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      this._addFiles(e.dataTransfer.files);
    });

    /* 파일 선택 완료 */
    this.addFileInput.addEventListener('change', () => {
      this._addFiles(this.addFileInput.files);
      this.addFileInput.value = '';
    });

    return pane;
  }

  /* ─────────────────────────────────────────────────────────────────
     _buildTabVisual()
     탭③: 비주얼 옵션 — 4소스 × 6이펙트 중첩 체크박스 트리
           프리셋: ◉ 디폴트 / ○ 모두 해제
  ───────────────────────────────────────────────────────────────── */
  _buildTabVisual() {
    const pane = document.createElement('div');
    pane.className = 'tab-pane';

    /* ── 프리셋 버튼 행 ── */
    const presets = document.createElement('div');
    presets.className = 'vis-presets';

    const btnDef = document.createElement('button');
    btnDef.className = 'vis-preset';
    btnDef.textContent = '◉ 디폴트';
    btnDef.title = '기본 프리셋으로 초기화 (각 소스에 대표 이펙트 1개씩)';
    btnDef.addEventListener('click', () => {
      this.options = this._defaultOptions();
      this._syncOptionUI();
    });

    const btnNone = document.createElement('button');
    btnNone.className = 'vis-preset';
    btnNone.textContent = '○ 모두 해제';
    btnNone.title = '모든 시각화 이펙트 비활성화 (캔버스에 사운드 정보 표시)';
    btnNone.addEventListener('click', () => {
      ['freq','volume','beat','wave'].forEach(s =>
        ['barSpectrum','oscilloscope','circularSpectrum','particles','spectrogram','volumeEffect']
          .forEach(e => { this.options[s][e] = false; }));
      this._syncOptionUI();
    });

    presets.appendChild(btnDef);
    presets.appendChild(btnNone);
    pane.appendChild(presets);

    /* ── 소스·이펙트 체크박스 트리 ── */
    const SOURCES = [
      { key: 'freq',   label: '주파수 대역 (FFT 스펙트럼)' },
      { key: 'volume', label: '볼륨 (RMS 에너지)'         },
      { key: 'beat',   label: '비트 (저음 에너지 급상승)' },
      { key: 'wave',   label: '파형 (시간 도메인)'        },
    ];
    const EFFECTS = [
      { key: 'barSpectrum',      label: '막대 스펙트럼'    },
      { key: 'oscilloscope',     label: '파형 오실로스코프' },
      { key: 'circularSpectrum', label: '원형 스펙트럼'    },
      { key: 'particles',        label: '파티클 효과'      },
      { key: 'spectrogram',      label: '스펙트로그램'     },
      { key: 'volumeEffect',     label: '볼륨 기반 효과'   },
    ];

    SOURCES.forEach(src => {
      const section = document.createElement('div');
      section.className = 'vis-section';

      /* 부모 체크박스 (해당 소스의 모든 이펙트를 한 번에 토글) */
      const parentRow = document.createElement('label');
      parentRow.className = 'vis-parent';
      const parentCb = document.createElement('input');
      parentCb.type = 'checkbox';
      parentCb.checked = EFFECTS.some(e => this.options[src.key][e.key]);
      parentCb.addEventListener('change', () => {
        // 켤 때는 디폴트 프리셋 기준, 끌 때는 모두 false
        const def = this._defaultOptions()[src.key];
        EFFECTS.forEach(ef => {
          this.options[src.key][ef.key] = parentCb.checked ? def[ef.key] : false;
        });
        this._syncOptionUI();
      });
      parentRow.appendChild(parentCb);
      parentRow.appendChild(document.createTextNode(' ' + src.label));
      section.appendChild(parentRow);

      /* 자식 체크박스 (이펙트 개별 선택) */
      const children = document.createElement('div');
      children.className = 'vis-children';
      EFFECTS.forEach(ef => {
        const childRow = document.createElement('label');
        childRow.className = 'vis-child';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.options[src.key][ef.key];
        const cbKey = `${src.key}.${ef.key}`;
        this.optionCbs[cbKey] = cb;
        cb.addEventListener('change', () => {
          this.options[src.key][ef.key] = cb.checked;
          // 자식 변경 시 부모 체크박스 상태 동기화
          parentCb.checked = EFFECTS.some(e => this.options[src.key][e.key]);
        });
        childRow.appendChild(cb);
        childRow.appendChild(document.createTextNode(' ' + ef.label));
        children.appendChild(childRow);
      });

      section.appendChild(children);
      pane.appendChild(section);
    });

    return pane;
  }

  /* ═══════════════════════════════════════════════════════════════
     패널 / 탭 관리
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _switchTab(key)
     지정된 탭을 활성화하고 나머지는 비활성화합니다.
     @param {string} key - 'info' | 'add' | 'visual'
  ───────────────────────────────────────────────────────────────── */
  _switchTab(key) {
    Object.keys(this.tabBtns).forEach(k => {
      this.tabBtns[k].classList.toggle('active', k === key);
      this.tabPanes[k].classList.toggle('active', k === key);
    });
    this.activeTab = key;
  }

  /* ─────────────────────────────────────────────────────────────────
     _togglePanel(defaultTab?)
     패널을 열거나 닫습니다. 열 때는 defaultTab으로 전환합니다.
     @param {string} [defaultTab] - 패널 열 때 표시할 탭
  ───────────────────────────────────────────────────────────────── */
  _togglePanel(defaultTab) {
    this.panelOpen = !this.panelOpen;
    this.visPanel.classList.toggle('open', this.panelOpen);
    if (this.panelOpen) {
      if (defaultTab) this._switchTab(defaultTab);
      this._updateInfoTab(); // 사운드 정보 최신화
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _syncOptionUI()
     this.options 상태를 체크박스 UI에 반영합니다.
     (프리셋 버튼 클릭 후 체크박스를 동기화할 때 사용)
  ───────────────────────────────────────────────────────────────── */
  _syncOptionUI() {
    ['freq','volume','beat','wave'].forEach(s =>
      ['barSpectrum','oscilloscope','circularSpectrum','particles','spectrogram','volumeEffect'].forEach(e => {
        const cb = this.optionCbs[`${s}.${e}`];
        if (cb) cb.checked = this.options[s][e];
      }));
  }

  /* ─────────────────────────────────────────────────────────────────
     _updateInfoTab()
     현재 트랙의 파일 정보로 사운드 정보 탭을 갱신합니다.
  ───────────────────────────────────────────────────────────────── */
  _updateInfoTab() {
    const f = this.playlist[this.currentIdx];
    if (!f || !this.visPanel) return;
    const set = (id, v) => {
      const el = this.visPanel.querySelector(`[data-infoid="${id}"]`);
      if (el) el.textContent = v;
    };
    set('fname', f.name);
    set('fsize', `${(f.size / 1024).toFixed(1)} KB`);
    set('fext',  f.name.split('.').pop().toUpperCase());
    set('ftype', f.type || 'audio/*');
    set('fdur',  this.aud.duration ? fmtTime(this.aud.duration) : '로딩 중...');
  }

  /* ═══════════════════════════════════════════════════════════════
     플레이리스트 관리
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _addFiles(fileList)
     FileList에서 오디오 파일만 플레이리스트에 추가합니다.
     비오디오 파일은 alert 대신 패널 내 메시지로 안내합니다.
     @param {FileList} fileList
  ───────────────────────────────────────────────────────────────── */
  _addFiles(fileList) {
    let added = 0, skipped = 0;
    Array.from(fileList).forEach(f => {
      const isAudio = f.type.startsWith('audio/')
        || /\.(mp3|ogg|flac|wav|aac|m4a|opus|weba|aiff|au)$/i.test(f.name);
      if (isAudio) { this.playlist.push(f); added++; }
      else skipped++;
    });

    // 인라인 메시지 표시 (alert 대신)
    if (this.dropMsgEl) {
      if (skipped > 0) {
        this.dropMsgEl.textContent = `⚠ ${skipped}개 파일이 오디오 형식이 아니어서 제외됐습니다.`;
        setTimeout(() => { if (this.dropMsgEl) this.dropMsgEl.textContent = ''; }, 4000);
      } else if (added > 0) {
        this.dropMsgEl.textContent = `✓ ${added}개 파일이 추가됐습니다.`;
        setTimeout(() => { if (this.dropMsgEl) this.dropMsgEl.textContent = ''; }, 2000);
      }
    }

    this._renderPlaylist();
    this._renderMainPlaylist();
  }

  /* ─────────────────────────────────────────────────────────────────
     _removeTrack(idx)
     플레이리스트에서 특정 인덱스의 트랙을 제거합니다.
     단, 플레이리스트가 1개이면 제거하지 않습니다.
     @param {number} idx
  ───────────────────────────────────────────────────────────────── */
  _removeTrack(idx) {
    if (this.playlist.length <= 1) return;
    this.playlist.splice(idx, 1);

    // broken 집합 인덱스 재조정
    const newBroken = new Set();
    this.brokenTracks.forEach(bi => {
      if (bi < idx) newBroken.add(bi);
      else if (bi > idx) newBroken.add(bi - 1);
      // bi === idx 는 제거이므로 추가하지 않음
    });
    this.brokenTracks = newBroken;

    // 현재 인덱스 보정
    if (idx < this.currentIdx) this.currentIdx--;
    else if (idx === this.currentIdx) {
      this.currentIdx = Math.max(0, this.currentIdx - 1);
    }

    this._renderPlaylist();
    this._renderMainPlaylist();
  }

  /* ─────────────────────────────────────────────────────────────────
     _renderPlaylist()
     옵션 패널 내 플레이리스트를 재렌더링합니다.
     드래그로 순서를 바꿀 수 있습니다.
  ───────────────────────────────────────────────────────────────── */
  _renderPlaylist() {
    if (!this.playlistEl) return;
    this.playlistEl.innerHTML = '';
    this.playlist.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'pl-item'
        + (idx === this.currentIdx ? ' playing' : '')
        + (this.brokenTracks.has(idx) ? ' broken' : '');
      item.dataset.idx = idx;
      item.draggable = true;

      const idxEl = document.createElement('span'); idxEl.className = 'pl-item-idx'; idxEl.textContent = idx + 1;
      const nameEl = document.createElement('span'); nameEl.className = 'pl-item-name';
      nameEl.textContent = (this.brokenTracks.has(idx) ? '✕ ' : '') + f.name;
      nameEl.title = f.name;
      const del = document.createElement('button'); del.className = 'pl-item-del'; del.textContent = '✕';
      del.title = '제거'; del.addEventListener('click', e => { e.stopPropagation(); this._removeTrack(idx); });

      item.appendChild(idxEl); item.appendChild(nameEl); item.appendChild(del);
      item.addEventListener('click', () => this._playTrack(idx));

      // 드래그 이벤트
      this._attachDrag(item, idx, () => { this._renderPlaylist(); this._renderMainPlaylist(); });

      this.playlistEl.appendChild(item);
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     _renderMainPlaylist()
     플레이어 하단의 플레이리스트 뷰를 재렌더링합니다.
     드래그로 순서를 바꿀 수 있으며, broken 트랙은 ✕로 표시됩니다.
  ───────────────────────────────────────────────────────────────── */
  _renderMainPlaylist() {
    if (!this.mainPlEl) return;
    this.mainPlEl.innerHTML = '';

    this.playlist.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'pl-view-item'
        + (idx === this.currentIdx ? ' playing' : '')
        + (this.brokenTracks.has(idx) ? ' broken' : '');
      item.dataset.idx = idx;
      item.draggable = true;

      // 드래그 핸들 아이콘
      const drag = document.createElement('span');
      drag.className = 'pl-view-drag';
      drag.textContent = '⠿';
      drag.title = '드래그로 순서 변경';

      // 재생 상태 아이콘
      const icon = document.createElement('span');
      icon.className = 'pl-view-icon';
      if (this.brokenTracks.has(idx)) icon.textContent = '✕';
      else if (idx === this.currentIdx) icon.textContent = '▶';
      else icon.textContent = '';

      // 트랙 번호
      const idxEl = document.createElement('span');
      idxEl.className = 'pl-view-idx';
      idxEl.textContent = idx + 1;

      // 파일명
      const nameEl = document.createElement('span');
      nameEl.className = 'pl-view-name';
      nameEl.textContent = f.name;
      nameEl.title = f.name;

      item.appendChild(drag);
      item.appendChild(icon);
      item.appendChild(idxEl);
      item.appendChild(nameEl);

      // 클릭으로 트랙 전환
      item.addEventListener('click', () => this._playTrack(idx));

      // 드래그 이벤트 (메인 플레이리스트와 패널 플레이리스트 모두 갱신)
      this._attachDrag(item, idx, () => { this._renderMainPlaylist(); this._renderPlaylist(); });

      this.mainPlEl.appendChild(item);
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     _attachDrag(el, idx, onReorder)
     HTML5 Drag & Drop 이벤트를 요소에 연결합니다.
     드롭 완료 시 playlist 배열을 재정렬하고 onReorder를 호출합니다.
     @param {HTMLElement} el        - 드래그 가능한 아이템 요소
     @param {number}      idx       - 해당 아이템의 현재 인덱스
     @param {Function}    onReorder - 재정렬 완료 후 호출할 콜백
  ───────────────────────────────────────────────────────────────── */
  _attachDrag(el, idx, onReorder) {
    el.addEventListener('dragstart', e => {
      this.dragFromIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.style.opacity = '0.4', 0);
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      this.dragFromIdx = null;
      // drag-over 클래스 전체 정리
      this.mainPlEl && this.mainPlEl.querySelectorAll('.drag-over').forEach(e => e.classList.remove('drag-over'));
      this.playlistEl && this.playlistEl.querySelectorAll('.drag-over').forEach(e => e.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const from = this.dragFromIdx;
      const to   = idx;
      if (from === null || from === to) return;

      // 플레이리스트 배열 재정렬
      const [moved] = this.playlist.splice(from, 1);
      this.playlist.splice(to, 0, moved);

      // broken 집합 인덱스 재조정
      const newBroken = new Set();
      this.brokenTracks.forEach(bi => {
        let ni = bi;
        if (bi === from)         ni = to;
        else if (from < bi && bi <= to) ni = bi - 1;
        else if (to <= bi && bi < from) ni = bi + 1;
        newBroken.add(ni);
      });
      this.brokenTracks = newBroken;

      // currentIdx 보정 (현재 재생 트랙이 이동됐을 때)
      if (this.currentIdx === from) this.currentIdx = to;
      else if (from < this.currentIdx && this.currentIdx <= to) this.currentIdx--;
      else if (to <= this.currentIdx && this.currentIdx < from) this.currentIdx++;

      this.dragFromIdx = null;
      onReorder();
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     재생 로직
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _playTrack(idx)
     지정된 인덱스의 트랙을 로드하고 재생합니다.
     AudioContext는 유지하고 MediaElementSourceNode만 재연결합니다.
     @param {number} idx - 재생할 트랙 인덱스
  ───────────────────────────────────────────────────────────────── */
  _playTrack(idx) {
    if (idx < 0 || idx >= this.playlist.length) return;

    // 현재 재생/애니메이션 중단
    this.aud.pause();
    cancelAnimationFrame(this.animId);

    this.currentIdx = idx;

    // 새 Audio 요소 생성 (이전 URL 해제는 GC에 맡김)
    const currentVol = this.aud.volume; // 볼륨 유지
    this.aud = new Audio(URL.createObjectURL(this.playlist[idx]));
    this.aud.volume = currentVol;

    // AudioContext는 null로 초기화하지 않습니다
    // → _reconnectAudio()에서 기존 AudioContext를 재사용합니다
    this.sourceNode = null; // 이전 소스 노드 참조만 제거

    this._bindAudioEvents();
    this._renderPlaylist();
    this._renderMainPlaylist();
    this._updateInfoTab();
    this._startPlay();
  }

  /* ─────────────────────────────────────────────────────────────────
     _nextTrack()
     현재 트랙이 끝났을 때 호출됩니다.
     - 다음 트랙이 있으면 → 재생
     - 마지막 트랙이고 autoRepeat ON → 처음으로 돌아가 재생
     - 마지막 트랙이고 autoRepeat OFF → 정지
     broken 트랙은 건너뜁니다.
  ───────────────────────────────────────────────────────────────── */
  _nextTrack() {
    // broken이 아닌 다음 트랙 찾기
    let next = this.currentIdx + 1;
    while (next < this.playlist.length && this.brokenTracks.has(next)) next++;

    if (next < this.playlist.length) {
      // 다음 유효한 트랙 재생
      this._playTrack(next);
    } else if (this.autoRepeat) {
      // 자동반복: 플레이리스트 처음으로 돌아가기
      let first = 0;
      while (first < this.playlist.length && this.brokenTracks.has(first)) first++;
      if (first < this.playlist.length) this._playTrack(first);
    } else {
      // 마지막 트랙 종료 + 반복 없음 → 정지
      cancelAnimationFrame(this.animId);
      if (this.playBtn)   this.playBtn.textContent = '▶';
      if (this.idleEl)    this.idleEl.style.display = 'flex';
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _bindAudioEvents()
     현재 this.aud에 오디오 이벤트를 연결합니다.
     트랙이 바뀔 때마다 새로운 this.aud에 다시 연결해야 합니다.
  ───────────────────────────────────────────────────────────────── */
  _bindAudioEvents() {
    // 재생 종료 → 다음 트랙으로
    this.aud.addEventListener('ended', () => this._nextTrack());

    // 진행 바 및 시간 표시 업데이트
    this.aud.addEventListener('timeupdate', () => {
      if (!this.aud.duration) return;
      if (this.fillEl)
        this.fillEl.style.width = `${(this.aud.currentTime / this.aud.duration) * 100}%`;
      if (this.timeDisp)
        this.timeDisp.textContent = `${fmtTime(this.aud.currentTime)} / ${fmtTime(this.aud.duration)}`;
    });

    // 메타데이터 로드 완료 → 재생 시간 표시 업데이트
    this.aud.addEventListener('loadedmetadata', () => {
      if (this.timeDisp)
        this.timeDisp.textContent = `00:00 / ${fmtTime(this.aud.duration)}`;
      this._updateInfoTab();
    });

    // 재생 오류 → broken 표시 후 다음 트랙으로 스킵
    this.aud.addEventListener('error', () => {
      console.warn(`[AudioVisualizer] 트랙 ${this.currentIdx} 재생 오류: ${this.playlist[this.currentIdx]?.name}`);
      this.brokenTracks.add(this.currentIdx); // ✕ 마킹
      this._renderPlaylist();
      this._renderMainPlaylist();
      // 300ms 후 다음 트랙 시도 (연속 오류 방지)
      setTimeout(() => this._nextTrack(), 300);
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     _reconnectAudio()
     AudioContext를 재사용하면서 현재 Audio 요소에 새 소스 노드를 연결합니다.
     트랙 전환 시마다 AudioContext를 새로 만들지 않아 브라우저 제한을 피합니다.
  ───────────────────────────────────────────────────────────────── */
  _reconnectAudio() {
    // AudioContext는 처음 한 번만 생성 (이후 재사용)
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser  = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024; // 주파수 빈 512개, 파형 빈 1024개
      this.analyser.connect(this.audioCtx.destination);
    }

    // 이전 소스 노드 연결 해제 (메모리 누수 방지)
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) { /* 이미 해제됨 */ }
      this.sourceNode = null;
    }

    // 현재 Audio 요소에 대한 새 MediaElementSourceNode 생성
    try {
      this.sourceNode = this.audioCtx.createMediaElementSource(this.aud);
      this.sourceNode.connect(this.analyser);
    } catch (e) {
      console.warn('[AudioVisualizer] 소스 노드 연결 실패:', e);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _startPlay()
     오디오를 재생하고 비주얼라이저 루프를 시작합니다.
     브라우저 자동재생 정책에 대응하기 위해 await를 사용합니다.
  ───────────────────────────────────────────────────────────────── */
  async _startPlay() {
    this._reconnectAudio();
    try {
      await this.audioCtx.resume(); // suspended 상태 해제
      await this.aud.play();        // 재생 시작 (자동재생 거부 시 catch로)
      if (this.idleEl)  this.idleEl.style.display = 'none';
      if (this.playBtn) this.playBtn.textContent = '⏸';
      this._drawLoop();
    } catch (e) {
      console.warn('[AudioVisualizer] 재생 실패:', e);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _stopPlay()
     오디오를 일시정지하고 애니메이션을 멈춥니다.
  ───────────────────────────────────────────────────────────────── */
  _stopPlay() {
    this.aud.pause();
    cancelAnimationFrame(this.animId);
    if (this.playBtn) this.playBtn.textContent = '▶';
  }

  /* ─────────────────────────────────────────────────────────────────
     _togglePlay()
     캔버스 클릭 시 호출. 패널이 열려있으면 무시합니다.
  ───────────────────────────────────────────────────────────────── */
  _togglePlay() {
    if (this.panelOpen) return;
    this.aud.paused ? this._startPlay() : this._stopPlay();
  }

  /* ─────────────────────────────────────────────────────────────────
     _toggleRepeat()
     자동반복 ON/OFF를 전환합니다.
     ON 상태: 마지막 트랙 종료 시 처음 트랙으로 돌아가 반복
  ───────────────────────────────────────────────────────────────── */
  _toggleRepeat() {
    this.autoRepeat = !this.autoRepeat;

    /* ── 시각적 상태 업데이트 ──────────────────────────────────────
       repeat-on 클래스: CSS에서 테두리·글로우·색상을 ON/OFF로 전환
       레이블 텍스트   : "OFF" ↔ "ON" 으로 즉시 변경
    ────────────────────────────────────────────────────────────── */
    this.repeatBtn.classList.toggle('repeat-on', this.autoRepeat);

    /* .repeat-label span 의 텍스트를 상태에 맞게 업데이트 */
    const label = this.repeatBtn.querySelector('.repeat-label');
    if (label) label.textContent = this.autoRepeat ? 'ON' : 'OFF';

    /* title 툴팁도 현재 상태와 다음 동작을 명확히 안내 */
    this.repeatBtn.title = this.autoRepeat
      ? '자동반복 ON — 마지막 곡 후 처음으로 돌아와 반복합니다. 클릭하면 꺼집니다'
      : '자동반복 OFF — 마지막 곡 후 정지합니다. 클릭하면 켜집니다';
  }

  /* ─────────────────────────────────────────────────────────────────
     _toggleFullscreen()
     플레이어를 전체화면으로 확장하거나 원래 크기로 복원합니다.
  ───────────────────────────────────────────────────────────────── */
  _toggleFullscreen() {
    this.playerEl.classList.toggle('player-fs');
    const isFs = this.playerEl.classList.contains('player-fs');
    document.body.style.overflow = isFs ? 'hidden' : '';
    // 전체화면 전환 후 캔버스 해상도 재조정
    setTimeout(() => {
      const w = this.canvas.offsetWidth  || 600;
      const h = this.canvas.offsetHeight || 220;
      this.canvas.width  = w;
      this.canvas.height = h;
      this.sgCanvas.width  = w;
      this.sgCanvas.height = h;
    }, 60);
  }

  /* ═══════════════════════════════════════════════════════════════
     메인 드로잉 루프
     활성화된 소스·이펙트 조합을 매 프레임 레이어 순서로 렌더링합니다.
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _drawLoop()
     requestAnimationFrame 기반 메인 렌더 루프.
     각 프레임: 주파수 데이터 읽기 → 공유 메트릭 계산 → 이펙트 레이어 렌더링
  ───────────────────────────────────────────────────────────────── */
  _drawLoop() {
    cancelAnimationFrame(this.animId); // 이전 루프 확실히 중단
    const analyser = this.analyser;
    const freqBuf  = new Uint8Array(analyser.frequencyBinCount); // 512개 주파수 빈
    const timeBuf  = new Uint8Array(analyser.fftSize);           // 1024개 파형 샘플

    const draw = () => {
      this.animId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(freqBuf);  // 최신 주파수 데이터
      analyser.getByteTimeDomainData(timeBuf); // 최신 파형 데이터

      const W = this.canvas.width, H = this.canvas.height;
      const ctx = this.ctx2d;

      /* ── 공유 메트릭 계산 ────────────────────────── */

      // RMS 볼륨 (0~1): 모든 주파수 빈의 에너지 제곱합 평균의 제곱근
      let sum = 0;
      for (let i = 0; i < freqBuf.length; i++) sum += freqBuf[i] * freqBuf[i];
      const rms = Math.sqrt(sum / freqBuf.length) / 255;
      // 부드러운 보간 (급격한 변화 완화, 0.12 = 보간 속도)
      this.smoothVolume += (rms - this.smoothVolume) * 0.12;

      // 비트 감지: 저음 대역(하위 10%) 에너지가 이전 프레임 대비 35% 이상 상승하면 비트
      const bassEnd = Math.floor(freqBuf.length * 0.1);
      let bass = 0;
      for (let i = 0; i < bassEnd; i++) bass += freqBuf[i];
      bass /= bassEnd;
      this.isBeatNow = bass > this.lastBassEnergy * 1.35 && bass > 72 && this.beatCooldown <= 0;
      this.lastBassEnergy = bass;
      if (this.beatCooldown > 0) this.beatCooldown--;
      if (this.isBeatNow) { this.beatCooldown = 10; this.beatFlash = 1.0; }
      this.beatFlash *= 0.75; // 플래시 감쇠 (매 프레임 75%로 줄어듦)

      /* ── 배경: 잔상 효과 ─────────────────────────── */
      // 완전히 지우지 않고 반투명으로 덮어 이전 프레임이 희미하게 남음
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(0, 0, W, H);

      /* ── 모두 해제 상태: 사운드 정보 텍스트 표시 ── */
      const anyOn = ['freq','volume','beat','wave'].some(s =>
        ['barSpectrum','oscilloscope','circularSpectrum','particles','spectrogram','volumeEffect']
          .some(e => this.options[s][e]));
      if (!anyOn) { this._drawInfoText(ctx, W, H); return; }

      const o = this.options;

      /* ── 이펙트 레이어 렌더링 순서 ──────────────── */
      /* (1) 배경 색상 효과 — 가장 아래 레이어 */
      if (o.freq.volumeEffect)   this._fx_vfx_freq(ctx, W, H, freqBuf);
      if (o.volume.volumeEffect) this._fx_vfx_volume(ctx, W, H);
      if (o.beat.volumeEffect)   this._fx_vfx_beat(ctx, W, H);
      if (o.wave.volumeEffect)   this._fx_vfx_wave(ctx, W, H, timeBuf);

      /* (2) 스펙트로그램 — 배경 위에 깔리는 히트맵 */
      if (o.freq.spectrogram || o.volume.spectrogram || o.beat.spectrogram || o.wave.spectrogram)
        this._fx_spectrogram(ctx, W, H, freqBuf, timeBuf);

      /* (3) 원형 스펙트럼 */
      if (o.freq.circularSpectrum)   this._fx_circ_freq(ctx, W, H, freqBuf);
      if (o.volume.circularSpectrum) this._fx_circ_volume(ctx, W, H);
      if (o.beat.circularSpectrum)   this._fx_circ_beat(ctx, W, H);
      if (o.wave.circularSpectrum)   this._fx_circ_wave(ctx, W, H, timeBuf);

      /* (4) 막대 스펙트럼 */
      if (o.freq.barSpectrum)   this._fx_bar_freq(ctx, W, H, freqBuf);
      if (o.volume.barSpectrum) this._fx_bar_volume(ctx, W, H);
      if (o.beat.barSpectrum)   this._fx_bar_beat(ctx, W, H, freqBuf);
      if (o.wave.barSpectrum)   this._fx_bar_wave(ctx, W, H, timeBuf);

      /* (5) 파형 오실로스코프 */
      if (o.freq.oscilloscope)   this._fx_osc_freq(ctx, W, H, freqBuf);
      if (o.volume.oscilloscope) this._fx_osc_volume(ctx, W, H, timeBuf);
      if (o.beat.oscilloscope)   this._fx_osc_beat(ctx, W, H, timeBuf);
      if (o.wave.oscilloscope)   this._fx_osc_wave(ctx, W, H, timeBuf);

      /* (6) 파티클 — 최상단 레이어 */
      if (o.freq.particles)   this._spawn_freq(W, H, freqBuf);
      if (o.volume.particles) this._spawn_volume(W, H);
      if (o.beat.particles)   this._spawn_beat(W, H, freqBuf);
      if (o.wave.particles)   this._spawn_wave(W, H, timeBuf);
      this._drawParticles(ctx);
    };

    draw(); // 루프 시작
  }

  /* ─────────────────────────────────────────────────────────────────
     _drawInfoText(ctx, W, H)
     모두 해제 상태일 때 캔버스에 현재 사운드 정보를 텍스트로 표시합니다.
  ───────────────────────────────────────────────────────────────── */
  _drawInfoText(ctx, W, H) {
    const f = this.playlist[this.currentIdx];
    if (!f) return;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Fira Code", monospace';
    ctx.fillStyle = '#00ff41';
    ctx.shadowBlur = 8; ctx.shadowColor = '#00ff41';
    ctx.fillText(f.name, W / 2, H / 2 - 18);
    ctx.shadowBlur = 0;
    ctx.font = '11px "Fira Code", monospace';
    ctx.fillStyle = '#007f21';
    ctx.fillText(`${(f.size / 1024).toFixed(1)} KB  |  ${f.type || 'audio'}`, W / 2, H / 2 + 2);
    if (this.aud.duration) ctx.fillText(fmtTime(this.aud.duration), W / 2, H / 2 + 20);
    ctx.textAlign = 'left';
  }

  /* ═══════════════════════════════════════════════════════════════
     이펙트 렌더러 — 볼륨 기반 효과 (volumeEffect)
     배경 전체를 색상이나 빛으로 물들이는 효과입니다.
  ═══════════════════════════════════════════════════════════════ */

  // 주파수 도미넌트 → 배경 색조 변화
  _fx_vfx_freq(ctx, W, H, buf) {
    let peak = 0, pi = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] > peak) { peak = buf[i]; pi = i; }
    ctx.fillStyle = `hsla(${(pi / buf.length) * 240},100%,50%,${(peak / 255) * 0.13})`;
    ctx.fillRect(0, 0, W, H);
  }

  // RMS 볼륨 → 중앙 방사형 녹색 글로우 (볼륨이 클수록 원이 커짐)
  _fx_vfx_volume(ctx, W, H) {
    const r = this.smoothVolume * H * 0.85;
    if (r < 1) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
    g.addColorStop(0, `rgba(0,255,65,${this.smoothVolume * 0.2})`);
    g.addColorStop(1, 'rgba(0,255,65,0)');
    ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
  }

  // 비트 → 화면 전체 흰색 플래시
  _fx_vfx_beat(ctx, W, H) {
    if (this.beatFlash < 0.02) return;
    ctx.fillStyle = `rgba(255,255,255,${this.beatFlash * 0.08})`;
    ctx.fillRect(0, 0, W, H);
  }

  // 파형 에너지 → 청록색 배경 맥동
  _fx_vfx_wave(ctx, W, H, buf) {
    let avg = 0;
    for (let i = 0; i < buf.length; i++) avg += Math.abs(buf[i] - 128);
    ctx.fillStyle = `rgba(0,200,255,${(avg / buf.length / 128) * 0.12})`;
    ctx.fillRect(0, 0, W, H);
  }

  /* ═══════════════════════════════════════════════════════════════
     이펙트 렌더러 — 스펙트로그램 (scrolling heatmap)
     시간 축(x) × 주파수 축(y) 으로 에너지를 색상으로 표현합니다.
     오프스크린 캔버스에 매 프레임 새 열을 추가하고 왼쪽으로 스크롤합니다.
  ═══════════════════════════════════════════════════════════════ */
  _fx_spectrogram(ctx, W, H, freqBuf, timeBuf) {
    const sg  = this.sgCtx;
    const sgW = this.sgCanvas.width;
    const sgH = this.sgCanvas.height;

    // 기존 내용을 한 픽셀 왼쪽으로 복사 (시간 흐름 표현)
    const img = sg.getImageData(1, 0, sgW - 1, sgH);
    sg.putImageData(img, 0, 0);
    sg.clearRect(sgW - 1, 0, 1, sgH);

    // 오른쪽 끝 열에 현재 프레임의 주파수/파형 데이터 그리기
    const o = this.options;
    for (let i = 0; i < freqBuf.length; i++) {
      const y  = sgH - 1 - Math.floor((i / freqBuf.length) * sgH);
      const vF = freqBuf[i] / 255;
      const vT = Math.abs(timeBuf[i] - 128) / 128;
      let r = 0, g = 0, b = 0, a = 0;
      if (o.freq.spectrogram) {
        const [rr, gg, bb] = this._hsl((i / freqBuf.length) * 240, 100, 50);
        r += rr * vF; g += gg * vF; b += bb * vF; a = Math.max(a, vF);
      }
      if (o.volume.spectrogram) { g += vF * 220; b += vF * 180; a = Math.max(a, vF * 0.8); }
      if (o.beat.spectrogram && this.isBeatNow) { r += 255; g += 255; b += 255; a = Math.max(a, 0.6); }
      if (o.wave.spectrogram) { r += vT * 180; g += vT * 255; b += vT * 180; a = Math.max(a, vT * 0.7); }
      if (a > 0.01) {
        sg.fillStyle = `rgba(${Math.min(255, r | 0)},${Math.min(255, g | 0)},${Math.min(255, b | 0)},${a})`;
        sg.fillRect(sgW - 1, y, 1, 1);
      }
    }

    // 오프스크린 캔버스를 메인 캔버스에 합성
    ctx.drawImage(this.sgCanvas, 0, 0, W, H);
  }

  // HSL → RGB 변환 헬퍼 (스펙트로그램 색상 계산에 사용)
  _hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  /* ═══════════════════════════════════════════════════════════════
     이펙트 렌더러 — 원형 스펙트럼 (circularSpectrum)
     막대나 파형을 원형으로 배치합니다.
  ═══════════════════════════════════════════════════════════════ */

  // 주파수 → 원형 배치 막대 (DJ 비주얼라이저 스타일)
  _fx_circ_freq(ctx, W, H, buf) {
    const cx = W / 2, cy = H / 2, baseR = Math.min(W, H) * 0.22;
    const n = Math.min(buf.length, 180);
    for (let i = 0; i < n; i++) {
      const v = buf[i] / 255;
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const len = v * baseR * 1.3;
      const hu = (i / n) * 240;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * baseR, cy + Math.sin(ang) * baseR);
      ctx.lineTo(cx + Math.cos(ang) * (baseR + len), cy + Math.sin(ang) * (baseR + len));
      ctx.strokeStyle = `hsla(${hu},100%,60%,${0.4 + v * 0.6})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = v > 0.3 ? 6 : 0; ctx.shadowColor = `hsl(${hu},100%,60%)`;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // 볼륨 → 반지름이 볼륨에 비례하는 맥동 링
  _fx_circ_volume(ctx, W, H) {
    const r = 30 + this.smoothVolume * Math.min(W, H) * 0.4;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,255,65,${0.2 + this.smoothVolume * 0.7})`;
    ctx.lineWidth = 1.5 + this.smoothVolume * 4;
    ctx.shadowBlur = 12; ctx.shadowColor = '#00ff41'; ctx.stroke(); ctx.shadowBlur = 0;
  }

  // 비트 → 비트마다 밖으로 확장하는 동심원 파동
  _fx_circ_beat(ctx, W, H) {
    if (this.beatFlash < 0.05) return;
    const r = (1 - this.beatFlash) * Math.min(W, H) * 0.6;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${this.beatFlash * 0.7})`;
    ctx.lineWidth = 2; ctx.shadowBlur = 16; ctx.shadowColor = '#fff';
    ctx.stroke(); ctx.shadowBlur = 0;
  }

  // 파형 → 원형으로 매핑된 오실로스코프 링
  _fx_circ_wave(ctx, W, H, buf) {
    const cx = W / 2, cy = H / 2, baseR = Math.min(W, H) * 0.2;
    ctx.beginPath();
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] / 128 - 1) * baseR * 0.6;
      const ang = (i / buf.length) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(ang) * (baseR + v);
      const y = cy + Math.sin(ang) * (baseR + v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,255,200,0.6)'; ctx.lineWidth = 1.5;
    ctx.shadowBlur = 8; ctx.shadowColor = '#00ffc8'; ctx.stroke(); ctx.shadowBlur = 0;
  }

  /* ═══════════════════════════════════════════════════════════════
     이펙트 렌더러 — 막대 스펙트럼 (barSpectrum)
  ═══════════════════════════════════════════════════════════════ */

  // 주파수 → 하단에서 솟아오르는 색상 막대 (저음=빨강, 고음=파랑)
  _fx_bar_freq(ctx, W, H, buf) {
    const n = buf.length, bW = (W / n) * 1.5;
    for (let i = 0; i < n; i++) {
      const v = buf[i] / 255; if (v < 0.02) continue;
      const bH = v * H * 0.85, x = (i / n) * W, hu = (i / n) * 240;
      ctx.shadowBlur = bH > 12 ? 8 : 0; ctx.shadowColor = `hsl(${hu},100%,55%)`;
      ctx.fillStyle = `hsla(${hu},100%,52%,${0.45 + v * 0.55})`;
      ctx.fillRect(x, H - bH, bW - 1, bH);
    }
    ctx.shadowBlur = 0;
  }

  // 볼륨 → 모든 막대가 동일한 높이로 맥동 (녹색)
  _fx_bar_volume(ctx, W, H) {
    const n = 48, bW = W / n, bH = this.smoothVolume * H * 0.9;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(0,255,65,${(0.3 + (i % 2) * 0.2) * this.smoothVolume * 2})`;
      ctx.fillRect(i * bW, H - bH, bW - 2, bH);
    }
  }

  // 비트 → 비트에 반응해 막대가 순간 플래시
  _fx_bar_beat(ctx, W, H, buf) {
    if (this.beatFlash < 0.05) return;
    const n = buf.length, bW = (W / n) * 1.5;
    for (let i = 0; i < n; i++) {
      const bH = (buf[i] / 255) * H * this.beatFlash;
      ctx.fillStyle = `rgba(255,255,255,${this.beatFlash * 0.8})`;
      ctx.fillRect((i / n) * W, H - bH, bW - 1, bH);
    }
  }

  // 파형 → 시간 도메인 진폭을 막대로 표현 (청록색)
  _fx_bar_wave(ctx, W, H, buf) {
    const n = buf.length, bW = W / n;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf[i] - 128) / 128; if (v < 0.02) continue;
      ctx.fillStyle = `rgba(0,220,255,${0.3 + v * 0.5})`;
      ctx.fillRect(i * bW, H - v * H * 0.85, bW - 1, v * H * 0.85);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     이펙트 렌더러 — 파형 오실로스코프 (oscilloscope)
     선 그래프로 소리의 모양을 직접 표시합니다.
  ═══════════════════════════════════════════════════════════════ */

  // 주파수 → FFT 크기를 매끄러운 곡선으로 (주황 네온)
  _fx_osc_freq(ctx, W, H, buf) {
    const n = buf.length; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = H - (buf[i] / 255) * H * 0.9;
      i === 0 ? ctx.moveTo((i / n) * W, y) : ctx.lineTo((i / n) * W, y);
    }
    ctx.strokeStyle = 'rgba(255,128,0,0.7)'; ctx.lineWidth = 1.5;
    ctx.shadowBlur = 6; ctx.shadowColor = '#ff8000'; ctx.stroke(); ctx.shadowBlur = 0;
  }

  // 볼륨 → 선폭·투명도가 볼륨에 비례하는 녹색 파형
  _fx_osc_volume(ctx, W, H, buf) {
    const n = buf.length; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = ((buf[i] / 128) - 1) * H * 0.38 + H / 2;
      i === 0 ? ctx.moveTo((i / n) * W, y) : ctx.lineTo((i / n) * W, y);
    }
    ctx.strokeStyle = `rgba(0,255,65,${0.4 + this.smoothVolume * 0.6})`;
    ctx.lineWidth = 1 + this.smoothVolume * 4;
    ctx.shadowBlur = 8 + this.smoothVolume * 12; ctx.shadowColor = '#00ff41';
    ctx.stroke(); ctx.shadowBlur = 0;
  }

  // 비트 → 비트마다 진폭이 폭발적으로 증가하는 빨간 파형
  _fx_osc_beat(ctx, W, H, buf) {
    const amp = 0.38 + this.beatFlash * 0.5, n = buf.length; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = ((buf[i] / 128) - 1) * H * amp + H / 2;
      i === 0 ? ctx.moveTo((i / n) * W, y) : ctx.lineTo((i / n) * W, y);
    }
    ctx.strokeStyle = `rgba(255,50,50,${0.3 + this.beatFlash * 0.7})`;
    ctx.lineWidth = 1.5 + this.beatFlash * 3;
    ctx.shadowBlur = this.beatFlash * 20; ctx.shadowColor = '#ff3232';
    ctx.stroke(); ctx.shadowBlur = 0;
  }

  // 파형 → 클래식 초록 네온 오실로스코프 (기본 파형)
  _fx_osc_wave(ctx, W, H, buf) {
    const n = buf.length; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = ((buf[i] / 128) - 1) * H * 0.4 + H / 2;
      i === 0 ? ctx.moveTo((i / n) * W, y) : ctx.lineTo((i / n) * W, y);
    }
    ctx.strokeStyle = '#00ff41'; ctx.lineWidth = 2;
    ctx.shadowBlur = 10; ctx.shadowColor = '#00ff41'; ctx.stroke(); ctx.shadowBlur = 0;
  }

  /* ═══════════════════════════════════════════════════════════════
     이펙트 렌더러 — 파티클 효과 (particles)
     입자가 흩날리거나 폭발하는 효과입니다.
  ═══════════════════════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────────────────────────
     _spawnP(W, H, n, opts)
     파티클을 n개 생성해 this.particles에 추가합니다.
     @param {number} W, H     - 캔버스 크기
     @param {number} n        - 생성할 파티클 수
     @param {Object} opts     - 옵션: {ox, oy, spd, sVar, hue, r, radial}
  ───────────────────────────────────────────────────────────────── */
  _spawnP(W, H, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const ang = opts.radial ? (Math.PI * 2 * i / n) : Math.random() * Math.PI * 2;
      const spd = (opts.spd || 2) + Math.random() * (opts.sVar || 2);
      this.particles.push({
        x: opts.ox ?? W / 2,      // 발생 X 좌표
        y: opts.oy ?? H / 2,      // 발생 Y 좌표
        vx: Math.cos(ang) * spd,  // X 속도
        vy: Math.sin(ang) * spd,  // Y 속도
        life:  1.0,                // 수명 (0~1)
        decay: 0.022 + Math.random() * 0.03, // 수명 감소 속도
        r:     (opts.r || 2) + Math.random() * 2, // 반지름
        hue:   opts.hue ?? Math.random() * 360,   // 색상 Hue
      });
    }
  }

  // 주파수 고에너지 대역에서 파티클 방출
  _spawn_freq(W, H, buf) {
    [{ s: 0.5, e: 0.7, h: 200 }, { s: 0.7, e: 0.85, h: 260 }, { s: 0.85, e: 1, h: 300 }]
      .forEach(b => {
        const si = Math.floor(b.s * buf.length), ei = Math.floor(b.e * buf.length);
        let sm = 0; for (let i = si; i < ei; i++) sm += buf[i];
        const avg = sm / (ei - si) / 255;
        if (avg > 0.5 && Math.random() < avg * 0.3)
          this._spawnP(W, H, 1, { ox: (si / buf.length + Math.random() * 0.15) * W, oy: H * 0.8, spd: 1.5, sVar: 2, hue: b.h, r: 1.5 });
      });
  }

  // 볼륨에 비례한 연속 파티클 (아래에서 위로 떠오름)
  _spawn_volume(W, H) {
    if (this.smoothVolume < 0.05) return;
    const cnt = Math.floor(this.smoothVolume * 4);
    for (let i = 0; i < cnt; i++) {
      this._spawnP(W, H, 1, { ox: Math.random() * W, oy: H + 5, spd: 1 + this.smoothVolume * 2, sVar: 1.5, hue: 90 + Math.random() * 60, r: 1.5 });
      // 생성된 파티클의 Y 속도를 위쪽으로 설정
      if (this.particles.length > 0) {
        const p = this.particles[this.particles.length - 1];
        p.vy = -(Math.abs(p.vy) + 1);
      }
    }
  }

  // 비트 → 중앙에서 사방으로 폭발하는 파티클
  _spawn_beat(W, H, buf) {
    if (!this.isBeatNow) return;
    this._spawnP(W, H, 18 + Math.floor((buf[0] / 255) * 22), {
      radial: true, spd: 2, sVar: 3.5,
      hue: Math.random() < 0.5 ? Math.random() * 60 : 200 + Math.random() * 60, r: 2.5,
    });
  }

  // 파형 피크에서 파티클 방출 (파형의 산 꼭대기)
  _spawn_wave(W, H, buf) {
    for (let i = 1; i < buf.length - 1; i++) {
      const v = (buf[i] / 128) - 1;
      if (v > 0.7 && buf[i] > buf[i - 1] && buf[i] > buf[i + 1] && Math.random() < 0.15)
        this._spawnP(W, H, 2, { ox: (i / buf.length) * W, oy: H / 2 - v * H * 0.4, spd: 0.8, sVar: 1.5, hue: 180, r: 1.5 });
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     _drawParticles(ctx)
     모든 파티클을 그리고, 매 프레임 위치·수명을 업데이트합니다.
     수명이 0 이하인 파티클은 제거합니다.
  ───────────────────────────────────────────────────────────────── */
  _drawParticles(ctx) {
    // 수명이 0 이하인 파티클을 먼저 제거합니다
    this.particles = this.particles.filter(p => p.life > 0);

    for (const p of this.particles) {
      /* 위치 업데이트 */
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.05; // 중력 (아래로 가속)

      /* 수명 감소 — 이 시점에서 p.life 가 음수가 될 수 있음 */
      p.life -= p.decay;

      /* ── 버그 수정: life 감소 후 0 이하이면 arc() 호출 건너뜀 ──
         canvas arc()는 음수 radius 를 허용하지 않아 IndexSizeError 발생.
         Math.max(0, ...) 로 최솟값을 보장하되, 이미 사라진 파티클은
         그리지 않아 불필요한 fill() 비용도 줄입니다.            */
      const radius = p.r * p.life;
      if (radius <= 0) continue; // 수명이 다한 파티클은 이번 프레임 스킵

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle   = `hsla(${p.hue},100%,65%,${Math.max(0, p.life)})`;
      ctx.shadowColor = `hsl(${p.hue},100%,65%)`;
      ctx.shadowBlur  = 6;
      ctx.fill();
    }

    ctx.shadowBlur = 0; // shadowBlur 리셋 (다음 그리기에 영향 방지)
  }

  /* ─────────────────────────────────────────────────────────────────
     mount()
     터미널 출력 영역에 플레이어를 삽입합니다.
     AudioVisualizer를 생성한 뒤 반드시 호출해야 합니다.
  ───────────────────────────────────────────────────────────────── */
  mount() {
    appendText(`guest@system:~$ [file attached: ${this.playlist[0].name}]`, 'c-green', true);
    appendNode(this.wrap, false);
    scrollBottom();
  }

} // ── class AudioVisualizer 끝 ─────────────────────────────────────


/* ═══════════════════════════════════════════════════════════════════
   renderAudio(file)
   오디오 파일 렌더링 진입점 함수.
   fileInput change 이벤트에서 audio/* 파일일 때 호출됩니다.
   @param {File} file - 재생할 오디오 파일
═══════════════════════════════════════════════════════════════════ */
function renderAudio(file) {
  new AudioVisualizer(file).mount();
}
