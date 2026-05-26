// ugc_player.js
import { formatTime } from './utils.js';

// --- 状態管理 ---
const state = {
  jsonLoaded: false,
  audioLoaded: false,
  isPlaying: false,

  timelineData: null,
  audioUrl: null,

  // アニメーションループID
  animationFrameId: null,
  blinkTimeoutId: null,

  lastAvatarState: 'mouth_close',
  lastExpressionState: 'default',
  lastSlideSrc: '',
  lastSubtitleText: '',

  // 口パクのホールドタイマー（秒）：mouth_openになったら最低この時間は閉じない
  mouthHoldTimer: 0,
  mouthHoldDuration: 0.1 // 100ms
};

// --- DOM 要素 ---
const elements = {
  // インポーター
  importZone: document.getElementById('importZone'),
  fileInput: document.getElementById('fileInput'),
  jsonDot: document.getElementById('jsonDot'),
  audioDot: document.getElementById('audioDot'),
  jsonFileName: document.getElementById('jsonFileName'),
  audioFileName: document.getElementById('audioFileName'),
  loadBtn: document.getElementById('loadBtn'),

  // メタデータ
  metaChar: document.getElementById('metaChar'),
  metaPitch: document.getElementById('metaPitch'),
  metaDuration: document.getElementById('metaDuration'),
  metaEvents: document.getElementById('metaEvents'),

  // 再生コントロール
  timeDisplay: document.getElementById('timeDisplay'),
  totalTimeDisplay: document.getElementById('totalTimeDisplay'),
  progressBar: document.getElementById('progressBar'),
  playBtn: document.getElementById('playBtn'),
  stopBtn: document.getElementById('stopBtn'),

  // プレビューエリア
  previewArea: document.getElementById('previewArea'),
  previewBg: document.getElementById('previewBg'),
  slideImage: document.getElementById('slideImage'),
  avatarBase: document.getElementById('avatarBase'),
  avatarBlink: document.getElementById('avatarBlink'),
  avatarMouth: document.getElementById('avatarMouth'),
  subtitleText: document.getElementById('subtitleText'),

  // 音声要素
  ugcAudio: document.getElementById('ugcAudio')
};

// --- 初期化 ---
function init() {
  setupEventListeners();
  startAutonomousBlinking();
}

// --- イベントリスナー登録 ---
function setupEventListeners() {
  // ドラッグ＆ドロップ
  elements.importZone.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', handleFileSelect);

  elements.importZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.importZone.classList.add('dragover');
  });

  elements.importZone.addEventListener('dragleave', () => {
    elements.importZone.classList.remove('dragover');
  });

  elements.importZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.importZone.classList.remove('dragover');
    if (e.dataTransfer.files ? e.dataTransfer.files.length : 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // 初期化ボタン
  elements.loadBtn.addEventListener('click', initializePlayback);

  // プレイヤー操作
  elements.playBtn.addEventListener('click', togglePlayback);
  elements.stopBtn.addEventListener('click', stopPlayback);

  // プログレスバーのシーク
  elements.progressBar.addEventListener('input', (e) => {
    const totalDuration = (state.timelineData && state.timelineData.metadata) ? state.timelineData.metadata.totalTime : elements.ugcAudio.duration;
    if (totalDuration && totalDuration !== Infinity) {
      const pct = parseFloat(e.target.value);
      const targetTime = (pct / 100) * totalDuration;
      elements.ugcAudio.currentTime = targetTime;
      elements.timeDisplay.textContent = formatTime(targetTime);
      syncTimeline(targetTime);
    }
  });

  // オーディオ終了時
  elements.ugcAudio.addEventListener('ended', () => {
    stopPlayback();
  });
}

// --- ファイルインポート処理 ---
function handleFileSelect(e) {
  if (e.target.files ? e.target.files.length : 0) {
    handleFiles(e.target.files);
  }
}

function handleFiles(files) {
  for (const file of files) {
    if (file.name.endsWith('.json')) {
      // JSON ファイル
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          state.timelineData = JSON.parse(e.target.result);
          state.jsonLoaded = true;
          elements.jsonDot.classList.add('success');
          elements.jsonFileName.textContent = file.name;
          checkImportStatus();
        } catch (err) {
          alert("JSONファイルの解析に失敗しました。正しいフォーマットか確認してください。");
          console.error(err);
        }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith('.webm') || file.name.endsWith('.wav')) {
      // WebM / WAV 音声ファイル
      if (state.audioUrl) {
        URL.revokeObjectURL(state.audioUrl);
      }
      state.audioUrl = URL.createObjectURL(file);
      state.audioLoaded = true;
      elements.audioDot.classList.add('success');
      elements.audioFileName.textContent = file.name;
      checkImportStatus();
    }
  }
}

function checkImportStatus() {
  if (state.jsonLoaded && state.audioLoaded) {
    elements.loadBtn.disabled = false;
  }
}

// --- プレイヤー初期化 ---
function initializePlayback() {
  if (!state.timelineData || !state.audioUrl) return;

  const meta = state.timelineData.metadata || {};

  // メタデータ表示
  elements.metaChar.textContent = meta.character === 'c2' ? 'Female (C2)' : 'Male (C1)';
  elements.metaPitch.textContent = meta.pitchShift ? `+${meta.pitchShift.toFixed(1)} semitones` : 'None (Bypass)';
  elements.metaDuration.textContent = formatTime(meta.totalTime || 0);

  const eventsCount = (state.timelineData.timeline.slides ? state.timelineData.timeline.slides.length : 0) +
    (state.timelineData.timeline.subtitles ? state.timelineData.timeline.subtitles.length : 0) +
    (state.timelineData.timeline.avatar ? state.timelineData.timeline.avatar.length : 0);
  elements.metaEvents.textContent = `${eventsCount} events`;

  // アバター・背景の初期化
  const char = meta.character || 'c1';
  elements.avatarBase.src = `assets/images/character/${char}_base.webp`;
  elements.avatarBlink.src = `assets/images/character/${char}_eye.webp`;
  elements.avatarMouth.src = `assets/images/character/${char}_mouth.webp`;
  elements.avatarBlink.style.opacity = 0;
  elements.avatarMouth.style.opacity = 0;

  const bg = meta.bgImage || 'background1.webp';
  elements.previewBg.style.backgroundImage = `url('assets/images/bgimages/${bg}')`;
  elements.previewBg.style.opacity = 1;

  // 音声のセット
  elements.ugcAudio.src = state.audioUrl;
  elements.ugcAudio.load();

  // 音声がロードされたら時間表示等を更新
  elements.ugcAudio.onloadedmetadata = () => {
    // MediaRecorder の出力は duration が Infinity になることがあるため JSON の値を使用する
    const totalDuration = (state.timelineData && state.timelineData.metadata) ? state.timelineData.metadata.totalTime : (elements.ugcAudio.duration || 0);
    elements.totalTimeDisplay.textContent = formatTime(totalDuration);
    elements.progressBar.disabled = false;
    elements.playBtn.disabled = false;
    elements.stopBtn.disabled = false;
    elements.progressBar.value = 0;
    elements.timeDisplay.textContent = '00:00';

    // スライドと字幕の初期リセット
    elements.slideImage.src = 'assets/images/slide/image1.webp';
    elements.subtitleText.textContent = "Ready to play...";
  };
}

// --- まばたき（クライアントサイド自律制御） ---
function startAutonomousBlinking() {
  const triggerBlink = () => {
    // 瞬きパーツを表示
    elements.avatarBlink.style.opacity = 1;

    // 150ms後に非表示に戻す
    setTimeout(() => {
      elements.avatarBlink.style.opacity = 0;
    }, 150);

    // 次の瞬きを3〜5秒のランダム間隔でスケジュール
    const nextBlinkDelay = Math.random() * 2000 + 3000;
    state.blinkTimeoutId = setTimeout(triggerBlink, nextBlinkDelay);
  };

  state.blinkTimeoutId = setTimeout(triggerBlink, 3000);
}

// --- カレントタイムに合わせたタイムライン同期ロジック ---
function getActiveEvent(events, currentTime) {
  if (!events || events.length === 0) return null;
  let active = null;
  for (const ev of events) {
    if (ev.time <= currentTime) {
      active = ev;
    } else {
      break; // 時間順にソートされているのでブレイクしてOK
    }
  }
  return active;
}

function syncTimeline(currentTime) {
  if (!state.timelineData) return;

  const timeline = state.timelineData.timeline || {};

  // 1. スライドの同期
  const activeSlide = getActiveEvent(timeline.slides, currentTime);
  if (activeSlide && activeSlide.src !== state.lastSlideSrc) {
    state.lastSlideSrc = activeSlide.src;
    elements.slideImage.src = `assets/images/${activeSlide.src}`;
  }

  // 2. 字幕の同期
  const activeSubtitle = getActiveEvent(timeline.subtitles, currentTime);
  if (activeSubtitle) {
    if (activeSubtitle.text !== state.lastSubtitleText) {
      state.lastSubtitleText = activeSubtitle.text;
      elements.subtitleText.textContent = activeSubtitle.text;
    }
  } else {
    elements.subtitleText.textContent = "";
  }

  // 3. アバター表情（口パク ＆ 表情ステータス）の同期
  // 口パク状態と表情状態はそれぞれ直近のイベントを個別に適用する
  let activeMouthState = 'mouth_close';
  let activeExpressionState = 'default';

  if (timeline.avatar) {
    for (const ev of timeline.avatar) {
      if (ev.time <= currentTime) {
        if (ev.state === 'mouth_open' || ev.state === 'mouth_close') {
          activeMouthState = ev.state;
        } else if (['default', 'angry', 'sad', 'funny'].includes(ev.state)) {
          activeExpressionState = ev.state;
        }
      } else {
        break; // 時間順なので先は無視
      }
    }
  }

  // 口パクの適用
  if (activeMouthState === 'mouth_open') {
    if (state.lastAvatarState !== 'mouth_open') {
      state.lastAvatarState = 'mouth_open';
      elements.avatarMouth.style.opacity = 1;
    }
    state.mouthHoldTimer = state.mouthHoldDuration;
  } else {
    if (state.mouthHoldTimer <= 0 && state.lastAvatarState !== 'mouth_close') {
      state.lastAvatarState = 'mouth_close';
      elements.avatarMouth.style.opacity = 0;
    }
  }

  // 表情の適用
  if (activeExpressionState !== state.lastExpressionState) {
    state.lastExpressionState = activeExpressionState;
    const char = (state.timelineData.metadata && state.timelineData.metadata.character) || 'c1';
    if (activeExpressionState === 'default') {
      elements.avatarBase.src = `assets/images/character/${char}_base.webp`;
    } else {
      elements.avatarBase.src = `assets/images/character/${char}_base_${activeExpressionState}.webp`;
    }
  }
}

// --- 再生ループ ---
let _lastPlaybackFrameTime = 0;
function playbackLoop(timestamp) {
  if (!state.isPlaying) return;

  // ホールドタイマーのデクリメント（秒単位）
  if (_lastPlaybackFrameTime > 0) {
    const dt = (timestamp - _lastPlaybackFrameTime) / 1000;
    if (state.mouthHoldTimer > 0) {
      state.mouthHoldTimer = Math.max(0, state.mouthHoldTimer - dt);
    }
  }
  _lastPlaybackFrameTime = timestamp;

  const currentTime = elements.ugcAudio.currentTime;

  // 再生時間のUI更新
  elements.timeDisplay.textContent = formatTime(currentTime);

  // プログレスバーの更新
  const totalDuration = (state.timelineData && state.timelineData.metadata) ? state.timelineData.metadata.totalTime : elements.ugcAudio.duration;
  if (totalDuration && totalDuration !== Infinity) {
    elements.progressBar.value = (currentTime / totalDuration) * 100;
  }

  // タイムライン同期
  syncTimeline(currentTime);

  state.animationFrameId = requestAnimationFrame(playbackLoop);
}

// --- 再生/一時停止 トグル ---
function togglePlayback() {
  if (state.isPlaying) {
    // 一時停止
    state.isPlaying = false;
    elements.ugcAudio.pause();
    elements.playBtn.textContent = '▶ Play';
    elements.playBtn.className = 'btn btn-play';

    if (state.animationFrameId) {
      cancelAnimationFrame(state.animationFrameId);
    }
  } else {
    // 再生
    state.isPlaying = true;
    state.mouthHoldTimer = 0;
    _lastPlaybackFrameTime = 0;
    elements.ugcAudio.play().catch(err => {
      console.error("Audio playback error:", err);
    });
    elements.playBtn.textContent = '⏸ Pause';
    elements.playBtn.className = 'btn btn-play playing';

    requestAnimationFrame(playbackLoop);
  }
}

// --- 再生停止 ---
function stopPlayback() {
  state.isPlaying = false;
  elements.ugcAudio.pause();
  elements.ugcAudio.currentTime = 0;

  elements.playBtn.textContent = '▶ Play';
  elements.playBtn.className = 'btn btn-play';
  elements.progressBar.value = 0;
  elements.timeDisplay.textContent = '00:00';

  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
  }

  // 状態とプレビュー表示リセット
  state.lastAvatarState = 'mouth_close';
  state.lastExpressionState = 'default';
  state.lastSlideSrc = '';
  state.lastSubtitleText = '';

  elements.avatarMouth.style.opacity = 0;
  const char = (state.timelineData && state.timelineData.metadata && state.timelineData.metadata.character) || 'c1';
  elements.avatarBase.src = `assets/images/character/${char}_base.webp`;
  elements.slideImage.src = 'assets/images/slide/image1.webp';
  elements.subtitleText.textContent = "Ready to play...";
}

// 起動
document.addEventListener('DOMContentLoaded', init);
