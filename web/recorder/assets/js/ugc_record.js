// ugc_record.js
import { formatTime, logEvent } from './utils.js';

// --- 状態管理 ---
const state = {
  isRecording: false,
  isSilent: false,
  logicalTime: 0,
  lastFrameTime: 0,

  character: 'c1',
  pitchShiftValue: 5.0,
  bgImage: 'background1.webp',

  timeline: {
    slides: [],
    subtitles: [],
    avatar: []
  },

  audioChunks: [],
  mediaRecorder: null,
  analyserNode: null,
  rawSourceNode: null,
  micNode: null,
  pitchShiftNode: null,
  processingNodes: [], // cleanup用
  speechRecognition: null,

  animationFrameId: null,
  blinkTimeoutId: null,

  lastAvatarState: 'mouth_close',
  expression: 'default',
  silenceTime: 0,
  silenceThreshold: 0.008,
  silenceDelay: 1.0,
  mouthThreshold: 0.012,
  mouthHoldTimer: 0,
  lastSpeechStartTime: 0,

  slidesList: [
    'slide/image1.webp',
    'slide/image2.webp',
    'slide/image3.webp',
    'slide/image4.webp',
    'slide/image5.webp'
  ],
  currentSlideIndex: 0,
  carouselVisibleCount: 3,
  confirmedSlideSrc: 'slide/image1.webp'
};

// --- DOM 要素 ---
const elements = {
  previewBg: document.getElementById('previewBg'),
  slideImage: document.getElementById('slideImage'),
  avatarBase: document.getElementById('avatarBase'),
  avatarBlink: document.getElementById('avatarBlink'),
  avatarMouth: document.getElementById('avatarMouth'),
  subtitleText: document.getElementById('subtitleText'),
  silenceBadge: document.getElementById('silenceBadge'),

  statusIndicator: document.getElementById('statusIndicator'),
  rmsBar: document.getElementById('rmsBar'),
  charBtnC1: document.getElementById('charBtnC1'),
  charBtnC2: document.getElementById('charBtnC2'),
  voiceSettingsContainer: document.getElementById('voiceSettingsContainer'),
  pitchSlider: document.getElementById('pitchSlider'),
  pitchVal: document.getElementById('pitchVal'),
  bgSelect: document.getElementById('bgSelect'),
  carouselTrack: document.getElementById('carouselTrack'),
  prevSlideBatchBtn: document.getElementById('prevSlideBatchBtn'),
  nextSlideBatchBtn: document.getElementById('nextSlideBatchBtn'),

  timeDisplay: document.getElementById('timeDisplay'),
  progressBar: document.getElementById('progressBar'),
  recordBtn: document.getElementById('recordBtn'),
  saveBtn: document.getElementById('saveBtn'),
  eventLogList: document.getElementById('eventLogList'),
  expressionIndicator: document.getElementById('expressionIndicator')
};

// --- 初期化 ---
function init() {
  setupEventListeners();
  renderCarousel();
  applyBackground(elements.bgSelect.value);
  startAutonomousBlinking();
}

// --- イベントリスナー登録 ---
function setupEventListeners() {
  elements.charBtnC1.addEventListener('click', () => switchCharacter('c1'));
  elements.charBtnC2.addEventListener('click', () => switchCharacter('c2'));

  elements.pitchSlider.addEventListener('input', (e) => {
    state.pitchShiftValue = parseFloat(e.target.value);
    elements.pitchVal.textContent = `+${state.pitchShiftValue.toFixed(1)} semitones`;
    if (state.pitchShiftNode && state.character === 'c2') {
      state.pitchShiftNode.pitch = state.pitchShiftValue;
    }
  });

  elements.bgSelect.addEventListener('change', (e) => {
    applyBackground(e.target.value);
  });

  elements.prevSlideBatchBtn.addEventListener('click', () => moveCarousel(-1));
  elements.nextSlideBatchBtn.addEventListener('click', () => moveCarousel(1));

  elements.recordBtn.addEventListener('click', toggleRecording);
  elements.saveBtn.addEventListener('click', saveTimelineData);

  // キーボードでの表情操作イベント
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
}

// --- 背景切り替え ---
function applyBackground(bgValue) {
  state.bgImage = bgValue;
  elements.previewBg.style.opacity = 0;
  setTimeout(() => {
    elements.previewBg.style.backgroundImage = `url('assets/images/bgimages/${bgValue}')`;
    elements.previewBg.style.opacity = 1;
  }, 150);
}

// --- キャラクター切り替え ---
function switchCharacter(char) {
  if (state.isRecording) {
    alert("録音中にキャラクターを変更することはできません。");
    return;
  }

  state.character = char;

  if (char === 'c1') {
    elements.charBtnC1.classList.add('active');
    elements.charBtnC2.classList.remove('active');
    elements.voiceSettingsContainer.classList.remove('visible');
  } else {
    elements.charBtnC1.classList.remove('active');
    elements.charBtnC2.classList.add('active');
    elements.voiceSettingsContainer.classList.add('visible');
  }

  elements.avatarBase.src = `assets/images/character/${char}_base.webp`;
  elements.avatarBlink.src = `assets/images/character/${char}_eye.webp`;
  elements.avatarMouth.src = `assets/images/character/${char}_mouth.webp`;
  elements.avatarBlink.style.opacity = 0;
  elements.avatarMouth.style.opacity = 0;
}

// --- 表情の切り替え処理 ---
function updateAvatarExpression(newExpression, recordTime) {
  if (state.expression === newExpression) return;
  state.expression = newExpression;

  // UI表示更新
  if (elements.expressionIndicator) {
    elements.expressionIndicator.textContent = newExpression;
  }

  // 画像切り替え
  const char = state.character;
  if (newExpression === 'default') {
    elements.avatarBase.src = `assets/images/character/${char}_base.webp`;
  } else {
    elements.avatarBase.src = `assets/images/character/${char}_base_${newExpression}.webp`;
  }

  // 録音中ならJSONに記録
  if (state.isRecording) {
    state.timeline.avatar.push({
      time: parseFloat(recordTime.toFixed(2)),
      state: newExpression
    });
    logEvent(elements.eventLogList, "Expression", `Changed to ${newExpression}`, recordTime);
  }
}

// キーボードイベントハンドラ
function handleKeyDown(e) {
  // テキスト入力等にフォーカスがある場合はキーイベントを無視
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA')) {
    return;
  }

  const recordTime = state.logicalTime;
  const key = e.key.toLowerCase();
  
  if (key === 'a') {
    updateAvatarExpression('angry', recordTime);
  } else if (key === 's') {
    updateAvatarExpression('sad', recordTime);
  } else if (key === 'f') {
    updateAvatarExpression('funny', recordTime);
  } else if (key === 'd') {
    updateAvatarExpression('default', recordTime);
  }
}

function handleKeyUp(e) {
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA')) {
    return;
  }

  const recordTime = state.logicalTime;
  const key = e.key.toLowerCase();

  // 押し続けたらAngry/Sad/Funnyになり、離したらDefaultに戻る挙動
  if (key === 'a' && state.expression === 'angry') {
    updateAvatarExpression('default', recordTime);
  } else if (key === 's' && state.expression === 'sad') {
    updateAvatarExpression('default', recordTime);
  } else if (key === 'f' && state.expression === 'funny') {
    updateAvatarExpression('default', recordTime);
  }
}

// --- カルーセルレンダリング ---
function renderCarousel() {
  elements.carouselTrack.innerHTML = '';

  for (let i = 0; i < state.slidesList.length; i++) {
    const slideSrc = state.slidesList[i];
    const filename = slideSrc.split('/').pop();

    const thumb = document.createElement('div');
    thumb.className = 'slide-thumb';
    if (slideSrc === state.confirmedSlideSrc) {
      thumb.classList.add('active');
    }

    thumb.innerHTML = `
      <img src="assets/images/${slideSrc}" alt="${filename}" draggable="false">
      <span class="slide-thumb-label">S${i + 1}</span>
    `;

    // ホバーによる一時プレビュー
    thumb.addEventListener('mouseenter', () => {
      elements.slideImage.src = `assets/images/${slideSrc}`;
    });

    thumb.addEventListener('mouseleave', () => {
      elements.slideImage.src = `assets/images/${state.confirmedSlideSrc}`;
    });

    // クリックによる本表示確定
    thumb.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectSlide(slideSrc);
    });

    elements.carouselTrack.appendChild(thumb);
  }

  updateCarouselOffset();
}

function updateCarouselOffset() {
  const thumbWidth = 86 + 8;
  const maxOffset = Math.max(0, state.slidesList.length - state.carouselVisibleCount);
  state.currentSlideIndex = Math.max(0, Math.min(state.currentSlideIndex, maxOffset));
  elements.carouselTrack.style.transform = `translateX(-${state.currentSlideIndex * thumbWidth}px)`;
}

function moveCarousel(direction) {
  state.currentSlideIndex += direction;
  updateCarouselOffset();
}

function selectSlide(slideSrc) {
  state.confirmedSlideSrc = slideSrc;
  elements.slideImage.src = `assets/images/${slideSrc}`;

  // カルーセルのアクティブクラス更新
  const thumbs = elements.carouselTrack.querySelectorAll('.slide-thumb');
  state.slidesList.forEach((src, idx) => {
    if (thumbs[idx]) {
      thumbs[idx].classList.toggle('active', src === slideSrc);
    }
  });

  // 録音中ならJSONに記録
  if (state.isRecording) {
    const recordTime = parseFloat(state.logicalTime.toFixed(2));
    state.timeline.slides.push({
      time: recordTime,
      src: slideSrc
    });
    logEvent(elements.eventLogList, "Slide", `Changed to ${slideSrc.split('/').pop()}`, recordTime);
  }

  console.log('[selectSlide] confirmed:', slideSrc, 'isRecording:', state.isRecording);
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

// --- リップシンク ---
function updateAvatarMouthState(newState, recordTime) {
  if (state.lastAvatarState === newState) return;
  state.lastAvatarState = newState;

  elements.avatarMouth.style.opacity = newState === 'mouth_open' ? 1 : 0;

  if (state.isRecording && !state.isSilent) {
    state.timeline.avatar.push({
      time: parseFloat(recordTime.toFixed(2)),
      state: newState
    });
  }
}

// --- 音声認識 (SpeechRecognition) ---
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("SpeechRecognition API is not supported.");
    return;
  }

  state.speechRecognition = new SpeechRecognition();
  state.speechRecognition.continuous = true;
  state.speechRecognition.interimResults = true;
  state.speechRecognition.lang = 'ja-JP';

  state.speechRecognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    // 画面表示: 長いテキストは末尾だけ表示して1〜2行に収める
    const displayText = finalTranscript || interimTranscript || "...";
    const maxDisplayLen = 40;
    elements.subtitleText.textContent = displayText.length > maxDisplayLen
      ? '…' + displayText.slice(-maxDisplayLen)
      : displayText;

    if (finalTranscript && state.isRecording) {
      // logicalTimeベースで発話区間を算出（無音カット済みの音声と同期する）
      const endTime = parseFloat(state.logicalTime.toFixed(2));
      const startTime = parseFloat(state.lastSpeechStartTime.toFixed(2));
      const speechDuration = Math.max(0.5, endTime - startTime);

      // 長いテキストを約30文字ごとに分割し、発話区間で振り分ける
      const maxChunkLen = 30;
      if (finalTranscript.length <= maxChunkLen) {
        // 短いテキストは発話開始時間で記録
        state.timeline.subtitles.push({
          time: startTime,
          text: finalTranscript
        });
        logEvent(elements.eventLogList, "Subtitle", finalTranscript, startTime);
      } else {
        // 長いテキストをチャンクに分割
        const chunks = [];
        for (let ci = 0; ci < finalTranscript.length; ci += maxChunkLen) {
          chunks.push(finalTranscript.slice(ci, ci + maxChunkLen));
        }
        // 実際の発話区間(logicalTime)に基づいてチャンクの時間を振り分ける
        const interval = chunks.length > 1 ? speechDuration / chunks.length : 0;

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunkTime = parseFloat(Math.max(0, startTime + ci * interval).toFixed(2));
          state.timeline.subtitles.push({
            time: chunkTime,
            text: chunks[ci]
          });
          logEvent(elements.eventLogList, "Subtitle", chunks[ci], chunkTime);
        }
      }

      // 次の発話区間に備えて開始時間を更新
      state.lastSpeechStartTime = state.logicalTime;
    }
  };

  state.speechRecognition.onerror = (e) => {
    console.error("SpeechRecognition error:", e.error);
    if (state.isRecording && e.error === 'no-speech') {
      try { state.speechRecognition.stop(); } catch (err) { }
    }
  };

  state.speechRecognition.onend = () => {
    if (state.isRecording) {
      try { state.speechRecognition.start(); } catch (err) { }
    }
  };

  state.speechRecognition.start();
}

// --- 音声録音 ＆ 音声処理パイプライン構築 ---
async function startAudioRecording() {
  try {
    await Tone.start();
    const audioCtx = Tone.context.rawContext || Tone.context._context;

    // マイクの生ストリームを取得
    // noiseSuppression ON: バックグラウンドノイズを除去しつつ声質を保つ
    // echoCancellation ON: スピーカー反響を除去
    // autoGainControl OFF: 手動で音量制御するため無効化
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    });

    // ===== リップシンク用: 生ストリームから直接 AnalyserNode を接続 =====
    state.rawSourceNode = audioCtx.createMediaStreamSource(stream);
    state.analyserNode = audioCtx.createAnalyser();
    state.analyserNode.fftSize = 256;
    state.analyserNode.smoothingTimeConstant = 0.3;
    state.rawSourceNode.connect(state.analyserNode);

    // ===== 録音用: 出力先 Destination =====
    const dest = audioCtx.createMediaStreamDestination();
    state.processingNodes = [];

    if (state.character === 'c2') {
      // ===== 女性ボイス処理チェーン =====
      // Tone.js UserMedia → PitchShift → (raw filters) → Compressor → Dest
      state.micNode = new Tone.UserMedia();
      await state.micNode.open();

      state.pitchShiftNode = new Tone.PitchShift({
        pitch: state.pitchShiftValue,
        windowSize: 0.08,
        delayTime: 0.02
      });
      state.micNode.connect(state.pitchShiftNode);

      // --- フォルマント擬似シフト用フィルターチェーン (raw Web Audio) ---
      // ローカット: 男性の胸声共鳴を削減
      const lowCut = audioCtx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = 180;
      lowCut.Q.value = 0.7;

      // F1フォルマントシフト: 男性F1(~500Hz)を減衰、女性F1(~800Hz)を強調
      const f1Cut = audioCtx.createBiquadFilter();
      f1Cut.type = 'peaking';
      f1Cut.frequency.value = 500;
      f1Cut.Q.value = 1.0;
      f1Cut.gain.value = -3;

      const f1Boost = audioCtx.createBiquadFilter();
      f1Boost.type = 'peaking';
      f1Boost.frequency.value = 850;
      f1Boost.Q.value = 1.2;
      f1Boost.gain.value = 4;

      // F2フォルマントシフト: 女性F2(~2800Hz)を控えめに強調
      const f2Boost = audioCtx.createBiquadFilter();
      f2Boost.type = 'peaking';
      f2Boost.frequency.value = 2800;
      f2Boost.Q.value = 1.5;
      f2Boost.gain.value = 3;

      // F3フォルマントシフト: 女性F3(~3400Hz)を控えめに強調
      const f3Boost = audioCtx.createBiquadFilter();
      f3Boost.type = 'peaking';
      f3Boost.frequency.value = 3500;
      f3Boost.Q.value = 2.0;
      f3Boost.gain.value = 2;

      // ディエッサー: PitchShift由来のシャリシャリノイズを抑制
      const deesser = audioCtx.createBiquadFilter();
      deesser.type = 'peaking';
      deesser.frequency.value = 6000;
      deesser.Q.value = 2.0;
      deesser.gain.value = -4;

      // ローパス: 7.5kHz以上の高域ノイズ/ヒスを除去（こもらない帯域）
      const antiHiss = audioCtx.createBiquadFilter();
      antiHiss.type = 'lowpass';
      antiHiss.frequency.value = 7500;
      antiHiss.Q.value = 0.7;

      // コンプレッサー: ノーマライズ（緩めのアタックでパンプ防止）
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -22;
      compressor.ratio.value = 3.5;
      compressor.knee.value = 12;
      compressor.attack.value = 0.01;
      compressor.release.value = 0.3;

      // メイクアップゲイン
      const makeupGain = audioCtx.createGain();
      makeupGain.gain.value = 1.3;

      // チェーン: PitchShift → lowCut → f1Cut → f1Boost → f2Boost → f3Boost → deesser → antiHiss → compressor → makeupGain → dest
      state.pitchShiftNode.connect(lowCut);
      lowCut.connect(f1Cut);
      f1Cut.connect(f1Boost);
      f1Boost.connect(f2Boost);
      f2Boost.connect(f3Boost);
      f3Boost.connect(deesser);
      deesser.connect(antiHiss);
      antiHiss.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(dest);

      state.processingNodes = [lowCut, f1Cut, f1Boost, f2Boost, f3Boost, deesser, antiHiss, compressor, makeupGain];

    } else {
      // ===== 男性ボイス (C1): クリーンパススルー + ノーマライズ =====
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.ratio.value = 3;
      compressor.knee.value = 15;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const makeupGain = audioCtx.createGain();
      makeupGain.gain.value = 1.2;

      // 生ストリームソースから直接接続
      state.rawSourceNode.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(dest);

      state.processingNodes = [compressor, makeupGain];
    }

    // ===== MediaRecorder セットアップ =====
    state.mediaRecorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        state.audioChunks.push(e.data);
      }
    };

    state.mediaRecorder.start(100);

    // 音声認識セットアップ
    setupSpeechRecognition();

    // 時間・ループ状態リセット
    state.logicalTime = 0;
    state.lastFrameTime = performance.now();
    state.silenceTime = 0;
    state.isSilent = false;
    state.lastSpeechStartTime = 0;

    // 初期スライド状態を記録
    state.timeline.slides = [{
      time: 0.0,
      src: state.confirmedSlideSrc
    }];

    console.log('[startAudioRecording] Audio pipeline ready. Character:', state.character);

  } catch (error) {
    console.error("マイクまたは音声処理の起動に失敗しました:", error);
    alert("マイクへのアクセス許可が得られないか、対応する入力デバイスが見つかりません。");
    throw error;
  }
}

// --- メイン処理ループ ---
function processAudioRecordingLoop() {
  if (!state.isRecording) return;

  const now = performance.now();
  const dt = (now - state.lastFrameTime) / 1000;
  state.lastFrameTime = now;

  // --- RMS計算 (生ストリームの AnalyserNode から) ---
  const bufferLength = state.analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  state.analyserNode.getByteTimeDomainData(dataArray);

  let sumSquares = 0;
  for (let i = 0; i < bufferLength; i++) {
    const normalized = (dataArray[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / bufferLength);

  // オーディオレベルメーター更新
  const meterWidth = Math.min(100, rms * 500);
  elements.rmsBar.style.width = `${meterWidth}%`;

  // --- 自動無音カットロジック ---
  if (rms > state.silenceThreshold) {
    state.silenceTime = 0;

    if (state.isSilent) {
      state.isSilent = false;
      state.lastSpeechStartTime = state.logicalTime; // 発話開始のlogicalTimeを記録
      elements.silenceBadge.style.display = 'none';
      elements.statusIndicator.textContent = 'Recording...';
      elements.statusIndicator.className = 'status-indicator recording';

      if (state.mediaRecorder && state.mediaRecorder.state === 'paused') {
        state.mediaRecorder.resume();
        logEvent(elements.eventLogList, "System", "Voice detected, resume recording", state.logicalTime);
      }
    }

    state.logicalTime += dt;

    // リップシンク
    if (rms > state.mouthThreshold) {
      updateAvatarMouthState('mouth_open', state.logicalTime);
      state.mouthHoldTimer = 0.5; // 0.5秒間は口を開けたままにする
    } else {
      if (state.mouthHoldTimer > 0) {
        state.mouthHoldTimer -= dt;
      } else {
        updateAvatarMouthState('mouth_close', state.logicalTime);
      }
    }

  } else {
    if (!state.isSilent) {
      state.silenceTime += dt;

      if (state.silenceTime < state.silenceDelay) {
        state.logicalTime += dt;
        updateAvatarMouthState('mouth_close', state.logicalTime);
      } else {
        state.isSilent = true;
        elements.silenceBadge.style.display = 'block';
        elements.statusIndicator.textContent = 'Auto Paused (Silence Cut)';
        elements.statusIndicator.className = 'status-indicator paused';

        if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
          state.mediaRecorder.pause();
          updateAvatarMouthState('mouth_close', state.logicalTime);
          logEvent(elements.eventLogList, "System", "Silence cut, recording paused", state.logicalTime);
        }
      }
    } else {
      updateAvatarMouthState('mouth_close', state.logicalTime);
    }
  }

  // UI時間表示更新
  elements.timeDisplay.textContent = formatTime(state.logicalTime);
  elements.progressBar.value = state.logicalTime;

  state.animationFrameId = requestAnimationFrame(processAudioRecordingLoop);
}

// --- 録音開始・停止トグル ---
async function toggleRecording() {
  if (state.isRecording) {
    // === 録音停止 ===
    state.isRecording = false;
    elements.recordBtn.textContent = '● Start Recording';
    elements.recordBtn.className = 'btn btn-record';
    elements.statusIndicator.textContent = 'Stopped';
    elements.statusIndicator.className = 'status-indicator';
    elements.rmsBar.style.width = '0%';
    elements.silenceBadge.style.display = 'none';

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
    if (state.speechRecognition) {
      state.speechRecognition.stop();
    }
    if (state.micNode) {
      try { state.micNode.close(); } catch (e) { }
    }
    if (state.animationFrameId) {
      cancelAnimationFrame(state.animationFrameId);
    }

    elements.saveBtn.disabled = false;
    elements.bgSelect.disabled = false;
    updateAvatarMouthState('mouth_close', state.logicalTime);
    updateAvatarExpression('default', state.logicalTime);
    logEvent(elements.eventLogList, "System", "Recording stopped", state.logicalTime);

  } else {
    // === 録音開始 ===
    try {
      state.timeline = { slides: [], subtitles: [], avatar: [] };
      state.expression = 'default';
      if (elements.expressionIndicator) {
        elements.expressionIndicator.textContent = 'default';
      }
      elements.eventLogList.innerHTML = '';
      elements.saveBtn.disabled = true;
      elements.bgSelect.disabled = true;

      // ★★★ 重要: isRecording を先に true にしてからパイプライン構築 ★★★
      // これにより processAudioRecordingLoop が即座に終了しない
      await startAudioRecording();
      state.isRecording = true;

      // ★ ループ開始は isRecording = true の後 ★
      state.lastFrameTime = performance.now();
      processAudioRecordingLoop();

      elements.recordBtn.textContent = '■ Stop Recording';
      elements.recordBtn.className = 'btn btn-record recording';
      elements.statusIndicator.textContent = 'Recording...';
      elements.statusIndicator.className = 'status-indicator recording';

      logEvent(elements.eventLogList, "System", "Recording started", 0);
      console.log('[toggleRecording] Recording started, isRecording:', state.isRecording);

    } catch (e) {
      state.isRecording = false;
      elements.bgSelect.disabled = false;
      console.error(e);
    }
  }
}

// --- ローカルディレクトリへ一括保存 (File System Access API) ---
async function saveTimelineData() {
  if (state.audioChunks.length === 0) {
    alert("保存する録音データが存在しません。");
    return;
  }

  try {
    const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

    const timelineData = {
      metadata: {
        version: "2.0",
        maxDuration: 1800,
        totalTime: parseFloat(state.logicalTime.toFixed(2)),
        character: state.character,
        pitchShift: state.character === 'c2' ? state.pitchShiftValue : 0,
        bgImage: state.bgImage
      },
      timeline: state.timeline
    };

    const jsonFileHandle = await directoryHandle.getFileHandle('timeline.json', { create: true });
    const jsonWritable = await jsonFileHandle.createWritable();
    await jsonWritable.write(JSON.stringify(timelineData, null, 2));
    await jsonWritable.close();

    const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
    const audioFileHandle = await directoryHandle.getFileHandle('audio.webm', { create: true });
    const audioWritable = await audioFileHandle.createWritable();
    await audioWritable.write(audioBlob);
    await audioWritable.close();

    alert("ローカルフォルダに timeline.json と audio.webm を一括自動保存しました！");
    logEvent(elements.eventLogList, "System", "Assets successfully saved", state.logicalTime);

  } catch (error) {
    console.error("保存処理に失敗しました:", error);
    if (error.name !== 'AbortError') {
      alert(`ファイルの書き込み中にエラーが発生しました: ${error.message}`);
    }
  }
}

// 起動
document.addEventListener('DOMContentLoaded', init);