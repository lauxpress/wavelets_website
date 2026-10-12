/* Wavelets — sintonizador.
 * El scroll mueve una aguja continua `pos` (0 = episodio más nuevo). Cerca de un entero
 * la señal se engancha (lock → 1): la onda del episodio queda estable, su contenido
 * aparece y el dial marca el canal. Entre enteros: ruido y mezcla de frecuencias.
 */
(function () {
  "use strict";
  const DATA = (window.WAVELETS && window.WAVELETS.episodes) || [];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- DOM ----------
  const stage = $("#stage"), track = $("#track"), dial = $("#dial");
  const layers = DATA.map((ep, i) => {
    const el = document.createElement("article");
    el.className = "ep";
    el.setAttribute("aria-hidden", "true");
    const quotes = (ep.quotes || []).slice(0, 3);
    const slots = ["q-a", "q-b", "q-c"];
    const yt = ep.links && ep.links.youtube;
    const links = [];
    if (ep.links && ep.links.youtube) links.push(`<a href="${esc(ep.links.youtube)}" target="_blank" rel="noopener">▶ YOUTUBE</a>`);
    if (ep.links && ep.links.spotify) links.push(`<a href="${esc(ep.links.spotify)}" target="_blank" rel="noopener">♪ SPOTIFY</a>`);
    el.innerHTML = `
      <div class="ep-num" aria-hidden="true">${ep.n}</div>
      <figure class="ep-photo"><img src="${esc(ep.photo)}" alt="${esc(ep.guest)}" loading="lazy" decoding="async"><figcaption>CH ${ep.n}</figcaption></figure>
      <figure class="ep-thumb">
        ${yt ? `<a class="scr" href="${esc(yt)}" target="_blank" rel="noopener" aria-label="Ver el episodio ${ep.n} en YouTube"><img src="${esc(ep.thumb)}" alt="Thumbnail del episodio ${ep.n}" loading="lazy" decoding="async"><span class="play" aria-hidden="true">▶</span></a>`
             : `<div class="scr"><img src="${esc(ep.thumb)}" alt="Thumbnail del episodio ${ep.n}" loading="lazy" decoding="async"></div>`}
        <figcaption><span>EP. ${ep.n} · ${ep.n} HZ</span><span>${links.join(" ") || (ep.published ? "" : "PRÓXIMAMENTE")}</span></figcaption>
      </figure>
      <div class="ep-meta">
        <p class="ep-kicker">EPISODIO <b>${ep.n}</b>${ep.published ? "" : '<span class="ep-tag">PRÓXIMO</span>'}</p>
        <h2 class="ep-guest">${esc(ep.guest)}</h2>
        ${ep.role ? `<p class="ep-role">${esc(ep.role)}</p>` : ""}
        <p class="ep-title">${esc(ep.title)}</p>
        ${yt ? `<a class="ep-watch" href="${esc(yt)}" target="_blank" rel="noopener">▶ VER EN YOUTUBE</a>` : ""}
      </div>
      ${quotes.map((q, k) => `<blockquote class="ep-quote ${slots[k]}${q.length > 90 ? " long" : ""}">${esc(q)}</blockquote>`).join("")}`;
    stage.appendChild(el);

    const slot = document.createElement("section");
    slot.className = "slot"; slot.id = `ep-${ep.n}`;
    slot.setAttribute("aria-label", `Episodio ${ep.n}: ${ep.guest}`);
    track.appendChild(slot);

    const b = document.createElement("button");
    b.type = "button"; b.title = `Ep. ${ep.n} — ${ep.guest}`;
    b.innerHTML = `<span>${ep.n}</span>`;
    b.addEventListener("click", () => goTo(i));
    dial.appendChild(b);
    return { el, quotes: [...el.querySelectorAll(".ep-quote")], dial: b, ep, vis: -1 };
  });

  // cierre
  const end = document.createElement("section");
  end.className = "slot-end"; end.id = "fin";
  track.appendChild(end);
  const outro = document.createElement("div");
  outro.className = "outro";
  outro.innerHTML = `<div><img src="assets/logo.png" alt="Wavelets"><p>${DATA.length} frecuencias. Seguimos transmitiendo.</p>
    <div class="outro-links"><a href="#ep-${DATA[0] ? DATA[0].n : ""}">↑ VOLVER AL ÚLTIMO</a><a href="https://www.instagram.com/wavelets_podcast/" target="_blank" rel="noopener">INSTAGRAM ↗</a></div></div>`;
  $("#screen").appendChild(outro);
  $(".brand").addEventListener("click", (e) => { e.preventDefault(); goTo(0); });

  function goTo(i) {
    window.scrollTo({ top: i * window.innerHeight, behavior: reduced ? "auto" : "smooth" });
  }

  // ---------- Osciloscopio ----------
  const scope = new window.WaveletScope($("#scope"), $("#grid"), { reduced, bloom: $("#bloom") });
  // encendido del tubo (CSS): línea horizontal que se abre; después se saca la clase
  if (!reduced) {
    document.body.classList.add("poweron");
    setTimeout(() => document.body.classList.remove("poweron"), 1300);
  }

  // grano del vidrio (textura chica, se repinta pocas veces por segundo)
  const grain = $("#grain"), gctx = grain.getContext("2d");
  grain.width = 220; grain.height = 140;
  function paintGrain() {
    const img = gctx.createImageData(grain.width, grain.height);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    gctx.putImageData(img, 0, 0);
  }
  paintGrain();

  // ---------- Lectura ----------
  const freqEl = $("#freq"), stateEl = $("#lockstate"), dotEl = $("#lockdot"), chEl = $("#channel");
  const knobF = $("#knob-freq"), knobI = $("#knob-int"), led = $("#led");
  let lastLocked = false;

  // ---------- Sonido (opcional; el navegador exige un click) ----------
  const soundBtn = $("#sound");
  let audio = null;
  soundBtn.addEventListener("click", () => {
    if (!audio) audio = makeAudio();
    const on = soundBtn.getAttribute("aria-pressed") !== "true";
    soundBtn.setAttribute("aria-pressed", String(on));
    audio.setOn(on);
  });
  function makeAudio() {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    // la frecuencia del episodio + armónicos (en parlantes chicos 30–60 Hz casi no se oyen)
    const tone = ac.createGain(); tone.gain.value = 0; tone.connect(master);
    const oscs = [1, 2, 3, 4].map((h) => {
      const o = ac.createOscillator(); o.type = "sine";
      const g = ac.createGain(); g.gain.value = [.55, .35, .18, .1][h - 1];
      o.connect(g); g.connect(tone); o.start(); return { o, h };
    });
    // estática filtrada para la sintonía
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = .6;
    const ng = ac.createGain(); ng.gain.value = 0;
    noise.connect(bp); bp.connect(ng); ng.connect(master); noise.start();

    // radio vieja para las voces: parlante chico (banda 380–2900 Hz con panza en los medios),
    // válvula saturando suave, el volumen que "respira" y chisporroteo de fondo
    const radio = ac.createGain(); radio.gain.value = 0; radio.connect(ac.destination);
    const biq = (type, f, q, g = 0) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };
    const hp = biq("highpass", 380, .8), mid = biq("peaking", 1600, 1, 6), lp = biq("lowpass", 2900, 1.2);
    const shaper = ac.createWaveShaper(); shaper.oversample = "2x";
    shaper.curve = Float32Array.from({ length: 1024 }, (_, i) => { const x = i / 511.5 - 1; return Math.tanh(2.4 * x) / Math.tanh(2.4); });
    const wob = ac.createGain();
    const lfo = ac.createOscillator(); lfo.frequency.value = .37;
    const lfoG = ac.createGain(); lfoG.gain.value = .12; lfo.connect(lfoG); lfoG.connect(wob.gain); lfo.start();
    hp.connect(mid); mid.connect(shaper); shaper.connect(lp); lp.connect(wob); wob.connect(radio);
    const cbuf = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), c = cbuf.getChannelData(0);
    for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * .05 + (Math.random() < .0009 ? (Math.random() * 2 - 1) * .9 : 0);
    const crackle = ac.createBufferSource(); crackle.buffer = cbuf; crackle.loop = true;
    const chp = biq("highpass", 1200, .7), cg = ac.createGain(); cg.gain.value = .22;
    crackle.connect(chp); chp.connect(cg); cg.connect(radio); crackle.start();

    let on = false, speaking = false;
    return {
      ac, voiceIn: hp,
      get on() { return on; },
      setOn(v) {
        on = v; if (ac.state === "suspended") ac.resume();
        master.gain.setTargetAtTime(v ? .09 : 0, ac.currentTime, .15);
        if (!v) radio.gain.setTargetAtTime(0, ac.currentTime, .1);
      },
      setSpeaking(v) { speaking = v; },
      update(f, lock) {
        if (!on) return;
        const now = ac.currentTime;
        for (const { o, h } of oscs) o.frequency.setTargetAtTime(f * h, now, .05);
        // mientras habla el invitado, el tono baja a un zumbido de fondo
        tone.gain.setTargetAtTime((.25 + .75 * lock) * (speaking ? .3 : 1), now, .08);
        ng.gain.setTargetAtTime((1 - lock) * .55, now, .05);
        bp.frequency.setTargetAtTime(600 + Math.random() * 2600, now, .03);
        // la voz emerge de la estática a medida que engancha, y se hunde en ella al irse
        radio.gain.setTargetAtTime(smooth(.55, .97, lock) * .9, now, .06);
      },
    };
  }

  // ---------- Voces: frases del invitado al quedar sintonizado ----------
  const voiceBufs = new Map();
  function loadVoice(src) {
    if (!voiceBufs.has(src)) {
      voiceBufs.set(src, fetch(src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => audio.ac.decodeAudioData(b)).catch(() => null));
    }
    return voiceBufs.get(src);
  }
  const voice = { ep: -1, k: 0, node: null, quote: null, nextAt: 0, token: 0 };
  function stopVoice() {
    voice.token++;
    if (voice.node) { try { voice.node.stop(audio.ac.currentTime + .25); } catch (e) { /* ya terminó */ } }
    voice.node = null;
    if (voice.quote) voice.quote.classList.remove("speaking");
    voice.quote = null;
    if (audio) audio.setSpeaking(false);
  }
  function updateVoice(near, lock, locked) {
    if (!audio || !audio.on) { if (voice.ep !== -1) { stopVoice(); voice.ep = -1; } return; }
    const L = layers[near];
    const list = L && L.ep.voices ? L.ep.voices : [];
    if (lock < .3 || near !== voice.ep) {                         // se fue del canal: soltar la voz
      if (voice.ep !== -1) { stopVoice(); voice.ep = -1; }
      if (!locked || !list.length) return;
    }
    if (voice.ep === -1) {                                         // recién enganchado
      voice.ep = near; voice.k = 0; voice.nextAt = audio.ac.currentTime + .8;
      list.forEach((v) => loadVoice(v.src));
    }
    if (voice.node || audio.ac.currentTime < voice.nextAt || !locked) return;
    const v = list[voice.k % list.length], token = ++voice.token;
    voice.nextAt = Infinity;                                       // esperando el decode
    loadVoice(v.src).then((buf) => {
      if (token !== voice.token) return;
      if (!buf) { voice.k++; voice.nextAt = audio.ac.currentTime + .5; return; }
      const node = audio.ac.createBufferSource(); node.buffer = buf; node.connect(audio.voiceIn);
      node.onended = () => {
        if (token !== voice.token) return;
        if (voice.quote) voice.quote.classList.remove("speaking");
        voice.node = null; voice.quote = null; audio.setSpeaking(false);
        voice.k++;
        voice.nextAt = audio.ac.currentTime + (voice.k % list.length === 0 ? 10 : 1.4);   // pausa larga al dar la vuelta
      };
      node.start();
      voice.node = node; audio.setSpeaking(true);
      voice.quote = layers[voice.ep].el.querySelectorAll(".ep-quote")[v.q] || null;
      if (voice.quote) voice.quote.classList.add("speaking");
    });
  }

  // ---------- Bucle ----------
  const hint = $("#hint");
  let pos = -0.5;                       // arranca "fuera de sintonía" y engancha el último
  let target = 0;
  let t0 = performance.now(), last = t0, grainT = 0;

  function readScroll() {
    const h = window.innerHeight;
    // alto 0 (pestaña abierta en segundo plano) daría NaN y la aguja quedaría trabada
    target = h > 0 ? window.scrollY / h : target;
    if (target > .15) hint.classList.add("gone");
  }
  // el dial se achica para que entren todos los canales en la pantalla
  function fitDial() {
    // vive dentro de la pantalla: deja libre la franja del readout (arriba) y del hint (abajo)
    const h = ($("#screen") || document.documentElement).clientHeight;
    const tick = Math.max(5, Math.min(18, (h * .66) / Math.max(1, DATA.length) - 2));
    dial.style.setProperty("--tick", tick + "px");
  }
  window.addEventListener("scroll", readScroll, { passive: true });
  window.addEventListener("resize", () => { readScroll(); fitDial(); });
  readScroll();
  fitDial();

  function tick(now) {
    const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now;
    const t = Math.max(0, (now - t0) / 1000);
    const k = reduced ? 1 : 1 - Math.pow(.0009, dt);      // seguimiento suave de la aguja
    pos += (target - pos) * k;
    if (!Number.isFinite(pos)) pos = Number.isFinite(target) ? target : 0;

    const maxI = DATA.length - 1;
    const p = Math.max(0, Math.min(maxI, pos));
    const i0 = Math.min(maxI, Math.floor(p)), i1 = Math.min(maxI, i0 + 1);
    const f = p - i0;
    const dist = Math.min(f, 1 - f) + Math.max(0, -pos);
    const lock = 1 - smooth(.035, .3, dist);
    const nA = DATA[i0] ? DATA[i0].n : 1, nB = DATA[i1] ? DATA[i1].n : nA;
    const off = smooth(maxI + .15, maxI + .75, pos);         // después del último: fin de transmisión

    scope.frame({ nA, nB, s: f, lock, t, dt, off });

    // lectura de frecuencia: barre entre canales y "baila" mientras busca
    const fHz = nA + (nB - nA) * smooth(0, 1, f);
    const wobble = (1 - lock) * ((Math.random() - .5) * 6);
    const ended = off > .5;
    freqEl.textContent = ended ? "--.--" : (fHz + wobble).toFixed(2);
    const locked = lock > .92 && !ended;
    stateEl.textContent = ended ? "FIN DE TRANSMISIÓN" : (locked ? "SINTONIZADO" : "BUSCANDO SEÑAL");
    dotEl.classList.toggle("lock", locked);
    const near = Math.round(p);
    chEl.textContent = DATA[near] ? `CH ${String(near + 1).padStart(2, "0")}/${DATA.length}` : "";
    if (locked && !lastLocked) scope.flash = 1;             // destello al enganchar
    // gabinete: la perilla FREQ gira con el dial, INTENS respira con el enganche, la luz marca LOCK
    if (knobF) knobF.style.setProperty("--rot", (pos * 24).toFixed(1) + "deg");
    if (knobI) knobI.style.setProperty("--rot", (-40 + lock * 80).toFixed(1) + "deg");
    if (led) led.classList.toggle("on", locked);
    lastLocked = locked;
    if (audio) { audio.update(fHz, ended ? 0 : lock); updateVoice(near, ended ? 0 : lock, locked); }

    // capas: solo las dos cercanas están vivas
    layers.forEach((L, i) => {
      const d = Math.abs(pos - i);
      let v = d < 1 ? smooth(.42, .06, d) * (0.15 + .85 * lock) : 0;
      if (v < .002) v = 0;
      if (Math.abs(v - L.vis) < .004) return;
      L.vis = v;
      const el = L.el;
      el.classList.toggle("live", v > 0);
      el.classList.toggle("on", v > .6);
      el.setAttribute("aria-hidden", v > .6 ? "false" : "true");
      el.style.opacity = v.toFixed(3);
      if (!reduced) {
        const glitch = (1 - v) * (Math.random() - .5) * 26;
        el.style.transform = v < .999 ? `translate3d(${glitch.toFixed(1)}px,0,0)` : "none";
        el.style.filter = v < .999 ? `blur(${((1 - v) * 5).toFixed(2)}px)` : "none";
      }
      // las frases entran de a una, después de la onda
      L.quotes.forEach((q, j) => q.style.setProperty("--qv", smooth(.55 + j * .12, .92 + j * .03, v).toFixed(3)));
      L.dial.classList.toggle("on", v > .6);
    });

    // cierre: aparece al pasar el último canal
    const ov = smooth(maxI + .25, maxI + .85, pos);
    outro.style.opacity = ov.toFixed(3);
    outro.classList.toggle("live", ov > .01);

    grainT += dt;
    if (!reduced && grainT > .08) { paintGrain(); grainT = 0; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // teclado: flechas saltan de canal (el snap de CSS ya lo hace, esto lo hace preciso)
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,textarea")) return;
    const cur = Math.round(window.scrollY / window.innerHeight);
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); goTo(Math.min(DATA.length, cur + 1)); }
    if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); goTo(Math.max(0, cur - 1)); }
    if (e.key === "Home") { e.preventDefault(); goTo(0); }
    if (e.key === "End") { e.preventDefault(); goTo(DATA.length); }
  });
})();
