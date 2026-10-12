/* Osciloscopio de rayos catódicos (pantalla vectorial de fósforo).
 *
 * Cada episodio N es UNA senoidal bajo una ventana gaussiana (una "wavelet", como el logo):
 * N/2 ciclos a lo ancho y la portadora avanzando a N Hz (desacelerado ×1/TIME_SCALE).
 *
 * Lo que la hace parecer un tubo de verdad:
 * - el brillo depende de la VELOCIDAD del haz: tramos rápidos (flancos) más tenues que las
 *   crestas, donde el haz se demora;
 * - vidrio curvo: distorsión de barril en trazo y graticula;
 * - barrido: la zona recién escrita por el haz brilla más y se ve la cabeza del haz;
 * - persistencia del fósforo (estela) + halo difuso (canvas #bloom con blur por CSS);
 * - "pelusa" del haz y un parpadeo mínimo de la fuente.
 *
 * Sintonizando: mezcla de la señal que se va y la que llega (batido), parciales al azar que
 * se solapan, ruido, pérdida de sincronía y rodado vertical. `lock` (0..1) = enganche.
 */
(function () {
  "use strict";
  const TAU = Math.PI * 2;
  const TIME_SCALE = 40;          // 59 Hz → 1.47 Hz visibles de avance de la portadora
  const N_PARTIALS = 16;
  const GHOSTS = 4;
  const BARREL = -0.055;          // curvatura del vidrio (negativo = abombado)
  const SWEEP_HZ = 0.85;          // barridos visibles por segundo
  const LEVELS = 8;               // cubetas de intensidad para dibujar por tramos

  function rng(seed) {            // mulberry32
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  class Scope {
    constructor(canvas, grid, opts = {}) {
      this.c = canvas; this.ctx = canvas.getContext("2d");
      this.g = grid; this.gctx = grid.getContext("2d");
      this.b = opts.bloom || null; this.bctx = this.b ? this.b.getContext("2d") : null;
      this.rgb = opts.rgb || [226, 238, 255];
      this.core = [248, 251, 255];
      this.reduced = !!opts.reduced;
      this.rand = rng(59);
      this.partials = Array.from({ length: N_PARTIALS }, () => this._partial());
      this.flash = 0;
      this.sweep = 0;
      this.resize();
      window.addEventListener("resize", () => this.resize());
    }

    _partial() {
      const r = this.rand;
      return { f: 1.5 + Math.pow(r(), 1.6) * 110, ph: r() * TAU, w: (r() - .5) * 9,
               a: .25 + r() * .75, life: .4 + r() * 1.6, age: 0 };
    }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.dpr = dpr;
      const box = this.c.parentElement;               // la pantalla de la terminal, no la ventana
      this.W = (box && box.clientWidth) || window.innerWidth;
      this.H = (box && box.clientHeight) || window.innerHeight;
      if (!this.W || !this.H) return;
      for (const cv of [this.c, this.g]) {
        cv.width = Math.round(this.W * dpr); cv.height = Math.round(this.H * dpr);
      }
      if (this.b) { this.b.width = Math.round(this.W / 4); this.b.height = Math.round(this.H / 4); }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cx = this.W / 2; this.cy = this.H / 2;
      this.cyclesScale = Math.min(1.25, Math.max(.55, this.W / 1400));
      // graticula de osciloscopio: 10 × 8 divisiones cuadradas
      this.div = Math.min(this.W * .94 / 10, this.H * .9 / 8);
      this.amp = this.div * 2.4;                      // la señal ocupa ±2.4 divisiones
      this.step = this.W < 700 ? 1.5 : 2;
      this._drawGrid();
      this.ctx.fillStyle = "#030403"; this.ctx.fillRect(0, 0, this.W, this.H);
    }

    /* vidrio abombado: los puntos se curvan hacia el centro según su distancia */
    warp(x, y) {
      const nx = (x - this.cx) / this.cx, ny = (y - this.cy) / this.cy;
      const f = 1 + BARREL * (nx * nx * .55 + ny * ny);
      return [this.cx + nx * this.cx * f, this.cy + ny * this.cy * f];
    }

    _polyline(ctx, pts) {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = this.warp(pts[i][0], pts[i][1]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }

    /* Graticula clásica: 10 × 8 divisiones, borde marcado, ejes centrales con subdivisiones
     * de a 5 (marcas a ambos lados), puntos de subdivisión sobre cada línea y leyendas de escala. */
    _drawGrid() {
      const g = this.gctx, W = this.W, H = this.H, [r, gg, b] = this.rgb;
      g.clearRect(0, 0, W, H);
      const cx = this.cx, cy = this.cy, d = this.div;
      const x0 = cx - 5 * d, x1 = cx + 5 * d, y0 = cy - 4 * d, y1 = cy + 4 * d;
      const seg = 16;
      const vline = (x) => { const p = []; for (let y = y0; y <= y1 + .1; y += seg) p.push([x, Math.min(y, y1)]); return p; };
      const hline = (y) => { const p = []; for (let x = x0; x <= x1 + .1; x += seg) p.push([Math.min(x, x1), y]); return p; };
      g.lineWidth = 1;
      // divisiones mayores
      g.strokeStyle = `rgba(${r},${gg},${b},0.075)`;
      for (let i = 1; i < 10; i++) if (i !== 5) this._polyline(g, vline(x0 + i * d));
      for (let j = 1; j < 8; j++) if (j !== 4) this._polyline(g, hline(y0 + j * d));
      // puntos de subdivisión (cada 1/5 de división) sobre todas las líneas
      g.fillStyle = `rgba(${r},${gg},${b},0.16)`;
      for (let i = 0; i <= 10; i++) for (let k = 0; k <= 40; k++) {
        const [px, py] = this.warp(x0 + i * d, y0 + k * d / 5); g.fillRect(px - .6, py - .6, 1.2, 1.2);
      }
      for (let j = 0; j <= 8; j++) for (let k = 0; k <= 50; k++) {
        const [px, py] = this.warp(x0 + k * d / 5, y0 + j * d); g.fillRect(px - .6, py - .6, 1.2, 1.2);
      }
      // borde y ejes centrales, más marcados
      g.strokeStyle = `rgba(${r},${gg},${b},0.16)`;
      this._polyline(g, vline(x0)); this._polyline(g, vline(x1));
      this._polyline(g, hline(y0)); this._polyline(g, hline(y1));
      g.strokeStyle = `rgba(${r},${gg},${b},0.2)`;
      this._polyline(g, vline(cx)); this._polyline(g, hline(cy));
      for (let k = 1; k < 50; k++) {                  // marcas menores del eje horizontal
        const x = x0 + k * d / 5, len = k % 5 === 0 ? 0 : 5;
        if (len) this._polyline(g, [[x, cy - len], [x, cy + len]]);
      }
      for (let k = 1; k < 40; k++) {                  // y del eje vertical
        const y = y0 + k * d / 5, len = k % 5 === 0 ? 0 : 5;
        if (len) this._polyline(g, [[cx - len, y], [cx + len, y]]);
      }
      // leyendas de escala, como en el borde de un osciloscopio
      g.fillStyle = `rgba(${r},${gg},${b},0.38)`;
      g.font = `500 ${Math.max(9, Math.round(d * .16))}px "IBM Plex Mono", monospace`;
      g.textBaseline = "top";
      const pad = 6;
      g.textAlign = "left";
      g.fillText("CH1  ∿  0.50 V/div", x0 + pad, y1 + pad);
      g.textAlign = "right";
      g.fillText("M  10.0 ms/div  ·  TRIG ↑ CH1", x1 - pad, y1 + pad);
    }

    env(u) {                       // ventana gaussiana de la wavelet
      const d = (u - .5) / .31;
      return Math.exp(-d * d);
    }

    /* Wavelet del episodio n: UNA senoidal con ventana gaussiana; la portadora avanza a n Hz. */
    wave(n, u, t) {
      const k = n * .5 * this.cyclesScale;
      const travel = this.reduced ? 0 : TAU * (n / TIME_SCALE) * t;
      return this.env(u) * Math.sin(TAU * k * (u - .5) - travel);
    }

    chaos(u, t, seedOff) {
      let s = 0, norm = 0;
      for (let j = seedOff; j < this.partials.length; j += 1 + (seedOff % 2)) {
        const p = this.partials[j];
        const fade = Math.sin(Math.PI * Math.min(1, p.age / p.life));
        s += p.a * fade * Math.sin(TAU * p.f * u + p.ph + p.w * t);
        norm += p.a;
      }
      return (s / Math.max(1, norm)) * 2.1 * (.35 + .65 * this.env(u));
    }

    _stepPartials(dt, intensity) {
      for (let j = 0; j < this.partials.length; j++) {
        const p = this.partials[j];
        p.age += dt * (0.6 + intensity * 2.4);
        if (p.age >= p.life) this.partials[j] = this._partial();
      }
    }

    /* Traza de haz: intensidad por tramo = tiempo de permanencia del haz (inverso de la
     * velocidad) × resalte del barrido. Se agrupa por cubetas para pocas llamadas a stroke(). */
    _beam(pts, inten, bright) {
      const ctx = this.ctx, [r, g, b] = this.rgb, [cr, cg, cb] = this.core;
      const buckets = Array.from({ length: LEVELS }, () => []);
      for (let i = 1; i < pts.length; i++) {
        const lvl = Math.min(LEVELS - 1, Math.max(0, Math.floor(inten[i] * LEVELS)));
        buckets[lvl].push(i);
      }
      const passes = [[11, .03, false], [3.6, .16, false], [1.35, .92, true]];
      for (const [lw, a, isCore] of passes) {
        ctx.lineWidth = lw;
        for (let lvl = 0; lvl < LEVELS; lvl++) {
          const idx = buckets[lvl];
          if (!idx.length) continue;
          const level = (lvl + .5) / LEVELS;
          const alpha = Math.min(1, a * bright * (.25 + .95 * level));
          ctx.strokeStyle = isCore ? `rgba(${cr},${cg},${cb},${alpha})` : `rgba(${r},${g},${b},${alpha})`;
          ctx.beginPath();
          for (const i of idx) { ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); }
          ctx.stroke();
        }
      }
    }

    _beamHead(x, y, bright) {
      const ctx = this.ctx, [r, g, b] = this.rgb;
      const R = 14;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
      grad.addColorStop(0, `rgba(255,255,255,${.55 * bright})`);
      grad.addColorStop(.25, `rgba(${r},${g},${b},${.22 * bright})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x - R, y - R, R * 2, R * 2);
    }

    /* state: {nA, nB, s, lock, t, dt, off} — s: 0 = episodio A, 1 = episodio B. */
    frame(state) {
      const { nA, nB, s, lock, t, dt } = state;
      if (!this.W || !this.H) { this.resize(); if (!this.W || !this.H) return; }
      const off = state.off || 0;          // 1 = transmisión terminada: línea plana
      const ctx = this.ctx, W = this.W, H = this.H;
      const noise = (1 - lock) * (1 - off);
      this._stepPartials(dt, noise);
      if (!this.reduced) this.sweep = (this.sweep + dt * SWEEP_HZ) % 1;

      // persistencia del fósforo: cuanto más enganchada, más larga la estela
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(3,4,3,${.17 + noise * .22})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineJoin = "round"; ctx.lineCap = "round";

      const cy = this.cy, A = this.amp, step = this.step;
      // la traza recorre exactamente el ancho de la graticula, como en un osciloscopio
      const GX = this.cx - 5 * this.div, GW = 10 * this.div;
      const n = Math.ceil(GW / step) + 1;
      const jitterX = this.reduced ? 0 : noise * noise * (Math.sin(t * 31.7) * 18 + (this.rand() - .5) * 24);
      const roll = this.reduced ? 0 : noise * noise * Math.sin(t * 2.3) * H * .06;
      const sB = smooth(0, 1, s);
      const flash = this.flash; this.flash = Math.max(0, this.flash - dt * 2.2);
      const hum = this.reduced ? 1 : 1 + (this.rand() - .5) * .04;               // fuente que no es perfecta
      const bright = (.74 + .26 * lock) * (1 + flash * .9) * (1 - off * .55) * hum *
                     (this.reduced ? 1 : (1 - noise * .25 * this.rand()));

      // --- la señal ---
      const pts = new Array(n), inten = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const xr = GX + Math.min(GW, i * step);
        const u = (xr - GX - jitterX) / GW;
        const base = (1 - sB) * this.wave(nA, u, t) + sB * this.wave(nB, u, t);
        let y = base * (lock + noise * .45);
        if (noise > .001) {
          y += noise * this.chaos(u, t, 0) * .75;
          y += noise * (this.rand() - .5) * .22;
        }
        const fuzz = this.reduced ? 0 : (this.rand() - .5) * .7;                 // pelusa del haz
        pts[i] = this.warp(xr - jitterX, cy + roll + y * A * (1 - off) + fuzz);
      }
      // intensidad: permanencia del haz (tramos cortos = lentos = brillantes) × barrido
      const sweepX = this.sweep * GW;
      for (let i = 1; i < n; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        const len = Math.hypot(dx, dy) || step;
        const dwell = Math.pow(Math.min(1, (step * 1.08) / len), .75);
        let d = (sweepX - i * step) / GW; if (d < 0) d += 1;                      // distancia detrás del haz
        const swept = this.reduced ? 1 : .78 + .42 * Math.exp(-d * 6);
        inten[i] = Math.min(1, dwell * swept);
      }
      this._beam(pts, inten, bright);
      if (!this.reduced && off < .9) {
        const hi = Math.min(n - 1, Math.max(0, Math.round(sweepX / step)));
        this._beamHead(pts[hi][0], pts[hi][1], bright * (.6 + .4 * lock));
      }

      // señales fantasma: muchas frecuencias solapándose mientras se busca
      if (noise > .08) {
        const [r, g, b] = this.rgb;
        for (let k = 0; k < GHOSTS; k++) {
          const p = this.partials[(k * 3 + Math.floor(Math.abs(t) * 2)) % this.partials.length];
          ctx.lineWidth = 1;
          ctx.strokeStyle = `rgba(${r},${g},${b},${.15 * noise})`;
          ctx.beginPath();
          const offY = (k - GHOSTS / 2) * A * .22 * noise;
          for (let i = 0; i < n; i += 2) {
            const u = i * step / GW;
            const [x, y] = this.warp(GX + Math.min(GW, i * step), cy + roll + offY + A * .6 * noise * this.env(u) *
                                      Math.sin(TAU * p.f * .6 * u + p.ph + p.w * t * 1.7));
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        // nieve: puntos de fósforo sueltos
        ctx.fillStyle = `rgba(${r},${g},${b},${.5 * noise})`;
        const dots = Math.floor(320 * noise * noise);
        for (let k = 0; k < dots; k++) {
          const [x, y] = this.warp(this.rand() * W, cy + (this.rand() - .5) * this.div * 8);
          ctx.fillRect(x, y, 1.3, 1.3);
        }
      }
      ctx.globalCompositeOperation = "source-over";

      // halo: copia chica de la pantalla, desenfocada por CSS sobre todo el tubo
      if (this.bctx) {
        this.bctx.globalCompositeOperation = "copy";
        this.bctx.drawImage(this.c, 0, 0, this.b.width, this.b.height);
      }
    }
  }

  window.WaveletScope = Scope;
})();
