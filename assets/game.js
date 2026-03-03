(() => {
  "use strict";

  // ====== Spiel-Spezifikation (fix) ======
  const PHOTO_COUNT = 20;
  const TRACK_COUNT = 6;

  const AUDIO_TITLES = [
    "Bilder of the Backyard",
    "Liam’s Flight",
    "Little Footprints in the Sand",
    "Rain Day Kingdom",
    "Splash and Run",
    "Today Belongs to You"
  ];

  const PHOTO_EXTS = ["jpg", "png", "webp"];
  const TRACK_EXTS = ["mp3", "m4a", "ogg"];

  const N = 4;
  const TOTAL_PIECES = N * N;

  const SHUFFLE_AT = new Set([5, 10]);
  const SHUFFLE_DURATION_MS = 2000;

  const BLUR_START_PX = 22;
  const BLUR_END_PX = 0;

  // Timing (gefühlsecht)
  const REVEAL_DELAY_MS = 240;
  const MISMATCH_HOLD_MS = 520;
  const FLY_MS = 460;

  // Audio vibe
  const FADE_MS = 320;
  const DUCK_FACTOR = 0.72;      // during shuffle/match
  const DUCK_IN_MS = 140;
  const DUCK_OUT_MS = 220;

  // Image downscale (mobile-first)
  const MAX_IMAGE_PX = 2000;     // requested

  // ====== DOM ======
  const el = (id) => document.getElementById(id);

  const grid = el("grid");
  const solution = el("solution");
  const bgimg = el("bgimg");
  const stage = el("stage");
  const shuffleBanner = el("shuffleBanner");

  const triesEl = el("tries");
  const matchesEl = el("matches");
  const timeEl = el("time");
  const trackNameEl = el("trackName");

  const newRoundBtn = el("newRound");
  const pauseBtn = el("pauseBtn");
  const toggleAudioBtn = el("toggleAudio");
  const nextTrackBtn = el("nextTrack");
  const volume = el("volume");

  const pauseOverlay = el("pauseOverlay");
  const resumeBtn = el("resumeBtn");
  const pauseToStart = el("pauseToStart");
  const pauseNewRound = el("pauseNewRound");

  const winOverlay = el("winOverlay");
  const winImg = el("winImg");
  const confettiCanvas = el("confetti");
  const closeWin = el("closeWin");
  const winToStart = el("winToStart");
  const winNewRound = el("winNewRound");
  const winTries = el("winTries");
  const winTime = el("winTime");

  const toast = el("toast");
  const toastMsg = el("toastMsg");
  const toastClose = el("toastClose");

  function showToast(html){
    toastMsg.innerHTML = html;
    toast.classList.add("show");
  }
  function hideToast(){ toast.classList.remove("show"); }
  toastClose?.addEventListener("click", hideToast);

  // ====== Phase / Locking ======
  const Phase = Object.freeze({
    BUILDING: "BUILDING",
    READY: "READY",
    TWO_OPEN: "TWO_OPEN",
    MATCHING: "MATCHING",
    SHUFFLING: "SHUFFLING",
    PAUSED: "PAUSED",
    WON: "WON"
  });
  let phase = Phase.BUILDING;

  function setPhase(p){
    phase = p;
    newRoundBtn.disabled = (p !== Phase.READY && p !== Phase.TWO_OPEN && p !== Phase.WON);
    pauseBtn.disabled = (p === Phase.BUILDING);
    grid.style.pointerEvents = (p === Phase.READY || p === Phase.TWO_OPEN) ? "auto" : "none";
  }

  // ====== Helpers ======
  function shuffleInPlace(arr){
    for(let i = arr.length-1; i>0; i--){
      const j = Math.floor(Math.random() * (i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function mkPieceBg(pieceIndex){
    const x = pieceIndex % N;
    const y = Math.floor(pieceIndex / N);
    const bgSize = `${N*100}% ${N*100}%`;
    const bgPos  = `${(x*100)/(N-1)}% ${(y*100)/(N-1)}%`;
    return { bgSize, bgPos };
  }

  function blurForMatches(m){
    const t = Math.max(0, Math.min(1, m / TOTAL_PIECES));
    const blur = BLUR_START_PX + (BLUR_END_PX - BLUR_START_PX) * t;
    return Math.max(0, blur);
  }

  function applyBlur(){
    stage.style.setProperty("--blur", `${blurForMatches(matches).toFixed(2)}px`);
  }

  function showShuffleBanner(show){
    shuffleBanner.classList.toggle("show", !!show);
    grid.classList.toggle("shuffling", !!show);
  }

  function fmtTime(ms){
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2,"0");
    const ss = String(s % 60).padStart(2,"0");
    return `${mm}:${ss}`;
  }

  function prefersReducedMotion(){
    return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ====== Timer ======
  let startTs = 0;
  let pausedAccum = 0;
  let pauseStart = 0;
  let timerHandle = null;

  function timerNow(){
    if(startTs === 0) return 0;
    const base = performance.now() - startTs - pausedAccum;
    return Math.max(0, base);
  }

  function startTimer(){
    startTs = performance.now();
    pausedAccum = 0;
    pauseStart = 0;
    stopTimer();
    timerHandle = window.setInterval(() => {
      timeEl.textContent = fmtTime(timerNow());
    }, 250);
  }
  function stopTimer(){
    if(timerHandle){
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }
  function pauseTimer(){
    if(pauseStart === 0) pauseStart = performance.now();
  }
  function resumeTimer(){
    if(pauseStart !== 0){
      pausedAccum += performance.now() - pauseStart;
      pauseStart = 0;
    }
  }

  // ====== Assets ======
  async function existsViaFetch(url){
    try{
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      return res.ok;
    }catch(_){
      return false;
    }
  }

  function loadImage(url){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => reject(new Error("Image not found"));
      img.decoding = "async";
      img.src = url;
    });
  }

  async function imageExists(url){
    const ok = await existsViaFetch(url);
    if(ok) return true;
    try{ await loadImage(url); return true; }catch(_){ return false; }
  }

  // Downscale for smoothness
  let currentPhotoRevoke = null;

  async function downscaleToObjectUrl(srcUrl){
    let blob;
    try{
      const res = await fetch(srcUrl, { cache: "force-cache" });
      if(!res.ok) return { url: srcUrl, revoke: null };
      blob = await res.blob();
    }catch(_){
      return { url: srcUrl, revoke: null };
    }

    // decode to bitmap or img
    let w = 0, h = 0;
    let bitmap = null;

    try{
      bitmap = await createImageBitmap(blob);
      w = bitmap.width; h = bitmap.height;
    }catch(_){
      // fallback: create <img> from blob URL
      const tmpUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = "async";
      img.src = tmpUrl;
      await new Promise((res) => { img.onload = res; img.onerror = res; });
      w = img.naturalWidth || 1200;
      h = img.naturalHeight || 1200;
      // draw using img
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(w, h));
      if(scale >= 1){
        URL.revokeObjectURL(tmpUrl);
        return { url: srcUrl, revoke: null };
      }
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = tw; canvas.height = th;
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, tw, th);
      URL.revokeObjectURL(tmpUrl);

      const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      const outUrl = URL.createObjectURL(outBlob);
      return { url: outUrl, revoke: () => URL.revokeObjectURL(outUrl) };
    }

    const scale = Math.min(1, MAX_IMAGE_PX / Math.max(w, h));
    if(scale >= 1){
      bitmap.close?.();
      return { url: srcUrl, revoke: null };
    }

    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    let canvas, ctx;
    if("OffscreenCanvas" in window){
      canvas = new OffscreenCanvas(tw, th);
      ctx = canvas.getContext("2d", { alpha: false });
    }else{
      canvas = document.createElement("canvas");
      canvas.width = tw; canvas.height = th;
      ctx = canvas.getContext("2d", { alpha: false });
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close?.();

    let outBlob;
    if(canvas.convertToBlob){
      outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
    }else{
      outBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    }
    const outUrl = URL.createObjectURL(outBlob);
    return { url: outUrl, revoke: () => URL.revokeObjectURL(outUrl) };
  }

  let photoPool = null;
  async function buildPhotoPool(){
    const found = [];
    for(let i=1; i<=PHOTO_COUNT; i++){
      const base = `assets/photos/photo${String(i).padStart(2,"0")}`;
      for(const ext of PHOTO_EXTS){
        const url = `${base}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        if(await imageExists(url)){
          found.push(url);
          break;
        }
      }
    }
    photoPool = found;
    if(found.length === 0){
      showToast(`<b>Keine Fotos gefunden.</b><br/>Lege <code>photo01…photo20</code> in <code>assets/photos</code> ab.`);
    }
  }

  function placeholderSvg(){
    return "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7aa7ff"/><stop offset="1" stop-color="#1c2a55"/></linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <text x="50" y="140" font-family="system-ui" font-size="56" fill="rgba(255,255,255,.92)">Memory-Puzzle</text>
        <text x="50" y="220" font-family="system-ui" font-size="34" fill="rgba(255,255,255,.80)">Fotos fehlen → assets/photos/photo01…photo20</text>
      </svg>`
    );
  }

  async function pickRandomPhotoUrl(){
    if(photoPool === null) await buildPhotoPool();
    if(photoPool && photoPool.length > 0){
      const src = photoPool[Math.floor(Math.random() * photoPool.length)];
      const { url, revoke } = await downscaleToObjectUrl(src);
      if(currentPhotoRevoke){
        try{ currentPhotoRevoke(); }catch(_){}
      }
      currentPhotoRevoke = revoke;
      return url;
    }
    if(currentPhotoRevoke){
      try{ currentPhotoRevoke(); }catch(_){}
      currentPhotoRevoke = null;
    }
    return placeholderSvg();
  }

  // ====== Audio playlist (ducking + iOS safe) ======
  const audio = new Audio();
  audio.preload = "metadata";
  audio.loop = false;
  audio.volume = 0;
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");

  let trackPool = null;
  let trackIndex = 0;
  let targetVolume = parseFloat(volume.value);

  function canPlayAudioType(mime){
    const a = document.createElement("audio");
    return !!a.canPlayType && a.canPlayType(mime) !== "";
  }

  function preferredTrackExtOrder(){
    const order = [];
    if(canPlayAudioType("audio/mpeg")) order.push("mp3");
    if(canPlayAudioType("audio/mp4")) order.push("m4a");
    if(canPlayAudioType("audio/ogg")) order.push("ogg");
    for(const e of TRACK_EXTS){ if(!order.includes(e)) order.push(e); }
    return order;
  }

  function audioUrlExists(url, timeoutMs=1000){
    return new Promise((resolve) => {
      const a = new Audio();
      a.preload = "metadata";
      a.src = url;
      const done = (ok) => {
        a.removeEventListener("loadedmetadata", onOk);
        a.removeEventListener("canplay", onOk);
        a.removeEventListener("error", onErr);
        try{ a.src = ""; }catch(_){}
        resolve(ok);
      };
      const onOk = () => done(true);
      const onErr = () => done(false);
      const to = setTimeout(() => done(false), timeoutMs);
      a.addEventListener("loadedmetadata", () => { clearTimeout(to); onOk(); }, { once: true });
      a.addEventListener("canplay", () => { clearTimeout(to); onOk(); }, { once: true });
      a.addEventListener("error", () => { clearTimeout(to); onErr(); }, { once: true });
      try{ a.load(); }catch(_){}
    });
  }

  async function buildTrackPool(){
    const exts = preferredTrackExtOrder();
    const found = [];
    for(let i=1; i<=TRACK_COUNT; i++){
      const base = `assets/music/track${String(i).padStart(2,"0")}`;
      let got = false;
      for(const ext of exts){
        const url = `${base}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        if(await existsViaFetch(url)){
          found.push(url); got = true; break;
        }
        // eslint-disable-next-line no-await-in-loop
        if(await audioUrlExists(url)){
          found.push(url); got = true; break;
        }
      }
      if(!got){ /* optional missing */ }
    }
    trackPool = found;
    trackIndex = 0;
    updateTrackLabel();
  }

 function updateTrackLabel(){
  if(!trackPool || trackPool.length === 0){
    trackNameEl.textContent = "—";
    return;
  }

  if(typeof AUDIO_TITLES !== "undefined" && AUDIO_TITLES[trackIndex]){
    trackNameEl.textContent = AUDIO_TITLES[trackIndex];
  } else {
    trackNameEl.textContent = `Track ${trackIndex+1}`;
  }
}

  function setPlayButton(isPlaying){
    toggleAudioBtn.textContent = isPlaying ? "Stop" : "Play";
    toggleAudioBtn.setAttribute("aria-pressed", String(isPlaying));
  }

  let rampToken = 0;
  function rampVolume(from, to, ms){
    const token = ++rampToken;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (t) => {
        if(token !== rampToken) return resolve(false);
        const k = Math.min(1, (t - t0) / ms);
        audio.volume = from + (to - from) * k;
        if(k < 1) requestAnimationFrame(step);
        else resolve(true);
      };
      requestAnimationFrame(step);
    });
  }

  async function duckOn(){
    if(audio.paused) return;
    await rampVolume(audio.volume, Math.max(0, targetVolume * DUCK_FACTOR), DUCK_IN_MS);
  }
  async function duckOff(){
    if(audio.paused) return;
    await rampVolume(audio.volume, targetVolume, DUCK_OUT_MS);
  }

  async function playAudio(){
    try{
      if(trackPool === null) await buildTrackPool();
      if(!trackPool || trackPool.length === 0){
        showToast(`<b>Keine Musik gefunden.</b><br/>Lege <code>track01…track06</code> in <code>assets/music</code> ab.`);
        setPlayButton(false);
        return;
      }
      targetVolume = parseFloat(volume.value);
      if(!audio.src) audio.src = trackPool[trackIndex];

      audio.volume = 0;
      try{ audio.load(); }catch(_){}
      await audio.play();
      setPlayButton(true);
      await rampVolume(0, targetVolume, FADE_MS + 200);
    }catch(e){
      console.warn("Audio play blocked/failed:", e);
      setPlayButton(false);
      showToast(`<b>Audio konnte nicht starten.</b><br/>Am Handy braucht es meist einen Tap auf „Play“.`);
    }
  }

  async function stopAudio(){
    await rampVolume(audio.volume, 0, FADE_MS);
    audio.pause();
    setPlayButton(false);
  }

  async function nextTrack(){
    if(trackPool === null) await buildTrackPool();
    if(!trackPool || trackPool.length === 0){
      showToast(`<b>Keine Musik gefunden.</b><br/>Lege <code>track01…track06</code> in <code>assets/music</code> ab.`);
      return;
    }
    const wasPlaying = !audio.paused;
    if(wasPlaying) await rampVolume(audio.volume, 0, FADE_MS);
    trackIndex = (trackIndex + 1) % trackPool.length;
    audio.src = trackPool[trackIndex];
    updateTrackLabel();
    if(wasPlaying){
      audio.volume = 0;
      await audio.play().catch(() => {});
      await rampVolume(0, targetVolume, FADE_MS + 200);
    }
  }

  audio.addEventListener("ended", () => {
    if(!trackPool || trackPool.length === 0) return;
    trackIndex = (trackIndex + 1) % trackPool.length;
    audio.src = trackPool[trackIndex];
    updateTrackLabel();
    audio.volume = 0;
    audio.play().then(() => rampVolume(0, targetVolume, FADE_MS + 200)).catch(() => setPlayButton(false));
  });
  audio.addEventListener("error", () => {
    if(!trackPool || trackPool.length === 0) return;
    trackIndex = (trackIndex + 1) % trackPool.length;
    audio.src = trackPool[trackIndex];
    updateTrackLabel();
    audio.play().catch(() => setPlayButton(false));
  });

  toggleAudioBtn.addEventListener("click", () => {
    if(audio.paused) playAudio();
    else stopAudio();
  });
  nextTrackBtn.addEventListener("click", () => nextTrack());
  volume.addEventListener("input", () => {
    targetVolume = parseFloat(volume.value);
    if(!audio.paused) audio.volume = targetVolume;
  });

  // ====== Haptik ======
  function vibrate(ms){
    try{ if("vibrate" in navigator) navigator.vibrate(ms); }catch(_){}
  }

  // ====== Game model ======
  let cards = [];
  let firstPick = null;
  let tries = 0;
  let matches = 0;
  let photoUrl = "";

  function updateStats(){
    triesEl.textContent = String(tries);
    matchesEl.textContent = String(matches);
  }

  function setGridTemplates(){
    grid.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
    solution.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
  }

  function renderSolutionSlots(){
    solution.innerHTML = "";
    for(let i=0; i<TOTAL_PIECES; i++){
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.slot = String(i);
      const spark = document.createElement("div");
      spark.className = "spark";
      slot.appendChild(spark);
      solution.appendChild(slot);
    }
  }

  function createCardElement(card){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    btn.setAttribute("aria-label", "Karte");
    btn.dataset.cardId = String(card.id);

    const back = document.createElement("div");
    back.className = "face back";
    back.textContent = "★";

    const front = document.createElement("div");
    front.className = "face front";
    const { bgSize, bgPos } = mkPieceBg(card.pieceIndex);
    front.style.backgroundImage = `url('${photoUrl}')`;
    front.style.backgroundSize = bgSize;
    front.style.backgroundPosition = bgPos;

    btn.appendChild(back);
    btn.appendChild(front);
    return btn;
  }

  function rebuildGridDOM(){
    grid.innerHTML = "";
    for(const c of cards){
      if(c.matched) continue;
      grid.appendChild(c.el);
    }
  }

  grid.addEventListener("pointerup", (ev) => {
    const target = ev.target?.closest?.(".tile");
    if(!target) return;
    onPick(Number(target.dataset.cardId));
  });

  function closeAllUnmatched(){
    for(const c of cards){
      if(!c.matched) c.el.classList.remove("revealed");
    }
  }

  function slotSparkle(pieceIndex){
    const slot = solution.querySelector(`.slot[data-slot="${pieceIndex}"]`);
    if(!slot) return;
    slot.classList.remove("sparkle");
    void slot.offsetWidth;
    slot.classList.add("sparkle");
  }

  async function animateFlyToSlot(fromEl, pieceIndex){
    const rectFrom = fromEl.getBoundingClientRect();
    const slot = solution.querySelector(`.slot[data-slot="${pieceIndex}"]`);
    if(!slot) return;

    const rectTo = slot.getBoundingClientRect();
    const { bgSize, bgPos } = mkPieceBg(pieceIndex);

    const flyer = document.createElement("div");
    flyer.className = "flying";
    flyer.style.left = rectFrom.left + "px";
    flyer.style.top = rectFrom.top + "px";
    flyer.style.width = rectFrom.width + "px";
    flyer.style.height = rectFrom.height + "px";
    flyer.style.backgroundImage = `url('${photoUrl}')`;
    flyer.style.backgroundSize = bgSize;
    flyer.style.backgroundPosition = bgPos;
    document.body.appendChild(flyer);

    const dx = rectTo.left - rectFrom.left;
    const dy = rectTo.top - rectFrom.top;
    const sx = rectTo.width / rectFrom.width;
    const sy = rectTo.height / rectFrom.height;

    flyer.style.transform = `translate3d(0,0,0) scale(1,1) rotate(0deg)`;
    await new Promise(r => requestAnimationFrame(r));

    flyer.style.transition = `transform ${FLY_MS}ms cubic-bezier(.2,.9,.2,1), opacity ${FLY_MS}ms ease`;
    flyer.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy}) rotate(${(Math.random()*6-3).toFixed(2)}deg)`;
    flyer.style.opacity = "0.98";

    await new Promise((resolve) => {
      const done = () => resolve();
      flyer.addEventListener("transitionend", done, { once: true });
      setTimeout(done, FLY_MS + 90);
    });

    flyer.remove();

    slot.classList.add("filled");
    slot.innerHTML = `<div class="spark"></div>`;
    const piece = document.createElement("div");
    piece.className = "piece";
    piece.style.backgroundImage = `url('${photoUrl}')`;
    piece.style.backgroundSize = bgSize;
    piece.style.backgroundPosition = bgPos;
    slot.appendChild(piece);

    slotSparkle(pieceIndex);
  }

  async function swirlShuffleRemaining(){
    const remaining = cards.filter(c => !c.matched);
    if(remaining.length <= 2) return;

    setPhase(Phase.SHUFFLING);
    await duckOn();
    showShuffleBanner(true);
    remaining.forEach(c => c.el.classList.remove("revealed"));

    const firstRects = new Map();
    for(const c of remaining) firstRects.set(c.id, c.el.getBoundingClientRect());

    const remShuffled = shuffleInPlace([...remaining]);
    cards = [...remShuffled, ...cards.filter(c => c.matched)];
    rebuildGridDOM();

    await new Promise(r => requestAnimationFrame(r));

    // (No per-card promises needed; one sleep is enough)
    await new Promise(r => setTimeout(r, SHUFFLE_DURATION_MS));

    remaining.forEach(c => {
      c.el.style.transition = "";
      c.el.style.transform = "";
      c.el.style.willChange = "";
    });

    showShuffleBanner(false);
    await duckOff();
    setPhase(Phase.READY);
  }

  // ====== Win / Confetti (adaptive) ======
  function showOverlay(overlayEl, show){
    overlayEl.classList.toggle("show", !!show);
    overlayEl.setAttribute("aria-hidden", String(!show));
  }

  function runConfetti(){
    if(prefersReducedMotion()) return;

    const c = confettiCanvas;
    const ctx = c.getContext("2d");
    if(!ctx) return;

    const rect = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.floor(rect.width * dpr));
    c.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = rect.height;
    const area = W * H;

    let count = 120;
    if(area < 450000) count = 70;
    if(area < 280000) count = 50;
    if(dpr >= 2) count = Math.floor(count * 0.85);

    const parts = [];
    for(let i=0; i<count; i++){
      parts.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.2,
        vx: (Math.random() - 0.5) * 1.6,
        vy: 1.2 + Math.random() * 2.8,
        r: 2 + Math.random() * 4,
        a: 0.8 + Math.random() * 0.2,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.16
      });
    }

    const t0 = performance.now();
    const dur = area < 280000 ? 900 : 1200;

    const draw = (t) => {
      const dt = t - t0;
      ctx.clearRect(0,0,W,H);

      for(const p of parts){
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.vy += 0.012;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.a;

        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.fillRect(-p.r, -p.r/2, p.r*2, p.r);

        ctx.fillStyle = "rgba(122,167,255,.65)";
        ctx.fillRect(-p.r/2, -p.r, p.r, p.r*2);

        ctx.restore();
      }

      if(dt < dur) requestAnimationFrame(draw);
      else ctx.clearRect(0,0,W,H);
    };
    requestAnimationFrame(draw);
  }

  async function onWin(){
    setPhase(Phase.WON);
    stopTimer();

    winImg.style.backgroundImage = `url('${photoUrl}')`;
    winTries.textContent = String(tries);
    winTime.textContent = timeEl.textContent;

    showOverlay(winOverlay, true);
    runConfetti();
    vibrate(25);
  }

  // ====== Match flow ======
  async function onMatch(cardA, cardB){
    setPhase(Phase.MATCHING);
    await duckOn();

    cardA.matched = true;
    cardB.matched = true;

    cardA.el.setAttribute("aria-disabled", "true");
    cardB.el.setAttribute("aria-disabled", "true");

    await Promise.all([
      animateFlyToSlot(cardA.el, cardA.pieceIndex),
      animateFlyToSlot(cardB.el, cardB.pieceIndex)
    ]);

    cardA.el.remove();
    cardB.el.remove();

    matches += 1;
    updateStats();
    applyBlur();
    vibrate(10);

    await duckOff();

    if(matches >= TOTAL_PIECES){
      applyBlur();
      await new Promise(r => setTimeout(r, 180));
      await onWin();
      return;
    }

    if(SHUFFLE_AT.has(matches)){
      await swirlShuffleRemaining();
      return;
    }

    setPhase(Phase.READY);
  }

  async function onPick(cardId){
    if(phase !== Phase.READY && phase !== Phase.TWO_OPEN) return;

    const card = cards.find(c => c.id === cardId);
    if(!card || card.matched) return;
    if(card.el.classList.contains("revealed")) return;

    card.el.classList.add("revealed");

    if(!firstPick){
      firstPick = card;
      setPhase(Phase.TWO_OPEN);
      return;
    }

    const secondPick = card;
    tries += 1;
    updateStats();

    const isMatch = firstPick.pieceIndex === secondPick.pieceIndex;

    if(isMatch){
      const a = firstPick, b = secondPick;
      firstPick = null;
      await new Promise(r => setTimeout(r, REVEAL_DELAY_MS));
      await onMatch(a, b);
    }else{
      setPhase(Phase.MATCHING);
      await duckOn();

      const a = firstPick, b = secondPick;
      firstPick = null;

      await new Promise(r => setTimeout(r, MISMATCH_HOLD_MS));
      a.el.classList.remove("revealed");
      b.el.classList.remove("revealed");
      closeAllUnmatched();

      await duckOff();
      setPhase(Phase.READY);
    }
  }

  // ====== Pause ======
  async function setPaused(on){
    if(on){
      if(phase === Phase.WON || phase === Phase.PAUSED) return;
      pauseTimer();
      if(!audio.paused){
        await rampVolume(audio.volume, Math.max(0, audio.volume * 0.35), 180);
      }
      showOverlay(pauseOverlay, true);
      setPhase(Phase.PAUSED);
    }else{
      if(phase !== Phase.PAUSED) return;
      showOverlay(pauseOverlay, false);
      resumeTimer();
      if(!audio.paused){
        await rampVolume(audio.volume, targetVolume, 220);
      }
      setPhase(Phase.READY);
      firstPick = null;
      closeAllUnmatched();
    }
  }

  pauseBtn.addEventListener("click", () => setPaused(true));
  resumeBtn.addEventListener("click", () => setPaused(false));
  pauseToStart.addEventListener("click", () => { window.location.href = "index.html"; });
  pauseNewRound.addEventListener("click", async () => {
    await setPaused(false);
    await buildNewRound();
  });

  closeWin.addEventListener("click", () => showOverlay(winOverlay, false));
  winToStart.addEventListener("click", () => { window.location.href = "index.html"; });
  winNewRound.addEventListener("click", () => buildNewRound());

  pauseOverlay.addEventListener("click", (e) => {
    if(e.target === pauseOverlay) setPaused(false);
  });
  winOverlay.addEventListener("click", (e) => {
    if(e.target === winOverlay) showOverlay(winOverlay, false);
  });

  // ====== Keyboard shortcuts ======
  window.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      if(pauseOverlay.classList.contains("show")) setPaused(false);
      if(winOverlay.classList.contains("show")) showOverlay(winOverlay, false);
      return;
    }
    if(e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

    const k = e.key.toLowerCase();
    if(k === "p"){
      if(phase === Phase.PAUSED) setPaused(false);
      else setPaused(true);
    }
    if(k === "m"){
      if(audio.paused) playAudio();
      else stopAudio();
    }
    if(k === "n"){
      nextTrack();
    }
  });

  // ====== Build round ======
  async function buildNewRound(){
    setPhase(Phase.BUILDING);
    showOverlay(winOverlay, false);
    showOverlay(pauseOverlay, false);

    firstPick = null;
    tries = 0;
    matches = 0;
    updateStats();

    photoUrl = await pickRandomPhotoUrl();
    bgimg.style.backgroundImage = `url('${photoUrl}')`;

    applyBlur();
    renderSolutionSlots();

    const pool = [];
    for(let i=0; i<TOTAL_PIECES; i++) pool.push(i, i);
    shuffleInPlace(pool);

    cards = pool.map((pieceIndex, id) => ({ id, pieceIndex, matched:false, el:null }));
    for(const c of cards){
      c.el = createCardElement(c);
    }

    setGridTemplates();
    rebuildGridDOM();

    startTimer();
    timeEl.textContent = "00:00";

    setPhase(Phase.READY);
  }

  setGridTemplates();
  buildNewRound();

  newRoundBtn.addEventListener("click", () => {
    if(phase === Phase.READY || phase === Phase.TWO_OPEN || phase === Phase.WON){
      buildNewRound();
    }
  });

  window.addEventListener("beforeunload", () => {
    if(currentPhotoRevoke){
      try{ currentPhotoRevoke(); }catch(_){}
    }
  });
})();