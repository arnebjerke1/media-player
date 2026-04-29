/* ─────────────────────────────────────────────────────────────────────────────
   Lumière — Main App Logic
───────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let allMedia        = [];
let config          = {};
let currentSearch   = '';
let activeGenre     = '';
let activeAge       = '';   // age / certification filter
let activeQF        = 'all';   // quick-filter
let obStep          = 0;
let obFolders       = [];
let obTheme         = 'spotlight';
let scanPollTimer   = null;
let heroIndex       = 0;
let heroTimer       = null;
let activeSidebarSection = 'all';
let currentTvShow   = null;  // when viewing a TV show's seasons
let currentSeason   = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const splash = document.getElementById('splash');
  const splashStart = Date.now();

  try {
    config = await api('/api/config');
    applyTheme(config.theme || 'spotlight');

    if (!config.setupComplete) {
      showOnboarding();
    } else {
      await loadApp();
    }
  } catch (e) {
    showToast('Could not connect to server', 'error');
  } finally {
    // Show splash for at least 1.4 seconds for the animation to complete
    const elapsed = Date.now() - splashStart;
    const minSplash = 1400;
    setTimeout(() => {
      splash.classList.add('fade-out');
      setTimeout(() => { splash.classList.add('gone'); hideLoading(); }, 650);
    }, Math.max(0, minSplash - elapsed));
  }
}

async function loadApp() {
  show('app');
  allMedia = await api('/api/media');
  renderLibrary();
  renderContinueWatching();
  renderTvShows();
  renderSidebarGenres();
  populateSurpriseGenres();
  loadStats();
  setupSearch();
  setupHeaderScroll();
  setupSidebar();
}

// ── API helper ────────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.className = `theme-${theme}`;
  document.querySelectorAll('[data-theme]').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
    el.classList.toggle('selected', el.dataset.theme === theme);
  });
}

// ── Loading / Visibility helpers ──────────────────────────────────────────────
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  setTimeout(() => el.style.display = 'none', 400);
}
function show(id) { document.getElementById(id).classList.add('visible'); }
function hide(id) { document.getElementById(id).classList.remove('visible'); }

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Header scroll solid ───────────────────────────────────────────────────────
function setupHeaderScroll() {
  const h = document.getElementById('header');
  window.addEventListener('scroll', () => {
    h.classList.toggle('solid', window.scrollY > 60);
  }, { passive: true });
}

// ── Onboarding ────────────────────────────────────────────────────────────────
function showOnboarding() {
  document.getElementById('onboarding').classList.remove('hidden');
  // Pre-fill API keys from .env if the inputs are still empty
  const tmdbInput = document.getElementById('ob-tmdb-key');
  const omdbInput = document.getElementById('ob-omdb-key');
  if (tmdbInput && !tmdbInput.value && config.tmdbApiKey) tmdbInput.value = config.tmdbApiKey;
  if (omdbInput && !omdbInput.value && config.omdbApiKey) omdbInput.value = config.omdbApiKey;

  // If API keys are already configured, show that step 2 will be skipped
  if (config.tmdbApiKey) {
    const desc = document.getElementById('ob-apikey-desc');
    if (desc) desc.textContent = 'API keys are already configured on the server — metadata will be fetched automatically. You can update them here if needed.';
    const nextBtn = document.getElementById('ob-next-btn');
    if (nextBtn) nextBtn.textContent = 'Finish & Scan Library';
  }

  // Load folder suggestions for step 1
  loadFolderSuggestions();
}
function hideOnboarding() {
  document.getElementById('onboarding').classList.add('hidden');
}

async function loadFolderSuggestions() {
  try {
    const data = await api('/api/browse');
    const container = document.getElementById('ob-suggestions');
    if (!container || !data.suggestions?.length) return;
    container.innerHTML = '<div style="font-size:12px;color:var(--text3);margin-bottom:6px">Suggested folders:</div>'
      + data.suggestions.map(s => `
        <button class="folder-suggestion-btn" onclick="obUseSuggestion('${esc(s)}')">${esc(s)}</button>
      `).join('');
  } catch { /* non-fatal */ }
}

function obUseSuggestion(folderPath) {
  document.getElementById('ob-folder-input').value = folderPath;
  obAddFolder();
}

function updateStepDots() {
  document.querySelectorAll('.step-dot').forEach((d, i) => {
    d.classList.toggle('active', i === obStep);
    d.classList.toggle('done',   i < obStep);
  });
  document.querySelectorAll('.ob-step').forEach((s, i) => {
    s.classList.toggle('active', i === obStep);
  });
}

function obNext() {
  if (obStep === 0) {
    // Save theme choice
    applyTheme(obTheme);
  }
  if (obStep === 1) {
    // Auto-add any folder path that was typed but not yet added
    const input = document.getElementById('ob-folder-input');
    if (input && input.value.trim()) obAddFolder();

    // If API keys are already set via .env, skip step 2 and finish immediately
    if (config.tmdbApiKey) {
      obFinish();
      return;
    }
  }
  obStep = Math.min(obStep + 1, 2);
  updateStepDots();
}
function obBack() {
  obStep = Math.max(obStep - 1, 0);
  updateStepDots();
}

function obAddFolder() {
  const input = document.getElementById('ob-folder-input');
  const val   = input.value.trim();
  if (!val || obFolders.includes(val)) return;
  obFolders.push(val);
  input.value = '';
  renderObFolders();
}

function renderObFolders() {
  const list = document.getElementById('ob-folder-list');
  list.innerHTML = obFolders.map((f, i) => `
    <div class="folder-row">
      <span style="color:var(--text2)">📁</span>
      <span style="font-family:monospace;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f)}</span>
      <button class="remove-folder" onclick="obRemoveFolder(${i})">×</button>
    </div>`).join('');
}

function obRemoveFolder(i) {
  obFolders.splice(i, 1);
  renderObFolders();
}

async function obFinish() {
  const tmdb = document.getElementById('ob-tmdb-key').value.trim();
  const omdb = document.getElementById('ob-omdb-key').value.trim();

  await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({
      theme:         obTheme,
      mediaFolders:  obFolders,
      tmdbApiKey:    tmdb,
      omdbApiKey:    omdb,
      setupComplete: true,
    }),
  });

  config = await api('/api/config');
  hideOnboarding();
  await loadApp();

  if (obFolders.length) triggerScan();
}

// Theme cards in onboarding
document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', () => {
    obTheme = card.dataset.theme;
    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    applyTheme(obTheme);
  });
});

// Allow Enter key in folder input
document.getElementById('ob-folder-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') obAddFolder();
});

// ── Library Rendering ─────────────────────────────────────────────────────────
function renderLibrary() {
  const filtered = getFilteredMedia();
  renderGrid(filtered);
  renderHero(filtered);
  renderRecentRow();
  renderGenreFilter();
  updateAllCount(filtered.length);
}

function getFilteredMedia() {
  // Movies grid only shows movies (not TV episodes)
  let list = allMedia.filter(m => (m.media_type || 'movie') === 'movie');

  // Quick filter
  if (activeQF === 'unwatched') {
    list = list.filter(m => !m.completed && (!m.position || m.position < 30));
  } else if (activeQF === 'favorites') {
    list = list.filter(m => m.favorite);
  } else if (activeQF === 'watchlist') {
    list = list.filter(m => m.watchlisted);
  } else if (activeQF === '4k') {
    list = list.filter(m => m.quality === '4K');
  } else if (activeQF === 'hdr') {
    list = list.filter(m => m.hdr || m.dolby_vision);
  }

  // Genre filter
  if (activeGenre) {
    list = list.filter(m => (m.genres || []).includes(activeGenre));
  }

  // Age / certification filter
  if (activeAge) {
    list = list.filter(m => m.certification === activeAge);
  }

  // Search
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(m =>
      (m.title || '').toLowerCase().includes(q) ||
      String(m.year || '').includes(q) ||
      (m.director || '').toLowerCase().includes(q)
    );
  }

  return list;
}

function renderGrid(movies) {
  const grid = document.getElementById('all-grid');
  if (!movies.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <p>${currentSearch ? 'No movies match your search.' : 'No movies here yet. Add a folder in Settings and scan your library.'}</p>
      </div>`;
    return;
  }
  grid.innerHTML = movies.map(m => movieCardHTML(m)).join('');
  attachCardEvents(grid);
}

function renderRecentRow() {
  const row   = document.getElementById('recent-row');
  const recent = [...allMedia]
    .sort((a, b) => (b.added_at || 0) - (a.added_at || 0))
    .slice(0, 20);
  if (!recent.length) { document.getElementById('recent-section').style.display = 'none'; return; }
  document.getElementById('recent-section').style.display = '';
  row.innerHTML = recent.map(m => movieCardHTML(m, true)).join('');
  attachCardEvents(row);
}

async function renderContinueWatching() {
  const items = await api('/api/continue').catch(() => []);
  const sec   = document.getElementById('continue-section');
  const row   = document.getElementById('continue-row');
  if (!items.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  row.innerHTML = items.map(m => movieCardHTML(m, true)).join('');
  attachCardEvents(row);
}

// ── Movie Card HTML ────────────────────────────────────────────────────────────
function movieCardHTML(m, isRow = false) {
  const pct       = m.duration > 0 ? Math.round((m.position / m.duration) * 100) : 0;
  // IMDb rating moved to modal only — only RT score shown on cards
  const rtBadge   = m.rt_score != null
    ? `<span class="badge-rt ${m.rt_score >= 60 ? 'fresh' : 'rotten'}">${m.rt_score >= 60 ? '🍅' : '🤢'} ${m.rt_score}%</span>` : '';

  // Quality / HDR badges
  const badges = [];
  if (m.quality === '4K') badges.push('<span class="qbadge qbadge-4k">4K</span>');
  if (m.dolby_vision)     badges.push('<span class="qbadge qbadge-dv">DV</span>');
  else if (m.hdr)         badges.push('<span class="qbadge qbadge-hdr">HDR</span>');
  if (m.atmos)            badges.push('<span class="qbadge qbadge-atmos">Atmos</span>');
  if (m.quality && m.quality !== '4K') badges.push(`<span class="qbadge qbadge-hd">${m.quality}</span>`);

  const poster = m.poster_path
    ? `<img class="card-poster" src="${esc(m.poster_path)}" alt="${esc(m.title)}" loading="lazy" />`
    : `<div class="card-poster-placeholder"><span class="film-icon">🎬</span><span>${esc(m.title)}</span></div>`;

  const progress = pct > 0 && pct < 95
    ? `<div class="card-progress"><div class="card-progress-bar" style="width:${pct}%"></div></div>` : '';

  return `
    <div class="movie-card${isRow ? ' row-card' : ''}" data-id="${m.id}">
      ${poster}
      <div class="card-badges">${badges.join('')}</div>
      <div class="card-actions">
        <button class="card-action-btn ${m.favorite ? 'active' : ''}"
                data-action="favorite" data-id="${m.id}" title="Favourite">❤</button>
        <button class="card-action-btn ${m.watchlisted ? 'active watch' : ''}"
                data-action="watchlist" data-id="${m.id}" title="Watchlist">🔖</button>
      </div>
      <div class="card-overlay">
        <div class="card-info">
          <div class="card-title">${esc(m.title)}</div>
          ${m.year ? `<div class="card-year">${m.year}</div>` : ''}
          <div class="card-rating-row">${rtBadge}</div>
        </div>
      </div>
      ${progress}
    </div>`;
}

function attachCardEvents(container) {
  container.querySelectorAll('.movie-card').forEach(card => {
    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn) {
        e.stopPropagation();
        const id     = parseInt(btn.dataset.id, 10);
        const action = btn.dataset.action;
        handleCardAction(id, action, btn);
        return;
      }
      openModal(parseInt(card.dataset.id, 10));
    });
  });
}

async function handleCardAction(id, action, btn) {
  try {
    const res = await api(`/api/media/${id}/${action}`, { method: 'POST' });
    const val = action === 'favorite' ? res.favorite : res.watchlisted;
    btn.classList.toggle('active', !!val);
    if (action === 'watchlist') btn.classList.toggle('watch', !!val);
    // Update local state
    const m = allMedia.find(x => x.id === id);
    if (m) {
      if (action === 'favorite') m.favorite = val;
      else m.watchlisted = val;
    }
    showToast(action === 'favorite'
      ? (val ? 'Added to Favourites' : 'Removed from Favourites')
      : (val ? 'Added to Watchlist' : 'Removed from Watchlist'), 'success');
  } catch {
    showToast('Could not update', 'error');
  }
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function renderHero(list) {
  clearInterval(heroTimer);
  const candidates = list.filter(m => m.backdrop_path);
  if (!candidates.length) { renderHeroItem(null); return; }
  heroIndex = 0;
  renderHeroItem(candidates[heroIndex]);
  if (candidates.length > 1) {
    heroTimer = setInterval(() => {
      heroIndex = (heroIndex + 1) % candidates.length;
      renderHeroItem(candidates[heroIndex]);
    }, 12000);
  }
}

function renderHeroItem(m) {
  const backdrop = document.getElementById('hero-backdrop');
  const title    = document.getElementById('hero-title');
  const meta     = document.getElementById('hero-meta');
  const overview = document.getElementById('hero-overview');
  const genres   = document.getElementById('hero-genres');
  const buttons  = document.getElementById('hero-buttons');

  if (!m) {
    title.textContent   = 'Welcome to Lumière';
    overview.textContent = 'Add your movie folder in Settings to get started.';
    genres.innerHTML = meta.innerHTML = buttons.innerHTML = '';
    backdrop.style.backgroundImage = '';
    return;
  }

  backdrop.style.backgroundImage = `url('${m.backdrop_path}')`;

  title.textContent = m.title;
  genres.innerHTML  = (m.genres || []).slice(0, 3)
    .map(g => `<span class="genre-tag">${esc(g)}</span>`).join('');

  const parts = [];
  if (m.year)    parts.push(`<span>${m.year}</span>`);
  if (m.runtime) parts.push(`<span>${m.runtime} min</span>`);
  if (m.director)parts.push(`<span>Dir. ${esc(m.director)}</span>`);
  if (m.rating)  parts.push(`<span class="hero-rating-imdb">${m.rating} IMDb</span>`);
  if (m.rt_score != null) {
    const icon = m.rt_score >= 60 ? '🍅' : '🤢';
    parts.push(`<span class="hero-rating-rt">${icon} ${m.rt_score}%</span>`);
  }
  meta.innerHTML = parts.join('');

  overview.textContent = m.overview || '';

  const pct = m.duration > 0 ? Math.round((m.position / m.duration) * 100) : 0;
  const playLabel = pct > 0 && pct < 95 ? `▶ Resume (${pct}%)` : '▶ Play';

  buttons.innerHTML = `
    <button class="play-btn" onclick="playMedia(${m.id})">${playLabel}</button>
    <button class="more-btn" onclick="openModal(${m.id})">ⓘ More Info</button>`;
}

// ── Genre filter ──────────────────────────────────────────────────────────────
function renderGenreFilter() {
  const allGenres = [...new Set(allMedia.flatMap(m => m.genres || []))].sort();
  const bar       = document.getElementById('genre-filter');
  if (!allGenres.length) { bar.innerHTML = ''; return; }

  bar.innerHTML = ['', ...allGenres].map(g =>
    `<button class="filter-chip${g === activeGenre ? ' active' : ''}" data-genre="${esc(g)}">
      ${g || 'All Genres'}
    </button>`
  ).join('');

  bar.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeGenre = chip.dataset.genre;
      bar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderGrid(getFilteredMedia());
      updateAllCount(getFilteredMedia().length);
    });
  });
}

function updateAllCount(n) {
  document.getElementById('all-count').textContent = n ? `${n} movie${n !== 1 ? 's' : ''}` : '';
}

// ── Search ────────────────────────────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    currentSearch = input.value.trim();
    const filtered = getFilteredMedia();
    renderGrid(filtered);
    updateAllCount(filtered.length);
    document.getElementById('all-title').textContent =
      currentSearch ? `Results for "${currentSearch}"` : 'All Movies';
  });
}

// ── Quick Filters ─────────────────────────────────────────────────────────────
document.getElementById('quick-filters')?.addEventListener('click', e => {
  const btn = e.target.closest('.qf-btn');
  if (!btn) return;
  activeQF = btn.dataset.qf;
  document.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeGenre = '';
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  const all = document.querySelector('.filter-chip[data-genre=""]');
  if (all) all.classList.add('active');
  const filtered = getFilteredMedia();
  renderGrid(filtered);
  updateAllCount(filtered.length);
});

// ── Age Filters ───────────────────────────────────────────────────────────────
document.getElementById('age-filters')?.addEventListener('click', e => {
  const btn = e.target.closest('.age-chip');
  if (!btn) return;
  activeAge = btn.dataset.age;
  document.querySelectorAll('.age-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = getFilteredMedia();
  renderGrid(filtered);
  updateAllCount(filtered.length);
});

// ── Movie Modal ───────────────────────────────────────────────────────────────
let currentModalId = null;

async function openModal(id) {
  currentModalId = id;
  const m = allMedia.find(x => x.id === id) || await api(`/api/media/${id}`);

  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Backdrop
  const bd = document.getElementById('modal-backdrop');
  bd.style.backgroundImage = m.backdrop_path ? `url('${m.backdrop_path}')` : '';

  // Poster
  const poster = document.getElementById('modal-poster');
  poster.src = m.poster_path || '';
  poster.alt = m.title;
  poster.onerror = () => { poster.src = ''; };

  document.getElementById('modal-title').textContent   = m.title;
  document.getElementById('modal-tagline').textContent = m.tagline || '';
  document.getElementById('modal-tagline').style.display = m.tagline ? '' : 'none';
  document.getElementById('modal-overview').textContent = m.overview || 'No description available.';

  // Meta row
  const parts = [];
  if (m.year)           parts.push(`<span class="modal-year">${m.year}</span>`);
  if (m.runtime)        parts.push(`<span class="modal-runtime">${m.runtime} min</span>`);
  if (m.certification)  parts.push(`<span class="cert-badge">${esc(m.certification)}</span>`);
  if (m.language)       parts.push(`<span>${m.language.toUpperCase()}</span>`);
  // Quality tags
  if (m.quality)        parts.push(`<span class="qbadge qbadge-${m.quality === '4K' ? '4k' : 'hd'}">${m.quality}</span>`);
  if (m.dolby_vision)   parts.push(`<span class="qbadge qbadge-dv">Dolby Vision</span>`);
  else if (m.hdr)       parts.push(`<span class="qbadge qbadge-hdr">HDR</span>`);
  if (m.atmos)          parts.push(`<span class="qbadge qbadge-atmos">Atmos</span>`);
  document.getElementById('modal-meta').innerHTML = parts.join('');

  // Ratings
  let ratings = '';
  if (m.rating)         ratings += `<span class="rating-pill rating-imdb">⭐ ${m.rating} <span style="font-weight:400;font-size:12px">IMDb</span></span>`;
  if (m.rt_score != null) {
    const cls = m.rt_score >= 60 ? 'fresh' : 'rotten';
    const icon = m.rt_score >= 60 ? '🍅' : '🤢';
    ratings += `<span class="rating-pill rating-rt ${cls}">${icon} ${m.rt_score}% <span style="font-weight:400;font-size:12px">Rotten Tomatoes</span></span>`;
  }
  if (m.imdb_id) ratings += `<a href="https://www.imdb.com/title/${m.imdb_id}" target="_blank" style="font-size:12px;color:var(--text3)">Open on IMDb ↗</a>`;
  document.getElementById('modal-ratings').innerHTML = ratings;

  // Genres
  document.getElementById('modal-genres').innerHTML =
    (m.genres || []).map(g => `<span class="modal-genre-chip">${esc(g)}</span>`).join('');

  // Cast
  const castSec = document.getElementById('modal-cast-section');
  const castEl  = document.getElementById('modal-cast');
  if (m.cast?.length) {
    castSec.style.display = '';
    castEl.innerHTML = m.cast.map(c => `<span class="cast-chip">${esc(c)}</span>`).join('');
  } else {
    castSec.style.display = 'none';
  }

  // Director
  const dirSec = document.getElementById('modal-director-section');
  const dirEl  = document.getElementById('modal-director');
  if (m.director) {
    dirSec.style.display = '';
    dirEl.textContent = m.director;
  } else {
    dirSec.style.display = 'none';
  }

  // Actions
  const pct = m.duration > 0 ? Math.round((m.position / m.duration) * 100) : 0;
  const playLabel = pct > 0 && pct < 95 ? `▶ Resume (${pct}%)` : '▶ Play';
  document.getElementById('modal-actions').innerHTML = `
    <button class="btn-play-modal" onclick="playMedia(${m.id})">${playLabel}</button>
    <button class="btn-refresh" onclick="refreshMetadata(${m.id})">⟳ Refresh Info</button>
    <button class="btn-remove"  onclick="removeMedia(${m.id})">🗑 Remove</button>
    <button class="btn-delete-file" onclick="deleteFile(${m.id})">🗑 Delete File</button>`;
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  currentModalId = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

async function refreshMetadata(id) {
  closeModal();
  showToast('Fetching metadata…', 'info');
  try {
    const updated = await api(`/api/media/${id}/refresh`, { method: 'POST' });
    const idx     = allMedia.findIndex(m => m.id === id);
    if (idx !== -1) allMedia[idx] = updated;
    renderLibrary();
    showToast('Metadata updated!', 'success');
  } catch (e) {
    showToast('Could not fetch metadata: ' + e.message, 'error');
  }
}

async function removeMedia(id) {
  if (!confirm('Remove this movie from Lumière? (The file will not be deleted.)')) return;
  closeModal();
  await api(`/api/media/${id}`, { method: 'DELETE' });
  allMedia = allMedia.filter(m => m.id !== id);
  renderLibrary();
  renderTvShows();
  showToast('Removed from library', 'success');
}

async function deleteFile(id) {
  const m = allMedia.find(x => x.id === id);
  const title = m?.title || 'this item';
  if (!confirm(`Permanently delete the file for "${title}" from disk? This cannot be undone.`)) return;
  closeModal();
  try {
    await api(`/api/media/${id}?deleteFile=true`, { method: 'DELETE' });
    allMedia = allMedia.filter(x => x.id !== id);
    renderLibrary();
    renderTvShows();
    showToast('File deleted from disk', 'success');
  } catch (e) {
    showToast('Could not delete file: ' + e.message, 'error');
  }
}

// ── Play ──────────────────────────────────────────────────────────────────────
function playMedia(id) {
  window.location.href = `/player.html?id=${id}`;
}

// ── Scan ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-scan')?.addEventListener('click', triggerScan);

async function triggerScan() {
  try {
    await api('/api/scan', { method: 'POST' });
    showToast('Library scan started…', 'info');
    startScanPolling();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function startScanPolling() {
  const bar   = document.getElementById('scan-progress-bar');
  const fill  = document.getElementById('scan-bar-fill');
  const label = document.getElementById('scan-label');
  const count = document.getElementById('scan-count');
  bar.classList.add('visible');

  clearInterval(scanPollTimer);
  scanPollTimer = setInterval(async () => {
    const s = await api('/api/scan/progress').catch(() => null);
    if (!s) return;

    label.textContent = s.current ? `Scanning: ${s.current}` : 'Scanning…';
    count.textContent = `${s.processed} / ${s.total}`;
    fill.style.width  = s.total > 0 ? `${(s.processed / s.total) * 100}%` : '0%';

    if (!s.inProgress) {
      clearInterval(scanPollTimer);
      bar.classList.remove('visible');
      allMedia = await api('/api/media');
      renderLibrary();
      renderContinueWatching();
      populateSurpriseGenres();
      loadStats();
      renderTvShows();
      renderSidebarGenres();
      showToast(`Scan complete — ${allMedia.length} items in library`, 'success');
    }
  }, 1500);
}

// ── Settings ──────────────────────────────────────────────────────────────────
document.getElementById('btn-settings')?.addEventListener('click', openSettings);
document.getElementById('settings-close')?.addEventListener('click', closeSettings);

function openSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.add('open');

  // Populate current values
  document.getElementById('settings-tmdb').value = config.tmdbApiKey || '';
  document.getElementById('settings-omdb').value = config.omdbApiKey || '';

  // Folders
  const fl = document.getElementById('settings-folder-list');
  fl.innerHTML = (config.mediaFolders || []).map((f, i) => `
    <div class="folder-row">
      <span style="color:var(--text2)">📁</span>
      <span style="font-family:monospace;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f)}</span>
      <button class="remove-folder" onclick="settingsRemoveFolder(${i})">×</button>
    </div>`).join('');

  // Theme pills
  document.querySelectorAll('.theme-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.theme === (config.theme || 'spotlight'));
  });

  loadStats();
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
}

function settingsAddFolder() {
  const input = document.getElementById('settings-folder-input');
  const val   = input.value.trim();
  if (!val) return;
  if (!config.mediaFolders) config.mediaFolders = [];
  if (!config.mediaFolders.includes(val)) config.mediaFolders.push(val);
  input.value = '';
  openSettings(); // re-render
}

function settingsRemoveFolder(i) {
  config.mediaFolders.splice(i, 1);
  openSettings();
}

async function saveSettings() {
  config.tmdbApiKey = document.getElementById('settings-tmdb').value.trim();
  config.omdbApiKey = document.getElementById('settings-omdb').value.trim();
  await api('/api/config', { method: 'POST', body: JSON.stringify(config) });
  showToast('Settings saved!', 'success');
  closeSettings();
}

// Theme pills in settings
document.querySelectorAll('.theme-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    config.theme = pill.dataset.theme;
    applyTheme(config.theme);
    document.querySelectorAll('.theme-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.theme === config.theme));
    api('/api/config', { method: 'POST', body: JSON.stringify(config) });
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api('/api/stats');
    document.getElementById('stat-total').textContent   = s.total;
    document.getElementById('stat-watched').textContent = s.watched;
    document.getElementById('stat-hours').textContent   = s.hoursWatched + 'h';

    const maxCount = s.topGenres[0]?.count || 1;
    document.getElementById('genre-bars').innerHTML = s.topGenres.map(g => `
      <div class="genre-bar-row">
        <span class="genre-bar-name">${esc(g.name)}</span>
        <div class="genre-bar-track">
          <div class="genre-bar-fill" style="width:${(g.count / maxCount * 100).toFixed(0)}%"></div>
        </div>
        <span class="genre-bar-pct">${g.count}</span>
      </div>`).join('');
  } catch { /* non-fatal */ }
}

// ── Surprise Me ───────────────────────────────────────────────────────────────
document.getElementById('surprise-fab')?.addEventListener('click', () => {
  document.getElementById('surprise-modal').classList.add('open');
});
document.getElementById('btn-surprise-close')?.addEventListener('click', () => {
  document.getElementById('surprise-modal').classList.remove('open');
});

// Single-select chip groups
document.querySelectorAll('.surprise-chips').forEach(group => {
  group.addEventListener('click', e => {
    const chip = e.target.closest('.surprise-chip');
    if (!chip) return;
    group.querySelectorAll('.surprise-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

function populateSurpriseGenres() {
  const allGenres = [...new Set(allMedia.flatMap(m => m.genres || []))].sort();
  const container = document.getElementById('surprise-genre-chips');
  container.innerHTML = `<button class="surprise-chip active" data-genre="">Any genre</button>`
    + allGenres.map(g => `<button class="surprise-chip" data-genre="${esc(g)}">${esc(g)}</button>`).join('');

  // Re-attach single-select
  container.addEventListener('click', e => {
    const chip = e.target.closest('.surprise-chip');
    if (!chip) return;
    container.querySelectorAll('.surprise-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
}

document.getElementById('btn-surprise-go')?.addEventListener('click', async () => {
  const maxRuntime = document.querySelector('.surprise-chip[data-runtime].active')?.dataset.runtime || '';
  const minRating  = document.querySelector('.surprise-chip[data-rating].active')?.dataset.rating   || '';
  const genre      = document.querySelector('#surprise-genre-chips .surprise-chip.active')?.dataset.genre || '';

  const params = new URLSearchParams();
  if (maxRuntime) params.set('maxRuntime', maxRuntime);
  if (minRating)  params.set('minRating',  minRating);
  if (genre)      params.set('genre',      genre);

  try {
    const m = await api(`/api/surprise?${params}`);
    document.getElementById('surprise-modal').classList.remove('open');
    openModal(m.id);
  } catch {
    showToast('No unwatched movies match those filters. Try fewer restrictions.', 'error');
  }
});

// ── Sidebar ───────────────────────────────────────────────────────────────────
function setupSidebar() {
  document.getElementById('btn-menu')?.addEventListener('click', openSidebar);
  document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

  document.querySelectorAll('.sidebar-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      activeSidebarSection = section;

      // Update active state
      document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      closeSidebar();

      // Apply as quick filter or switch to TV view
      if (section === 'tv') {
        showTvSection();
      } else {
        hideTvSection();
        const qfMap = { all: 'all', continue: 'all', favorites: 'favorites', watchlist: 'watchlist', '4k': '4k' };
        activeQF = qfMap[section] || 'all';
        document.querySelectorAll('.qf-btn').forEach(b => b.classList.toggle('active', b.dataset.qf === activeQF));
        const filtered = getFilteredMedia();
        renderGrid(filtered);
        updateAllCount(filtered.length);
      }
    });
  });
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
  document.body.style.overflow = '';
}

function renderSidebarGenres() {
  const allGenres = [...new Set(allMedia.flatMap(m => m.genres || []))].sort();
  const list = document.getElementById('sidebar-genre-list');
  if (!list) return;
  list.innerHTML = allGenres.map(g => `
    <button class="sidebar-genre-btn" data-genre="${esc(g)}">${esc(g)}</button>
  `).join('');

  list.querySelectorAll('.sidebar-genre-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSidebar();
      hideTvSection();
      activeGenre = btn.dataset.genre;
      // clear active on all genre btns then set this one
      list.querySelectorAll('.sidebar-genre-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // also deactivate quick filters
      document.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.genre === activeGenre);
      });
      const filtered = getFilteredMedia();
      renderGrid(filtered);
      updateAllCount(filtered.length);
    });
  });
}

// ── TV Shows ──────────────────────────────────────────────────────────────────
function showTvSection() {
  document.getElementById('tv-section').style.display = '';
  document.getElementById('all-movies-section').style.display = 'none';
}

function hideTvSection() {
  document.getElementById('tv-section').style.display = 'none';
  document.getElementById('all-movies-section').style.display = '';
}

function renderTvShows() {
  const tvItems = allMedia.filter(m => m.media_type === 'tv');
  const tvSec   = document.getElementById('tv-section');

  if (!tvItems.length) {
    tvSec.style.display = 'none';
    return;
  }

  // Group by show_name
  const shows = {};
  for (const ep of tvItems) {
    const name = ep.show_name || ep.title;
    if (!shows[name]) {
      shows[name] = { name, items: [], poster_path: ep.poster_path, backdrop_path: ep.backdrop_path };
    }
    shows[name].items.push(ep);
    // Prefer item that has a poster
    if (!shows[name].poster_path && ep.poster_path) shows[name].poster_path = ep.poster_path;
  }

  const showList = Object.values(shows);
  document.getElementById('tv-count').textContent = `${showList.length} show${showList.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('tv-shows-grid');
  grid.innerHTML = showList.map(show => {
    const seasons = [...new Set(show.items.map(e => e.season).filter(Boolean))];
    const epCount = show.items.length;
    const seasonTxt = seasons.length ? `${seasons.length} season${seasons.length !== 1 ? 's' : ''}` : '';
    const epTxt = `${epCount} episode${epCount !== 1 ? 's' : ''}`;
    const poster = show.poster_path
      ? `<img class="tv-show-poster" src="${esc(show.poster_path)}" alt="${esc(show.name)}" loading="lazy" />`
      : `<div class="tv-show-poster-placeholder"><span style="font-size:32px">📺</span><span>${esc(show.name)}</span></div>`;
    return `
      <div class="tv-show-card" data-show="${esc(show.name)}">
        ${poster}
        <div class="tv-show-info">
          <div class="tv-show-name">${esc(show.name)}</div>
          <div class="tv-show-meta">${[seasonTxt, epTxt].filter(Boolean).join(' · ')}</div>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.tv-show-card').forEach(card => {
    card.addEventListener('click', () => openTvShow(card.dataset.show));
  });
}

function openTvShow(showName) {
  currentTvShow = showName;
  const items = allMedia.filter(m => (m.show_name || m.title) === showName && m.media_type === 'tv');
  const seasons = [...new Set(items.map(e => e.season).filter(s => s != null))].sort((a, b) => a - b);

  currentSeason = seasons[0] || null;

  const tvSec = document.getElementById('tv-section');
  tvSec.innerHTML = `
    <div class="tv-season-header">
      <button class="tv-back-btn" id="tv-back-btn">← All Shows</button>
      <span class="section-title">${esc(showName)}</span>
    </div>
    ${seasons.length > 1 ? `
    <div class="season-tabs" id="season-tabs">
      ${seasons.map(s => `<button class="season-tab${s === currentSeason ? ' active' : ''}" data-season="${s}">Season ${s}</button>`).join('')}
    </div>` : ''}
    <div class="episode-list" id="episode-list"></div>`;

  document.getElementById('tv-back-btn').addEventListener('click', () => {
    tvSec.innerHTML = '<div class="section-header"><span class="section-title">TV Shows</span><span class="section-count" id="tv-count"></span></div><div id="tv-shows-grid" class="tv-shows-grid"></div>';
    renderTvShows();
  });

  document.querySelectorAll('.season-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentSeason = parseInt(tab.dataset.season, 10);
      document.querySelectorAll('.season-tab').forEach(t => t.classList.toggle('active', t === tab));
      renderEpisodeList(items, currentSeason);
    });
  });

  renderEpisodeList(items, currentSeason);
}

function renderEpisodeList(items, season) {
  const episodes = items
    .filter(e => season == null || e.season === season)
    .sort((a, b) => (a.episode || 0) - (b.episode || 0));

  const list = document.getElementById('episode-list');
  if (!list) return;

  list.innerHTML = episodes.map(ep => {
    const pct = ep.duration > 0 ? Math.round((ep.position / ep.duration) * 100) : 0;
    const epNum = ep.episode != null ? ep.episode : '?';
    const progress = pct > 0 && pct < 95
      ? `<div class="episode-progress"><div class="episode-progress-bar" style="width:${pct}%"></div></div>` : '';
    return `
      <div class="episode-card" data-id="${ep.id}">
        <div class="episode-num">${epNum}</div>
        <div class="episode-info">
          <div class="episode-title">${esc(ep.title)}</div>
          ${progress}
        </div>
        <button class="episode-play-btn" data-id="${ep.id}" title="Play">▶</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.episode-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.episode-play-btn')) return;
      openModal(parseInt(card.dataset.id, 10));
    });
  });
  list.querySelectorAll('.episode-play-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      playMedia(parseInt(btn.dataset.id, 10));
    });
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Folder Browser ────────────────────────────────────────────────────────────
let _fbContext  = 'ob';   // 'ob' or 'settings'
let _fbCurrent  = null;

async function openFolderBrowser(context) {
  _fbContext = context;
  document.getElementById('folder-browser-overlay').classList.remove('hidden');
  await _fbNavigate(null);
}

function closeFolderBrowser(e) {
  if (e && e.target !== document.getElementById('folder-browser-overlay')) return;
  document.getElementById('folder-browser-overlay').classList.add('hidden');
}

async function _fbNavigate(dirPath) {
  _fbCurrent = dirPath;
  const pathLabel = document.getElementById('fb-current-path');
  const list      = document.getElementById('fb-list');
  const selectBtn = document.getElementById('fb-select-btn');

  pathLabel.textContent = dirPath || 'Select a starting location';
  selectBtn.disabled = !dirPath;
  list.innerHTML = '<div style="color:var(--text3);padding:12px">Loading…</div>';

  try {
    const url  = dirPath ? `/api/browse?path=${encodeURIComponent(dirPath)}` : '/api/browse';
    const data = await api(url);

    let html = '';

    // Parent folder link
    if (data.parent) {
      html += `<div class="fb-item fb-parent" onclick="_fbNavigate('${esc(data.parent)}')">
        <span class="fb-icon">⬆</span> <span>.. (Up)</span>
      </div>`;
    }

    // Suggestions shown when at root
    if (data.suggestions?.length) {
      html += '<div class="fb-section-label">Suggested media folders</div>';
      html += data.suggestions.map(s => `
        <div class="fb-item fb-suggestion" onclick="_fbNavigate('${esc(s)}')">
          <span class="fb-icon">📁</span>
          <span class="fb-name">${esc(s)}</span>
        </div>`).join('');
      if (data.entries?.length) html += '<div class="fb-section-label">All locations</div>';
    }

    // Sub-directories
    if (data.entries?.length) {
      html += data.entries.map(e => `
        <div class="fb-item" onclick="_fbNavigate('${esc(e.path)}')">
          <span class="fb-icon">📁</span>
          <span class="fb-name">${esc(e.name)}</span>
        </div>`).join('');
    } else if (!data.suggestions?.length) {
      html += '<div style="color:var(--text3);padding:12px;font-size:13px">No sub-folders found.</div>';
    }

    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = `<div style="color:var(--accent-red,#e05);padding:12px;font-size:13px">Error: ${esc(err.message)}</div>`;
  }
}

function folderBrowserSelect() {
  if (!_fbCurrent) return;
  document.getElementById('folder-browser-overlay').classList.add('hidden');

  if (_fbContext === 'ob') {
    document.getElementById('ob-folder-input').value = _fbCurrent;
    obAddFolder();
  } else {
    document.getElementById('settings-folder-input').value = _fbCurrent;
    settingsAddFolder();
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
boot();
