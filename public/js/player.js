/* ─────────────────────────────────────────────────────────────────────────────
   Lumière — Video Player Logic
   Features: custom controls · subtitles · resume · progress save ·
             keyboard shortcuts · touch gestures · PiP · sleep timer ·
             Media Session API · speed control
───────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const mediaId = parseInt(params.get('id'), 10);

if (!mediaId) { location.href = '/'; }

let mediaInfo      = null;
let controlsTimer  = null;
let saveTimer      = null;
let sleepTimer     = null;
let sleepMinutes   = 0;
let sleepStart     = 0;
let currentSubIdx  = -1; // -1 = off
let isSeeking      = false;
let lastTapTime    = 0;
let accentColor    = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#e50914';

const video       = document.getElementById('video');
const controls    = document.getElementById('controls');
const btnPlay     = document.getElementById('btn-play');
const btnMute     = document.getElementById('btn-mute');
const btnSkipBack = document.getElementById('btn-skip-back');
const btnSkipFwd  = document.getElementById('btn-skip-fwd');
const btnFS       = document.getElementById('btn-fs');
const btnPiP      = document.getElementById('btn-pip');
const btnSpeed    = document.getElementById('btn-speed');
const btnSubs     = document.getElementById('btn-subs');
const btnSleep    = document.getElementById('btn-sleep');
const volSlider   = document.getElementById('vol-slider');
const seekWrap    = document.getElementById('seek-wrap');
const seekPlayed  = document.getElementById('seek-played');
const seekBuf     = document.getElementById('seek-buffered');
const seekThumb   = document.getElementById('seek-thumb');
const seekTooltip = document.getElementById('seek-tooltip');
const timeDisp    = document.getElementById('time-display');
const titleEl     = document.getElementById('movie-title-top');
const subDisp     = document.getElementById('subtitle-display');
const sleepPill   = document.getElementById('sleep-pill');
const sleepCount  = document.getElementById('sleep-countdown');
const playInd     = document.getElementById('play-indicator');
const vspinner    = document.getElementById('vspinner');
const hintEl      = document.getElementById('shortcut-hint');

// ── Load media info ───────────────────────────────────────────────────────────
async function init() {
  try {
    mediaInfo = await fetch(`/api/media/${mediaId}`).then(r => r.json());
  } catch (e) {
    alert('Could not load movie info. Returning to library.');
    location.href = '/';
    return;
  }

  titleEl.textContent = mediaInfo.title || 'Lumière';
  document.title      = `${mediaInfo.title || 'Movie'} — Lumière`;

  // Apply accent from config (read via CSS var stored on :root if set)
  const savedTheme = localStorage.getItem('cb-theme') || 'spotlight';
  applyAccent(savedTheme);

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
  video.play().catch(() => { /* user gesture required – show controls */ });

  showControls();
}

function applyAccent(theme) {
  const accents = { spotlight: '#e50914', breeze: '#58a6ff', horizon: '#f59e0b' };
  accentColor = accents[theme] || '#e50914';
  document.documentElement.style.setProperty('--accent', accentColor);
}

// ── Subtitle tracks ───────────────────────────────────────────────────────────
function buildSubtitleTracks() {
  const subs = Array.isArray(mediaInfo.subtitles) ? mediaInfo.subtitles : [];

  // Remove old tracks
  Array.from(video.querySelectorAll('track')).forEach(t => t.remove());

  subs.forEach((sub, i) => {
    const track  = document.createElement('track');
    track.kind   = 'subtitles';
    track.label  = sub.label || `Subtitles ${i + 1}`;
    track.srclang = sub.lang || 'en';
    track.src    = `/api/subtitles/${mediaId}/${i}`;
    if (i === 0) track.default = true;
    video.appendChild(track);
  });

  // Build subs menu
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

  // Disable all tracks initially (we manage them manually)
  Array.from(video.textTracks).forEach(t => { t.mode = 'hidden'; });
}

function setSubtitle(idx) {
  currentSubIdx = idx;
  Array.from(video.textTracks).forEach((t, i) => {
    t.mode = i === idx ? 'showing' : 'hidden';
  });
  btnSubs.classList.toggle('active', idx >= 0);
  // Update menu active state
  document.querySelectorAll('#subs-menu .popup-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.subIdx, 10) === idx);
  });
}

// ── Playback controls ─────────────────────────────────────────────────────────
btnPlay.addEventListener('click', togglePlay);
// Note: tap-zone click handling manages video area taps (see Touch gestures section)

function togglePlay() {
  if (video.paused) { video.play(); } else { video.pause(); }
}

video.addEventListener('play',  updatePlayBtn);
video.addEventListener('pause', updatePlayBtn);

function updatePlayBtn() {
  btnPlay.textContent = video.paused ? '▶' : '⏸';
  flashPlayIndicator(video.paused ? '⏸' : '▶');
}

function flashPlayIndicator(icon) {
  playInd.textContent = icon;
  playInd.classList.add('flash');
  setTimeout(() => playInd.classList.remove('flash'), 600);
}

btnSkipBack.addEventListener('click', () => skip(-10));
btnSkipFwd.addEventListener('click',  () => skip(10));

function skip(secs) {
  video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + secs));
}

// Mute
btnMute.addEventListener('click', () => {
  video.muted = !video.muted;
  btnMute.textContent = video.muted ? '🔇' : '🔊';
  if (video.muted) volSlider.value = 0;
  else volSlider.value = video.volume;
});

volSlider.addEventListener('input', () => {
  video.volume = parseFloat(volSlider.value);
  video.muted  = video.volume === 0;
  btnMute.textContent = video.muted ? '🔇' : (video.volume < 0.5 ? '🔉' : '🔊');
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

// Seek interaction
seekWrap.addEventListener('mousedown', startSeek);
seekWrap.addEventListener('touchstart', startSeek, { passive: true });
document.addEventListener('mousemove', onSeekMove);
document.addEventListener('touchmove',  onSeekMove, { passive: true });
document.addEventListener('mouseup',   endSeek);
document.addEventListener('touchend',  endSeek);

seekWrap.addEventListener('mousemove', e => {
  const rect = seekWrap.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekTooltip.textContent  = fmt(pct * (video.duration || 0));
  seekTooltip.style.left   = `${pct * 100}%`;
});

function startSeek(e) {
  isSeeking = true;
  doSeek(e);
}
function onSeekMove(e) {
  if (!isSeeking) return;
  doSeek(e);
}
function endSeek() {
  isSeeking = false;
}
function doSeek(e) {
  const rect  = seekWrap.getBoundingClientRect();
  const x     = e.touches ? e.touches[0].clientX : e.clientX;
  const pct   = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  video.currentTime = pct * (video.duration || 0);
  seekPlayed.style.width = `${pct * 100}%`;
  seekThumb.style.left   = `${pct * 100}%`;
}

// ── Spinner on buffering ──────────────────────────────────────────────────────
video.addEventListener('waiting',  () => { vspinner.style.display = 'block'; });
video.addEventListener('playing',  () => { vspinner.style.display = 'none';  });
video.addEventListener('canplay',  () => { vspinner.style.display = 'none';  });

// ── Speed control ─────────────────────────────────────────────────────────────
document.getElementById('speed-menu').querySelectorAll('.popup-item').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    const speed = parseFloat(item.dataset.speed);
    video.playbackRate = speed;
    btnSpeed.textContent = speed === 1 ? '1×' : `${speed}×`;
    document.querySelectorAll('#speed-menu .popup-item').forEach(i =>
      i.classList.toggle('active', parseFloat(i.dataset.speed) === speed));
    document.getElementById('speed-menu').style.display = 'none';
  });
});

btnSpeed.addEventListener('click', e => {
  e.stopPropagation();
  toggleMenu('speed-menu');
});

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

btnSleep.addEventListener('click', e => {
  e.stopPropagation();
  toggleMenu('sleep-menu');
});

function setSleepTimer(mins) {
  clearInterval(sleepTimer);
  sleepMinutes = mins;
  sleepPill.classList.remove('visible');
  btnSleep.classList.toggle('active', mins > 0);

  if (mins <= 0) return;

  sleepStart = Date.now();
  sleepPill.classList.add('visible');

  sleepTimer = setInterval(() => {
    const elapsed = (Date.now() - sleepStart) / 1000 / 60;
    const left    = Math.ceil(sleepMinutes - elapsed);
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
btnFS.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  btnFS.textContent = document.fullscreenElement ? '⛶' : '⛶';
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

// ── Picture in Picture ────────────────────────────────────────────────────────
btnPiP.addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch {
    showHint('PiP not supported by this browser');
  }
});

// Hide PiP button if not supported
if (!document.pictureInPictureEnabled) btnPiP.style.display = 'none';

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

document.addEventListener('mousemove', showControls);
document.addEventListener('touchstart', showControls, { passive: true });
document.addEventListener('keydown', showControls);

// ── Touch gestures ────────────────────────────────────────────────────────────
// Single tap: toggle controls visibility
// Double tap left/right: seek ±10s   Double tap center: play/pause
const tapLeft   = document.getElementById('tap-left');
const tapCenter = document.getElementById('tap-center');
const tapRight  = document.getElementById('tap-right');
const skipLeftInd  = document.getElementById('skip-left-ind');
const skipRightInd = document.getElementById('skip-right-ind');

function setupTapZone(zone, onSingleTap, onDoubleTap) {
  let tapCount  = 0;
  let tapTimer  = null;

  zone.addEventListener('click', () => {
    tapCount++;
    clearTimeout(tapTimer);

    if (tapCount >= 2) {
      tapCount = 0;
      onDoubleTap();
    } else {
      tapTimer = setTimeout(() => {
        tapCount = 0;
        onSingleTap();
      }, 280);
    }
  });
}

// Single tap on any zone: toggle controls
// Double tap left: seek -10s | double tap right: seek +10s | double tap center: play/pause
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
    case 'k':        e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft': e.preventDefault(); skip(-10); showHint('← 10s back'); break;
    case 'ArrowRight':e.preventDefault(); skip(10);  showHint('→ 10s forward'); break;
    case 'ArrowUp':   e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); volSlider.value = video.volume; showHint(`🔊 ${Math.round(video.volume*100)}%`); break;
    case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); volSlider.value = video.volume; showHint(`🔉 ${Math.round(video.volume*100)}%`); break;
    case 'm':        video.muted = !video.muted; btnMute.textContent = video.muted ? '🔇' : '🔊'; showHint(video.muted ? 'Muted' : 'Unmuted'); break;
    case 'f':        toggleFullscreen(); break;
    case 'c':        {
      const subs = Array.isArray(mediaInfo?.subtitles) ? mediaInfo.subtitles : [];
      if (subs.length) {
        const next = currentSubIdx >= subs.length - 1 ? -1 : currentSubIdx + 1;
        setSubtitle(next);
        showHint(next === -1 ? 'Subtitles off' : `Subtitles: ${subs[next]?.label}`);
      }
    } break;
  }
});

// Scroll wheel = volume
window.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  video.volume = Math.max(0, Math.min(1, video.volume + delta));
  volSlider.value = video.volume;
  video.muted = video.volume === 0;
  btnMute.textContent = video.muted ? '🔇' : (video.volume < 0.5 ? '🔉' : '🔊');
  showHint(`${video.muted ? '🔇' : '🔊'} ${Math.round(video.volume * 100)}%`);
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
// Auto-save every 15 seconds
video.addEventListener('timeupdate', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgress, 15000);
});

// Save on pause and before unload
video.addEventListener('pause', saveProgress);
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

// Navigate back when video ends (after a 3-second pause)
video.addEventListener('ended', () => {
  saveProgress();
  setTimeout(() => { window.location.href = '/'; }, 3000);
});

// ── Media Session API (lock-screen / OS controls) ─────────────────────────────
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  mediaInfo.title   || 'Movie',
    artist: mediaInfo.director || '',
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
