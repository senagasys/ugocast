// ugocast.js
// --- DOM 要素 ---
let elements = {};
const startUgocast = async () => {
  // 1. HTMLテンプレートをfetch
  if (typeof ugocast_html_url !== 'undefined' && ugocast_html_url) {
    try {
      const res  = await fetch(ugocast_html_url);
      if (res.ok) {
        const html = await res.text();

        // 2. マウント先にDOMを挿入 (IDタイポの両方に対応: ugocast-mount / ugocas-mount)
        const mount = document.getElementById('ugocast-mount') || document.getElementById('ugocas-mount');
        if (mount) {
          mount.innerHTML = html;
        } else {
          console.error("うごキャスエラー: id='ugocast-mount' または id='ugocas-mount' のマウント要素が見つかりません。");
          return;
        }
      } else {
        console.error("うごキャスエラー: 埋め込みプレイヤーテンプレートの取得に失敗しました。Status:", res.status);
        return;
      }
    } catch (err) {
      console.error("うごキャスエラー: テンプレートHTMLの読み込み中にエラーが発生しました:", err);
      return;
    }
  }

  // 3. DOM確定後にinit()を呼ぶ
  init();
};

// 実行処理: すでにDOMロード完了（非同期インジェクション等）している場合は即時実行、ロード中の場合はDOMContentLoadedイベントを待つ
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startUgocast);
} else {
  startUgocast();
}

// --- Utils ---
function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds === Infinity) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- 状態管理 ---
const state = {
  isPlaying: false,
  timelineData: null,

  animationFrameId: null,
  blinkTimeoutId: null,

  lastAvatarState: 'mouth_close',
  lastExpressionState: 'default',
  lastSlideSrc: '',
  lastSubtitleText: '',

  mouthHoldTimer: 0,
  mouthHoldDuration: 0.1, // 100ms

  slideMap: {} // JSONのsrcとHTMLで指定された画像URLのマッピング
};

function validateTimeline(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid data');
  if (!data.timeline || !data.metadata) throw new Error('Missing required fields');
  return true;
}

// --- 初期化 ---
async function init() {

  elements = {
    playerWrapper: document.querySelector('.ugocast-wrapper'),
    overlayPlayBtn: document.getElementById('overlayPlayBtn'),

    // コントロール
    playBtn: document.getElementById('playBtn'),
    iconPlay: document.querySelector('.icon-play'),
    iconPause: document.querySelector('.icon-pause'),

    timeDisplay: document.getElementById('timeDisplay'),
    totalTimeDisplay: document.getElementById('totalTimeDisplay'),
    progressBar: document.getElementById('progressBar'),

    muteBtn: document.getElementById('muteBtn'),
    iconVolume: document.querySelector('.icon-volume'),
    iconMuted: document.querySelector('.icon-muted'),
    volumeBar: document.getElementById('volumeBar'),

    // プレビューエリア
    previewBg: document.getElementById('previewBg'),
    slideImage: document.getElementById('slideImage'),
    avatarBase: document.getElementById('avatarBase'),
    avatarBlink: document.getElementById('avatarBlink'),
    avatarMouth: document.getElementById('avatarMouth'),
    subtitleText: document.getElementById('subtitleText'),

    // 音声要素
    ugcAudio: document.getElementById('ugcAudio')
  };

  // 必須要素が存在するかチェック
  if (!elements.playBtn || !elements.ugcAudio) {
    console.warn("うごキャス警告: 必要なHTML要素（playBtn等）が見つからないため、初期化をスキップします。#ugocast-mount マウント要素やテンプレートHTMLが正しく読み込まれているか確認してください。");
    return;
  }

  setupEventListeners();
  startAutonomousBlinking();

  try {
    if (typeof json_url !== 'undefined' && json_url) {
      const response = await fetch(json_url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();

      // fetchは1回。取得後にバリデーション
      validateTimeline(data);
      state.timelineData = data;

      buildSlideMap();
    }

    if (typeof audio_url !== 'undefined' && audio_url) {
      elements.ugcAudio.src = audio_url;
      elements.ugcAudio.load();
    }

    initializePlayback();

  } catch (error) {
    // console.error は削除済み
    elements.subtitleText.textContent = "読み込みエラーが発生しました。";
    elements.subtitleText.style.display = 'block';
  }
}

// スライドのマッピングを作成
function buildSlideMap() {
  if (!state.timelineData || !state.timelineData.timeline || !state.timelineData.timeline.slides) return;

  // タイムラインに出現するユニークなスライドのsrcを抽出
  const uniqueSrcs = [...new Set(state.timelineData.timeline.slides.map(s => s.src))];

  // HTMLで定義された slide_images 配列とマッピング
  uniqueSrcs.forEach((src, idx) => {
    if (typeof slide_images !== 'undefined' && slide_images[idx]) {
      state.slideMap[src] = slide_images[idx];
    } else {
      // 未指定の場合は元のパスをそのまま使う
      state.slideMap[src] = src;
    }
  });
}

// --- プレイヤー設定 ---
function initializePlayback() {
  if (!state.timelineData) return;

  const meta = state.timelineData.metadata || {};
  const char = meta.character || 'c1';

  // アセットのベースパス解決
  const basePath = '/contents/images-base/ugocast/';

  elements.avatarBase.src = `${basePath}characters/${char}_base.webp`;
  elements.avatarBlink.src = `${basePath}characters/${char}_eye.webp`;
  elements.avatarMouth.src = `${basePath}characters/${char}_mouth.webp`;

  const bg = meta.bgImage || 'background1.webp';
  elements.previewBg.style.backgroundImage = `url('${basePath}bgimages/${bg}')`;

  elements.ugcAudio.onloadedmetadata = () => {
    const totalDuration = meta.totalTime || elements.ugcAudio.duration || 0;
    elements.totalTimeDisplay.textContent = formatTime(totalDuration);
    elements.progressBar.disabled = false;
    elements.playBtn.disabled = false;

    // スライドの初期表示（最初のイベントがあれば）
    syncTimeline(0);
  };
}

// --- イベントリスナー登録 ---
function setupEventListeners() {
  // 再生ボタン関連
  elements.playBtn.addEventListener('click', togglePlayback);
  elements.overlayPlayBtn.addEventListener('click', togglePlayback);
  elements.playerWrapper.addEventListener('click', (e) => {
    // ボタンやシークバー自体をクリックした場合は無視
    if (e.target.closest('.control-bar') || e.target.closest('.overlay-play-btn')) return;
    togglePlayback();
  });

  // プログレスバーのシーク
  elements.progressBar.addEventListener('input', (e) => {
    const metaTime = state.timelineData && state.timelineData.metadata ? state.timelineData.metadata.totalTime : 0;
    const totalDuration = metaTime || elements.ugcAudio.duration;
    if (totalDuration && totalDuration !== Infinity) {
      const pct = parseFloat(e.target.value);
      const targetTime = (pct / 100) * totalDuration;
      elements.ugcAudio.currentTime = targetTime;
      elements.timeDisplay.textContent = formatTime(targetTime);
      syncTimeline(targetTime);
    }
  });

  // 音量コントロール
  elements.volumeBar.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    elements.ugcAudio.volume = vol;
    updateVolumeIcon(vol);
    if (vol > 0 && elements.ugcAudio.muted) {
      elements.ugcAudio.muted = false;
    }
  });

  // ミュートトグル
  elements.muteBtn.addEventListener('click', () => {
    elements.ugcAudio.muted = !elements.ugcAudio.muted;
    if (elements.ugcAudio.muted) {
      updateVolumeIcon(0);
      elements.volumeBar.value = 0;
    } else {
      const prevVol = elements.ugcAudio.volume > 0 ? elements.ugcAudio.volume : 1;
      elements.ugcAudio.volume = prevVol;
      elements.volumeBar.value = prevVol;
      updateVolumeIcon(prevVol);
    }
  });

  // オーディオ終了時
  elements.ugcAudio.addEventListener('ended', () => {
    stopPlayback();
  });
}

function updateVolumeIcon(vol) {
  if (vol === 0 || elements.ugcAudio.muted) {
    elements.iconVolume.style.display = 'none';
    elements.iconMuted.style.display = 'inline';
  } else {
    elements.iconVolume.style.display = 'inline';
    elements.iconMuted.style.display = 'none';
  }
}

// --- まばたき（クライアントサイド自律制御） ---
function startAutonomousBlinking() {
  const triggerBlink = () => {
    elements.avatarBlink.style.opacity = 1;
    setTimeout(() => {
      elements.avatarBlink.style.opacity = 0;
    }, 150);

    const nextBlinkDelay = Math.random() * 2000 + 3000;
    state.blinkTimeoutId = setTimeout(triggerBlink, nextBlinkDelay);
  };
  state.blinkTimeoutId = setTimeout(triggerBlink, 3000);
}

// --- タイムライン同期 ---
function getActiveEvent(events, currentTime) {
  if (!events || events.length === 0) return null;
  let active = null;
  for (const ev of events) {
    if (ev.time <= currentTime) {
      active = ev;
    } else {
      break;
    }
  }
  return active;
}

function syncTimeline(currentTime) {
  if (!state.timelineData) return;
  const timeline = state.timelineData.timeline || {};

  // 1. スライド
  const activeSlide = getActiveEvent(timeline.slides, currentTime);
  if (activeSlide && activeSlide.src !== state.lastSlideSrc) {
    state.lastSlideSrc = activeSlide.src;
    const mappedSrc = state.slideMap[activeSlide.src] || activeSlide.src;
    elements.slideImage.src = mappedSrc;
    elements.slideImage.style.display = 'block';
  } else if (!activeSlide) {
    elements.slideImage.style.display = 'none';
    state.lastSlideSrc = '';
  }

  // 2. 字幕
  const activeSubtitle = getActiveEvent(timeline.subtitles, currentTime);
  if (activeSubtitle) {
    if (activeSubtitle.text !== state.lastSubtitleText) {
      state.lastSubtitleText = activeSubtitle.text;
      elements.subtitleText.textContent = activeSubtitle.text;
      elements.subtitleText.style.display = 'block';
    }
  } else {
    elements.subtitleText.textContent = "";
    elements.subtitleText.style.display = 'none';
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
    const basePath = '/contents/images-base/ugocast/';
    if (activeExpressionState === 'default') {
      elements.avatarBase.src = `${basePath}characters/${char}_base.webp`;
    } else {
      elements.avatarBase.src = `${basePath}characters/${char}_base_${activeExpressionState}.webp`;
    }
  }
}

// --- 再生ループ ---
let _lastPlaybackFrameTime = 0;
function playbackLoop(timestamp) {
  if (!state.isPlaying) return;

  if (_lastPlaybackFrameTime > 0) {
    const dt = (timestamp - _lastPlaybackFrameTime) / 1000;
    if (state.mouthHoldTimer > 0) {
      state.mouthHoldTimer = Math.max(0, state.mouthHoldTimer - dt);
    }
  }
  _lastPlaybackFrameTime = timestamp;

  const currentTime = elements.ugcAudio.currentTime;
  elements.timeDisplay.textContent = formatTime(currentTime);

  const metaTime = state.timelineData && state.timelineData.metadata ? state.timelineData.metadata.totalTime : 0;
  const totalDuration = metaTime || elements.ugcAudio.duration;
  if (totalDuration && totalDuration !== Infinity) {
    elements.progressBar.value = (currentTime / totalDuration) * 100;
  }

  syncTimeline(currentTime);
  state.animationFrameId = requestAnimationFrame(playbackLoop);
}

// --- 再生制御 ---
function togglePlayback() {
  if (state.isPlaying) {
    // 一時停止
    state.isPlaying = false;
    elements.ugcAudio.pause();

    // UI更新
    elements.iconPlay.style.display = 'inline';
    elements.iconPause.style.display = 'none';
    elements.overlayPlayBtn.classList.remove('hidden');

    if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
  } else {
    // 再生
    state.isPlaying = true;
    state.mouthHoldTimer = 0;
    _lastPlaybackFrameTime = 0;

    elements.ugcAudio.play().catch(err => {
//      console.error("Playback error:", err);
      state.isPlaying = false;
      return;
    });

    // UI更新
    elements.iconPlay.style.display = 'none';
    elements.iconPause.style.display = 'inline';
    elements.overlayPlayBtn.classList.add('hidden');

    requestAnimationFrame(playbackLoop);
  }
}

function stopPlayback() {
  state.isPlaying = false;
  elements.ugcAudio.pause();
  elements.ugcAudio.currentTime = 0;

  // UI更新
  elements.iconPlay.style.display = 'inline';
  elements.iconPause.style.display = 'none';
  elements.overlayPlayBtn.classList.remove('hidden');
  elements.progressBar.value = 0;
  elements.timeDisplay.textContent = '0:00';

  if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);

  // リセット
  state.lastAvatarState = 'mouth_close';
  state.lastExpressionState = 'default';
  elements.avatarMouth.style.opacity = 0;

  const char = (state.timelineData && state.timelineData.metadata && state.timelineData.metadata.character) || 'c1';
  const basePath = '/contents/images-base/ugocast/';
  elements.avatarBase.src = `${basePath}characters/${char}_base.webp`;

  syncTimeline(0);
}
