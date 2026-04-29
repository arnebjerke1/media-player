/* ─────────────────────────────────────────────────────────────────────────────
   Lumière — Video Player Logic
   Features: custom controls · subtitles · resume · progress save ·
             keyboard shortcuts · touch gestures · PiP · sleep timer ·
             Media Session API · speed control · FFmpeg transcoding fallback ·
             External player (VLC/MX Player) via Capacitor for H.265/MKV
───────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const mediaId = parseInt(params.get('id'), 10);

if (!mediaId) { location.href = '/'; }

let mediaInfo       = null;
let controlsTimer   = null;
let saveTimer       = null;
let sleepTimer      = null;
let sleepMinutes    = 0;
let sleepStart      = 0;
let currentSubIdx   = -1; // -1 = off
let isSeeking       = false;
let isTranscoding   = false;
let ffmpegAvailable = false;

// Capacitor plugin bridge (null when running outside the Android app)
const FolderPickerPlugin = window?.Capacitor?.Plugins?.FolderPicker || null;
const VideoPlayerPlugin  = window?.Capacitor?.Plugins?.VideoPlayer  || null;
const isCapacitor        = !!window?.Capacitor?.isNativePlatform?.();

const video         = document.getElementById('video');
const controls      = document.getElementById('controls');
const btnPlay       = document.getElementById('btn-play');
const playIconSvg   = document.getElementById('play-icon-svg');
const btnMute       = document.getElementById('btn-mute');
const volIconSvg    = document.getElementById('vol-icon-svg');
const btnSkipBack   = document.getElementById('btn-skip-back');
const btnSkipFwd    = document.getElementById('btn-skip-fwd');
const btnFS         = document.getElementById('btn-fs');
const btnPiP        = document.getElementById('btn-pip');
const btnSpeed      = document.getElementById('btn-speed');
const speedLabel    = document.getElementById('speed-label');
const btnSubs       = document.getElementById('btn-subs');
const btnSleep      = document.getElementById('btn-sleep');
const volSlider     = document.getElementById('vol-slider');
const seekWrap      = document.getElementById('seek-wrap');
const seekPlayed    = document.getElementById('seek-played');
const seekBuf       = document.getElementById('seek-buffered');
const seekThumb     = document.getElementById('seek-thumb');
const seekTooltip   = document.getElementById('seek-tooltip');
const timeDisp      = document.getElementById('time-display');
const titleEl       = document.getElementById('movie-title-top');
const subDisp       = document.getElementById('subtitle-display');
const sleepPill     = document.getElementById('sleep-pill');
const sleepCount    = document.getElementById('sleep-countdown');
const playInd       = document.getElementById('play-indicator');
const piIcon        = document.getElementById('pi-icon');
const vspinner      = document.getElementById('vspinner');
const hintEl        = document.getElementById('shortcut-hint');
const codecBanner   = document.getElementById('codec-error-banner');
const codecMsg      = document.getElementById('codec-error-msg');
const btnTranscode  = document.getElementById('btn-transcode');
const btnExternal   = document.getElementById('btn-external-player');

// ── SVG icons ─────────────────────────────────────────────────────────────────
const SVG_PLAY  = `<polygon points="5 3 19 12 5 21 5 3"/>`;
const SVG_PAUSE = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
const SVG_VOL_ON  = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
const SVG_VOL_LOW = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
const SVG_VOL_OFF = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;

function setPlayIcon(playing) {
  playIconSvg.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
}
function setVolIcon(muted, level) {
  volIconSvg.innerHTML = muted ? SVG_VOL_OFF : (level < 0.5 ? SVG_VOL_LOW : SVG_VOL_ON);
}
function setPlayIndicatorIcon(playing) {
  piIcon.innerHTML = playing
    ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="white">${SVG_PAUSE}</svg>`
    : `<svg width="28" height="28" viewBox="0 0 24 24" fill="white">${SVG_PLAY}</svg>`;
}

// ── Load media info ───────────────────────────────────────────────────────────
async function init() {
  try {
    mediaInfo = await fetch(`/api/media/${mediaId}`).then(r => r.json());
    const caps = await fetch('/api/capabilities').then(r => r.json()).catch(() => ({}));
    ffmpegAvailable = !!caps.ffmpegAvailable;
  } catch (e) {
    alert('Could not load movie info. Returning to library.');
    location.href = '/';
    return;
  }

  titleEl.textContent = mediaInfo.title || 'Lumière';
  document.title      = `${mediaInfo.title || 'Movie'} — Lumière`;

  // ── Android: always use native ExoPlayer (handles H.265, MKV, MP4, everything) ─
  if (isCapacitor && VideoPlayerPlugin) {
    await launchExoPlayer();
    return;
  }

  // ── Web browser: use HTML5 video element ──────────────────────────────────────
  startWebPlayer();
}

/** Launch the native ExoPlayer via Capacitor and return to library when done. */
async function launchExoPlayer() {
  // Show a minimal loading screen; hide the custom web controls
  if (controls) controls.style.display = 'none';
  if (vspinner) vspinner.style.display = 'block';

  const streamUrl = `${location.origin}/api/stream/${mediaId}`;
  const position  = (mediaInfo.position > 30 && !mediaInfo.completed)
    ? mediaInfo.position : 0;

  try {
    const result = await VideoPlayerPlugin.play({
      url:      streamUrl,
      title:    mediaInfo.title || 'Video',
      position: position,
      mediaId:  mediaId,
    });

    // Save watch progress returned by the native player
    if (result && result.duration > 0) {
      await fetch(`/api/progress/${mediaId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ position: result.position, duration: result.duration }),
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[VideoPlayer]', e);
  }

  location.href = '/';
}

/** Initialise the HTML5 video element (desktop / browser path). */
function startWebPlayer() {
  // Show/hide the "Open in external player" button based on platform
  if (btnExternal) {
    btnExternal.style.display = FolderPickerPlugin ? '' : 'none';
  }

  // Set video source
  video.src = `/api/stream/${mediaId}`;
  video.load();

  // Restore saved position
  if (mediaInfo.position > 30 && !mediaInfo.completed) {
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = mediaInfo.position;
    }, { once: true });
  }

  // Build subtitle tracks
  buildSubtitleTracks();

  // Setup Media Session API
  setupMediaSession();

  // Auto-play
  video.play().catch(() => { showControls(); });

  showControls();
}

// ── Codec error / transcoding / external player fallback ─────────────────────
video.addEventListener('error', () => {
  const err = video.error;
  if (!err) return;
  const isCodecError = err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
                       err.code === MediaError.MEDIA_ERR_DECODE;

  if (isCodecError && isTranscoding) {
    // Transcoding itself failed — surface an error
    isTranscoding = false;
    vspinner.style.display = 'none';
    codecMsg.textContent = 'Transcoding failed. The file may be corrupt or unsupported.';
    if (btnTranscode) btnTranscode.style.display = '';
    codecBanner.classList.add('show');
    return;
  }

  if (isCodecError && !isTranscoding) {
    if (FolderPickerPlugin) {
      // Running in Android app — best option is native external player
      codecMsg.textContent = 'This format needs an external player';
      if (btnTranscode) btnTranscode.style.display = ffmpegAvailable ? '' : 'none';
      codecBanner.classList.add('show');
    } else if (ffmpegAvailable) {
      // Auto-transcode via FFmpeg without requiring a manual button click
      isTranscoding = true;
      vspinner.style.display = 'block';
      showHint('Transcoding for browser compatibility...');
      const seekTo = video.currentTime || 0;
      video.src = `/api/transcode/${mediaId}${seekTo > 0 ? `?start=${Math.floor(seekTo)}` : ''}`;
      video.load();
      video.play().catch(() => {});
    } else {
      codecMsg.textContent = 'Codec not supported. Install FFmpeg on the server to enable transcoding.';
      if (btnTranscode) btnTranscode.style.display = 'none';
      codecBanner.classList.add('show');
    }
  }
});

// Server-side FFmpeg transcoding fallback
if (btnTranscode) {
  btnTranscode.addEventListener('click', () => {
    if (!ffmpegAvailable) return;
    isTranscoding = true;
    codecBanner.classList.remove('show');
    vspinner.style.display = 'block';

    const seekTo = video.currentTime || 0;
    video.src = `/api/transcode/${mediaId}${seekTo > 0 ? `?start=${Math.floor(seekTo)}` : ''}`;
    video.load();
    video.play().catch(() => {});
  });
}

// Open in external Android player (VLC / MX Player etc.)
if (btnExternal) {
  btnExternal.addEventListener('click', async () => {
    if (!FolderPickerPlugin) return;
    saveProgress();
    try {
      const streamUrl = `${location.origin}/api/stream/${mediaId}`;
      await FolderPickerPlugin.openExternalPlayer({
        uri:      streamUrl,
        mimeType: 'video/*',
        title:    mediaInfo?.title || 'Video',
      });
      codecBanner.classList.remove('show');
    } catch (e) {
      showHint('No external video player found. Install VLC or MX Player.');
    }
  });
}

// ── Subtitle tracks ───────────────────────────────────────────────────────────
function buildSubtitleTracks() {
  const subs = Array.isArray(mediaInfo.subtitles) ? mediaInfo.subtitles : [];

  Array.from(video.querySelectorAll('track')).forEach(t => t.remove());

  subs.forEach((sub, i) => {
    const track   = document.createElement('track');
    track.kind    = 'subtitles';
    track.label   = sub.label || `Subtitles ${i + 1}`;
    track.srclang = sub.lang  || 'en';
    track.src     = `/api/subtitles/${mediaId}/${i}`;
    if (i === 0) track.default = true;
    video.appendChild(track);
  });

  const menu = document.getElementById('subs-menu');
  menu.innerHTML = `
    <div class="popup-label">Subtitles</div>
    <div class="popup-item ${currentSubIdx === -1 ? 'active' : ''}" data-sub-idx="-1">Off</div>
    ${subs.map((s, i) => `
      <div class="popup-item ${currentSubIdx === i ? 'active' : ''}" data-sub-idx="${i}">
        ${escHtml(s.label || `Track ${i + 1}`)}
      </div>`).join('')}`;

  menu.querySelectorAll('.popup-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      setSubtitle(parseInt(item.dataset.subIdx, 10));
      menu.style.display = 'none';
    });
  });

  btnSubs.style.opacity = subs.length ? '1' : '0.35';
  Array.from(video.textTracks).forEach(t => { t.mode = 'hidden'; });
}

function setSubtitle(idx) {
  currentSubIdx = idx;
  Array.from(video.textTracks).forEach((t, i) => {
    t.mode = i === idx ? 'showing' : 'hidden';
  });
  btnSubs.classList.toggle('active', idx >= 0);
  document.querySelectorAll('#subs-menu .popup-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.subIdx, 10) === idx);
  });
}

// ── Playback controls ─────────────────────────────────────────────────────────
btnPlay.addEventListener('click', togglePlay);

function togglePlay() {
  if (video.paused) { video.play(); } else { video.pause(); }
}

video.addEventListener('play',  () => { setPlayIcon(true);  flashPlayIndicator(true); });
video.addEventListener('pause', () => { setPlayIcon(false); flashPlayIndicator(false); });

function flashPlayIndicator(playing) {
  setPlayIndicatorIcon(playing);
  playInd.classList.add('flash');
  setTimeout(() => playInd.classList.remove('flash'), 600);
}

btnSkipBack.addEventListener('click', () => skip(-10));
btnSkipFwd.addEventListener('click',  () => skip(10));

function skip(secs) {
  video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + secs));
}

// Volume
btnMute.addEventListener('click', () => {
  video.muted = !video.muted;
  setVolIcon(video.muted, video.volume);
  volSlider.value = video.muted ? 0 : video.volume;
});

volSlider.addEventListener('input', () => {
  video.volume = parseFloat(volSlider.value);
  video.muted  = video.volume === 0;
  setVolIcon(video.muted, video.volume);
});

// ── Progress bar ──────────────────────────────────────────────────────────────
video.addEventListener('timeupdate', updateSeekBar);
video.addEventListener('progress',   updateBuffered);

function updateSeekBar() {
  if (isSeeking || !video.duration) return;
  const pct = (video.currentTime / video.duration) * 100;
  seekPlayed.style.width = `${pct}%`;
  seekThumb.style.left   = `${pct}%`;
  timeDisp.textContent   = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
}

function updateBuffered() {
  if (!video.duration || !video.buffered.length) return;
  const pct = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
  seekBuf.style.width = `${pct}%`;
}

seekWrap.addEventListener('mousedown', startSeek);
seekWrap.addEventListener('touchstart', startSeek, { passive: true });
document.addEventListener('mousemove', onSeekMove);
document.addEventListener('touchmove',  onSeekMove, { passive: true });
document.addEventListener('mouseup',   endSeek);
document.addEventListener('touchend',  endSeek);

seekWrap.addEventListener('mousemove', e => {
  const rect = seekWrap.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekTooltip.textContent = fmt(pct * (video.duration || 0));
  seekTooltip.style.left  = `${pct * 100}%`;
});

function startSeek(e) { isSeeking = true; doSeek(e); }
function onSeekMove(e) { if (!isSeeking) return; doSeek(e); }
function endSeek()     { isSeeking = false; }

function doSeek(e) {
  const rect  = seekWrap.getBoundingClientRect();
  const x     = e.touches ? e.touches[0].clientX : e.clientX;
  const pct   = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  video.currentTime = pct * (video.duration || 0);
  seekPlayed.style.width = `${pct * 100}%`;
  seekThumb.style.left   = `${pct * 100}%`;
}

// ── Spinner on buffering ──────────────────────────────────────────────────────
video.addEventListener('waiting', () => { vspinner.style.display = 'block'; });
video.addEventListener('playing', () => { vspinner.style.display = 'none';  });
video.addEventListener('canplay', () => { vspinner.style.display = 'none';  });

// ── Speed control ─────────────────────────────────────────────────────────────
document.getElementById('speed-menu').querySelectorAll('.popup-item').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    const speed = parseFloat(item.dataset.speed);
    video.playbackRate = speed;
    speedLabel.textContent = speed === 1 ? '1×' : `${speed}×`;
    document.querySelectorAll('#speed-menu .popup-item').forEach(i =>
      i.classList.toggle('active', parseFloat(i.dataset.speed) === speed));
    document.getElementById('speed-menu').style.display = 'none';
  });
});

btnSpeed.addEventListener('click', e => { e.stopPropagation(); toggleMenu('speed-menu'); });

// ── Subtitles button ──────────────────────────────────────────────────────────
btnSubs.addEventListener('click', e => {
  e.stopPropagation();
  const subs = Array.isArray(mediaInfo?.subtitles) ? mediaInfo.subtitles : [];
  if (!subs.length) { showHint('No subtitle files found next to this video'); return; }
  toggleMenu('subs-menu');
});

// ── Sleep timer ───────────────────────────────────────────────────────────────
document.getElementById('sleep-menu').querySelectorAll('.popup-item').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    setSleepTimer(parseInt(item.dataset.sleep, 10));
    document.getElementById('sleep-menu').style.display = 'none';
  });
});

btnSleep.addEventListener('click', e => { e.stopPropagation(); toggleMenu('sleep-menu'); });

function setSleepTimer(mins) {
  clearInterval(sleepTimer);
  sleepMinutes = mins;
  sleepPill.classList.remove('visible');
  btnSleep.classList.toggle('active', mins > 0);
  if (mins <= 0) return;

  sleepStart = Date.now();
  sleepPill.classList.add('visible');

  sleepTimer = setInterval(() => {
    const left = Math.ceil(sleepMinutes - (Date.now() - sleepStart) / 60000);
    if (left <= 0) {
      clearInterval(sleepTimer);
      video.pause();
      sleepPill.classList.remove('visible');
      btnSleep.classList.remove('active');
    } else {
      sleepCount.textContent = `${left} min`;
    }
  }, 10000);
  sleepCount.textContent = `${mins} min`;
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
if (btnFS) {
  btnFS.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    const fsIconSvg = document.getElementById('fs-icon-svg');
    if (!fsIconSvg) return;
    if (document.fullscreenElement) {
      fsIconSvg.innerHTML = `<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="20" x2="3" y2="13"/><line x1="21" y1="3" x2="14" y2="10"/>`;
    } else {
      fsIconSvg.innerHTML = `<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>`;
    }
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

// ── Picture in Picture ────────────────────────────────────────────────────────
if (btnPiP) {
  btnPiP.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      showHint('PiP not supported on this device');
    }
  });

  if (!document.pictureInPictureEnabled) btnPiP.style.display = 'none';
}

// ── Controls visibility ───────────────────────────────────────────────────────
function showControls() {
  controls.classList.remove('hidden');
  clearTimeout(controlsTimer);
  if (!video.paused) {
    controlsTimer = setTimeout(hideControls, 3500);
  }
}

function hideControls() {
  if (!video.paused) controls.classList.add('hidden');
}

document.addEventListener('mousemove',  showControls);
document.addEventListener('touchstart', showControls, { passive: true });
document.addEventListener('keydown',    showControls);

// ── Touch gestures ────────────────────────────────────────────────────────────
const tapLeft      = document.getElementById('tap-left');
const tapCenter    = document.getElementById('tap-center');
const tapRight     = document.getElementById('tap-right');
const skipLeftInd  = document.getElementById('skip-left-ind');
const skipRightInd = document.getElementById('skip-right-ind');

function setupTapZone(zone, onSingleTap, onDoubleTap) {
  let tapCount = 0;
  let tapTimer = null;
  zone.addEventListener('click', () => {
    tapCount++;
    clearTimeout(tapTimer);
    if (tapCount >= 2) {
      tapCount = 0;
      onDoubleTap();
    } else {
      tapTimer = setTimeout(() => { tapCount = 0; onSingleTap(); }, 280);
    }
  });
}

setupTapZone(
  tapLeft,
  () => { controls.classList.contains('hidden') ? showControls() : hideControls(); },
  () => { skip(-10); skipLeftInd.classList.add('show'); setTimeout(() => skipLeftInd.classList.remove('show'), 600); }
);
setupTapZone(
  tapCenter,
  () => { controls.classList.contains('hidden') ? showControls() : hideControls(); },
  togglePlay
);
setupTapZone(
  tapRight,
  () => { controls.classList.contains('hidden') ? showControls() : hideControls(); },
  () => { skip(10); skipRightInd.classList.add('show'); setTimeout(() => skipRightInd.classList.remove('show'), 600); }
);

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case ' ':
    case 'k':          e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft':  e.preventDefault(); skip(-10); showHint('← 10s'); break;
    case 'ArrowRight': e.preventDefault(); skip(10);  showHint('→ 10s'); break;
    case 'ArrowUp':    e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); volSlider.value = video.volume; setVolIcon(false, video.volume); showHint(`Vol ${Math.round(video.volume * 100)}%`); break;
    case 'ArrowDown':  e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); volSlider.value = video.volume; setVolIcon(video.volume === 0, video.volume); showHint(`Vol ${Math.round(video.volume * 100)}%`); break;
    case 'm':          video.muted = !video.muted; setVolIcon(video.muted, video.volume); showHint(video.muted ? 'Muted' : 'Unmuted'); break;
    case 'f':          toggleFullscreen(); break;
    case 'c': {
      const subs = Array.isArray(mediaInfo?.subtitles) ? mediaInfo.subtitles : [];
      if (subs.length) {
        const next = currentSubIdx >= subs.length - 1 ? -1 : currentSubIdx + 1;
        setSubtitle(next);
        showHint(next === -1 ? 'Subtitles off' : `Subtitles: ${subs[next]?.label}`);
      }
    } break;
  }
});

window.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  video.volume = Math.max(0, Math.min(1, video.volume + delta));
  volSlider.value = video.volume;
  video.muted = video.volume === 0;
  setVolIcon(video.muted, video.volume);
  showHint(`Vol ${Math.round(video.volume * 100)}%`);
}, { passive: false });

// ── Popup menus ───────────────────────────────────────────────────────────────
function toggleMenu(id) {
  ['speed-menu', 'subs-menu', 'sleep-menu'].forEach(m => {
    const el = document.getElementById(m);
    if (m === id) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    else el.style.display = 'none';
  });
}
document.addEventListener('click', () => {
  ['speed-menu', 'subs-menu', 'sleep-menu'].forEach(m => {
    document.getElementById(m).style.display = 'none';
  });
});

// ── Back button ───────────────────────────────────────────────────────────────
document.getElementById('btn-back').addEventListener('click', goBack);

function goBack() {
  saveProgress();
  history.back();
}

// ── Progress saving ───────────────────────────────────────────────────────────
video.addEventListener('timeupdate', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgress, 15000);
});

video.addEventListener('pause',        saveProgress);
window.addEventListener('beforeunload', saveProgress);

function saveProgress() {
  if (!mediaId || !video.duration) return;
  fetch(`/api/progress/${mediaId}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ position: video.currentTime, duration: video.duration }),
    keepalive: true,
  }).catch(() => {});
}

video.addEventListener('ended', () => {
  saveProgress();
  setTimeout(() => { window.location.href = '/'; }, 3000);
});

// ── Media Session API ─────────────────────────────────────────────────────────
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:   mediaInfo.title    || 'Movie',
    artist:  mediaInfo.director || '',
    artwork: mediaInfo.poster_path
      ? [{ src: mediaInfo.poster_path, sizes: '500x750', type: 'image/jpeg' }]
      : [],
  });
  navigator.mediaSession.setActionHandler('play',         () => video.play());
  navigator.mediaSession.setActionHandler('pause',        () => video.pause());
  navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
  navigator.mediaSession.setActionHandler('seekforward',  () => skip(10));
  navigator.mediaSession.setActionHandler('stop',         goBack);
}

// ── Hint overlay ──────────────────────────────────────────────────────────────
let hintTimer;
function showHint(msg) {
  hintEl.textContent = msg;
  hintEl.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove('show'), 1500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmt(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();

