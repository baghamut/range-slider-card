/*
 * Range Slider Card for Home Assistant
 * A slider with two handles that sets two entities at once: a start and an end.
 * Entities: numbers (input_number, number), times (time, input_datetime with time only)
 * and dates (date, input_datetime with date only). Values can be shown as a number with
 * any unit, or as one of the common kinds: time of day, duration, temperature, percent…
 * Type: custom:range-slider-card · https://github.com/baghamut/range-slider-card · MIT License
 */
const CARD_VERSION = '0.2.0';

const NUMBER_DOMAINS = ['input_number', 'number'];
const ENTITY_DOMAINS = [...NUMBER_DOMAINS, 'time', 'date', 'input_datetime'];
const DAY = 1440; // minutes in a day
const MS_DAY = 86400000;

// How a value is shown. `unit` is the default unit (the entity's own unit wins for "number").
// Formats marked `minutes` work on number entities that hold minutes.
const FORMATS = {
  number: { label: 'Number (unit from the entity or typed below)' },
  time: { label: 'Time of day (HH:MM)', minutes: true },
  duration: { label: 'Duration (h / min)', minutes: true },
  date: { label: 'Date' },
  temperature: { label: 'Temperature', unit: '°C' },
  percentage: { label: 'Percent', unit: '%' },
  distance: { label: 'Distance', unit: 'km' },
  length: { label: 'Length', unit: 'm' },
  speed: { label: 'Speed', unit: 'km/h' },
  power: { label: 'Power', unit: 'W' },
  energy: { label: 'Energy', unit: 'kWh' },
  volume: { label: 'Volume', unit: 'L' },
  weight: { label: 'Weight', unit: 'kg' },
  pressure: { label: 'Pressure', unit: 'bar' },
  currency: { label: 'Money (currency from Home Assistant)' },
};

// Named colours from Home Assistant's colour picker (ui_color selector)
const HA_COLORS = ['primary', 'accent', 'red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue',
  'light-blue', 'cyan', 'teal', 'green', 'light-green', 'lime', 'yellow', 'amber', 'orange',
  'deep-orange', 'brown', 'light-grey', 'grey', 'dark-grey', 'blue-grey', 'black', 'white'];

const cssColor = (c) => {
  if (!c) return 'var(--primary-color)';
  return HA_COLORS.includes(c) ? `var(--${c}-color)` : c;
};

const fireEvent = (node, type, detail) =>
  node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

// What an entity holds: 'number', 'time', 'date' or null (unsupported)
const kindOf = (hass, entityId) => {
  const st = entityId && hass?.states[entityId];
  if (!st) return null;
  const domain = entityId.split('.')[0];
  if (NUMBER_DOMAINS.includes(domain)) return 'number';
  if (domain === 'time') return 'time';
  if (domain === 'date') return 'date';
  if (domain === 'input_datetime') {
    const { has_time: t, has_date: d } = st.attributes;
    if (t && !d) return 'time';
    if (d && !t) return 'date';
  }
  return null;
};

const parseTime = (s) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
  return m ? +m[1] * 60 + +m[2] : NaN;
};
const formatTime = (min) => {
  const m = Math.max(0, Math.min(DAY, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// Dates are kept as whole days since 1970-01-01 (UTC), so the slider math stays simple
const parseDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_DAY) : NaN;
};
const isoDate = (days) => new Date(Math.round(days) * MS_DAY).toISOString().slice(0, 10);
const decimalsOf = (step) => {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
};

class RangeSliderCard extends HTMLElement {
  static getConfigElement() { return document.createElement('range-slider-card-editor'); }

  static getStubConfig(hass) {
    const ids = Object.keys(hass.states).filter((id) => kindOf(hass, id) === 'number');
    return { start_entity: ids[0] || '', end_entity: ids[1] || ids[0] || '' };
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = { show_scale: true, ...config };
    this._local = null; // values shown while dragging / until the entities report back
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._built = false;
    this._scaleKey = null;
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() { return this._config?.name ? 2 : 1; }
  getGridOptions() { return { columns: 6, min_columns: 3, rows: 'auto' }; }

  // ---- model ---------------------------------------------------------------

  // What both entities hold: 'number', 'time' or 'date' (null if they differ or are unsupported)
  _kind() {
    const a = kindOf(this._hass, this._config.start_entity);
    const b = kindOf(this._hass, this._config.end_entity);
    return a && a === b ? a : null;
  }

  // How to show the values. Time entities are always times, date entities always dates.
  _format(kind) {
    if (kind === 'time') return this._config.format === 'duration' ? 'duration' : 'time';
    if (kind === 'date') return 'date';
    const f = this._config.format;
    return f && FORMATS[f] && f !== 'date' ? f : 'number';
  }

  _range(kind, fmt) {
    const c = this._config;
    const attr = this._hass.states[c.start_entity]?.attributes || {};
    if (kind === 'date') {
      const year = new Date().getUTCFullYear();
      const min = parseDate(c.min) || Math.round(Date.UTC(year, 0, 1) / MS_DAY);
      const max = parseDate(c.max) || Math.round(Date.UTC(year, 11, 31) / MS_DAY);
      return { min, max, step: Number(c.step) || 1 };
    }
    if (kind === 'time') {
      return { min: Number(c.min ?? 0), max: Number(c.max ?? DAY), step: Number(c.step) || 15 };
    }
    if (FORMATS[fmt].minutes) {
      return {
        min: Number(c.min ?? attr.min ?? 0),
        max: Number(c.max ?? attr.max ?? DAY),
        step: Number(c.step ?? attr.step ?? 15) || 15,
      };
    }
    return {
      min: Number(c.min ?? attr.min ?? 0),
      max: Number(c.max ?? attr.max ?? 100),
      step: Number(c.step ?? attr.step ?? 1) || 1,
    };
  }

  _read(kind, entityId) {
    const s = this._hass.states[entityId]?.state;
    if (kind === 'time') return parseTime(s);
    if (kind === 'date') return parseDate(s);
    return parseFloat(s);
  }

  _values(kind) {
    const a = this._read(kind, this._config.start_entity);
    const b = this._read(kind, this._config.end_entity);
    if (this._local) {
      const done = this._local.a === a && this._local.b === b;
      if (!this._drag && (done || Date.now() > this._local.until)) this._local = null;
    }
    return this._local || { a, b };
  }

  _unit(fmt) {
    const c = this._config;
    if (c.unit !== undefined && c.unit !== null) return String(c.unit);
    if (fmt === 'currency') return this._hass.config?.currency || '';
    const entityUnit = this._hass.states[c.start_entity]?.attributes.unit_of_measurement;
    return entityUnit || FORMATS[fmt].unit || '';
  }

  _lang() { return this._hass.locale?.language || this._hass.language || navigator.language; }

  // Text for a value; `short` is used for the scale (no unit, compact)
  _fmt(fmt, v, step, short = false) {
    if (!Number.isFinite(v)) return '—';
    if (fmt === 'time') return formatTime(v);
    if (fmt === 'duration') {
      const m = Math.round(v);
      const h = Math.floor(m / 60);
      const rest = m % 60;
      if (short) return rest ? `${h}:${String(rest).padStart(2, '0')}` : `${h} h`;
      if (!h) return `${rest} min`;
      return rest ? `${h} h ${rest} min` : `${h} h`;
    }
    if (fmt === 'date') {
      return new Intl.DateTimeFormat(this._lang(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
        .format(new Date(Math.round(v) * MS_DAY));
    }
    const dec = decimalsOf(step);
    const num = new Intl.NumberFormat(this._lang(), { minimumFractionDigits: short ? 0 : dec, maximumFractionDigits: dec })
      .format(v);
    const unit = this._unit(fmt);
    return short || !unit ? num : `${num} ${unit}`;
  }

  async _write(kind, a, b) {
    const c = this._config;
    this._local = { a, b, until: Date.now() + 8000 };
    const call = (entityId, v) => {
      const domain = entityId.split('.')[0];
      if (kind === 'time') {
        const time = `${formatTime(Math.min(v, DAY - 1))}:00`; // 24:00 is not a valid time
        return domain === 'time'
          ? this._hass.callService('time', 'set_value', { entity_id: entityId, time })
          : this._hass.callService('input_datetime', 'set_datetime', { entity_id: entityId, time });
      }
      if (kind === 'date') {
        const date = isoDate(v);
        return domain === 'date'
          ? this._hass.callService('date', 'set_value', { entity_id: entityId, date })
          : this._hass.callService('input_datetime', 'set_datetime', { entity_id: entityId, date });
      }
      return this._hass.callService(domain, 'set_value', { entity_id: entityId, value: v });
    };
    const [oldA, oldB] = [this._read(kind, c.start_entity), this._read(kind, c.end_entity)];
    try {
      if (a !== oldA) await call(c.start_entity, a);
      if (b !== oldB) await call(c.end_entity, b);
    } catch (err) {
      this._local = null;
      this._error = err.message || String(err);
      this._update();
    }
  }

  // ---- view ----------------------------------------------------------------

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { --rs-color: var(--primary-color); }
        ha-card { padding: 12px 16px; }
        .head { display: flex; align-items: center; gap: 12px; min-height: 24px; }
        .head ha-state-icon, .head ha-icon { color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .val { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .track { position: relative; height: 20px; margin: 10px 10px 0; touch-action: none; cursor: pointer; }
        .track::before { content: ''; position: absolute; left: -10px; right: -10px; top: 8px; height: 4px;
                         border-radius: 2px; background: var(--slider-track-color, var(--disabled-color, #bdbdbd)); }
        .bar { position: absolute; top: 8px; height: 4px; border-radius: 2px; background: var(--rs-color); }
        .thumb { position: absolute; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px;
                 border-radius: 50%; background: var(--rs-color); cursor: grab; outline: none; touch-action: none; }
        .thumb::after { content: ''; position: absolute; inset: -10px; } /* bigger touch target */
        .thumb.kbd, .thumb.active { box-shadow: 0 0 0 8px color-mix(in srgb, var(--rs-color) 20%, transparent); }
        .thumb.active { cursor: grabbing; }
        /* Ruler: small ticks under the track, longer ones at the labels */
        .ruler { position: relative; height: 6px; margin: 3px 10px 0; }
        .ruler i { position: absolute; top: 0; width: 1px; height: 3px; background: var(--divider-color, rgba(127,127,127,.4)); }
        .ruler i.major { height: 6px; background: var(--secondary-text-color); opacity: .6; }
        .scale { position: relative; height: 14px; margin: 1px 10px 0; font-size: 11px; color: var(--secondary-text-color); }
        .scale span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
        /* Bubble with the exact value above a handle while it moves or has keyboard focus */
        .bub { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%) scale(.6);
               transform-origin: bottom center; padding: 3px 8px; border-radius: 6px; white-space: nowrap;
               font-size: 13px; font-weight: 500; color: var(--text-primary-color, #fff);
               background: var(--rs-bubble, #424242); opacity: 0; pointer-events: none;
               transition: opacity .12s, transform .12s; font-variant-numeric: tabular-nums; z-index: 2; }
        .thumb.active .bub, .thumb.kbd .bub { opacity: 1; transform: translateX(-50%) scale(1); }
        .track { z-index: 1; }
        /* style: gradient — thick track, colour gradient between the handles, white handles with a ring */
        .gradient .track { height: 22px; }
        .gradient .track::before { top: 4px; height: 14px; border-radius: 7px;
                                   background: var(--secondary-background-color, rgba(127,127,127,.15)); }
        .gradient .bar { top: 4px; height: 14px; border-radius: 7px;
                         background: linear-gradient(90deg, var(--rs-color), var(--rs-color2)); }
        .gradient .thumb { width: 22px; height: 22px; margin: -11px 0 0 -11px; background: #fff; box-sizing: border-box;
                           border: 3px solid var(--rs-color); box-shadow: 0 1px 3px rgba(0,0,0,.35); }
        .gradient .thumb[data-t="b"] { border-color: var(--rs-color2); }
        .gradient .thumb.kbd, .gradient .thumb.active {
          box-shadow: 0 1px 3px rgba(0,0,0,.35), 0 0 0 8px color-mix(in srgb, var(--rs-color) 20%, transparent); }
        .warn { color: var(--error-color); font-size: 13px; padding: 4px 0; }
        .off .track, .off .scale { opacity: .4; pointer-events: none; }
      </style>
      <ha-card>
        <div class="head">
          <ha-state-icon class="icon"></ha-state-icon>
          <div class="name"></div>
          <div class="val"></div>
        </div>
        <div class="track">
          <div class="bar"></div>
          <div class="thumb" data-t="a" role="slider" tabindex="0"><span class="bub"></span></div>
          <div class="thumb" data-t="b" role="slider" tabindex="0"><span class="bub"></span></div>
        </div>
        <div class="ruler"></div>
        <div class="scale"></div>
        <div class="warn" hidden></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._el = {
      card: $('ha-card'), icon: $('.icon'), name: $('.name'), val: $('.val'), track: $('.track'),
      bar: $('.bar'), ta: $('.thumb[data-t="a"]'), tb: $('.thumb[data-t="b"]'), scale: $('.scale'), warn: $('.warn'),
      ruler: $('.ruler'),
    };
    this._el.track.addEventListener('pointerdown', (e) => this._pointerDown(e));
    [this._el.ta, this._el.tb].forEach((t) => {
      t.addEventListener('keydown', (e) => this._key(e, t.dataset.t));
      t.addEventListener('blur', () => t.classList.remove('kbd'));
    });
    this._built = true;
  }

  _update() {
    if (!this._config || !this._hass || !this.shadowRoot) return;
    if (!this._built) this._build();
    const el = this._el;
    const c = this._config;
    el.card.style.setProperty('--rs-color', cssColor(c.color));
    el.card.style.setProperty('--rs-color2', cssColor(c.color_end || c.color));
    el.card.classList.toggle('gradient', c.style === 'gradient');

    const kind = this._kind();
    const startState = this._hass.states[c.start_entity];
    el.name.textContent = c.name ?? startState?.attributes.friendly_name ?? c.start_entity ?? '';
    el.icon.hass = this._hass;
    el.icon.stateObj = startState;
    if (c.icon) el.icon.icon = c.icon;
    el.icon.style.display = c.show_icon === false ? 'none' : '';

    let warn = this._error || '';
    if (!kind) {
      warn = !startState || !this._hass.states[c.end_entity]
        ? 'Entity not found'
        : 'Both entities must be the same kind: numbers (input_number, number), times (time, input_datetime) or dates (date, input_datetime)';
    }
    el.warn.hidden = !warn;
    el.warn.textContent = warn;
    el.card.classList.toggle('off', !kind);
    if (!kind) { el.val.textContent = ''; return; }

    const fmt = this._format(kind);
    const r = this._range(kind, fmt);
    const { a, b } = this._values(kind);
    const pct = (v) => ((Math.max(r.min, Math.min(r.max, v)) - r.min) / (r.max - r.min)) * 100;
    const ok = Number.isFinite(a) && Number.isFinite(b);
    const L = ok ? pct(a) : 0;
    const R = ok ? pct(b) : 0;
    el.bar.style.left = `${L}%`;
    el.bar.style.width = `${Math.max(0, R - L)}%`;
    el.ta.style.left = `${L}%`;
    el.tb.style.left = `${R}%`;
    el.val.textContent = ok ? `${this._fmt(fmt, a, r.step)} – ${this._fmt(fmt, b, r.step)}` : '—';
    [[el.ta, a, 'Start'], [el.tb, b, 'End']].forEach(([t, v, label]) => {
      t.setAttribute('aria-label', label);
      t.setAttribute('aria-valuemin', r.min);
      t.setAttribute('aria-valuemax', r.max);
      t.setAttribute('aria-valuenow', v);
      const text = this._fmt(fmt, v, r.step);
      t.setAttribute('aria-valuetext', text);
      t.firstElementChild.textContent = text;
    });

    const scaleKey = `${fmt}|${r.min}|${r.max}|${r.step}|${c.show_scale}|${c.show_ticks}`;
    if (this._scaleKey !== scaleKey) {
      this._scaleKey = scaleKey;
      el.scale.hidden = !c.show_scale;
      el.ruler.hidden = c.show_ticks === false;
      const fullDay = (fmt === 'time' || fmt === 'duration') && r.min === 0 && r.max === DAY;
      const labels = fullDay
        ? [0, 360, 720, 1080, 1440]
        : [0, 0.25, 0.5, 0.75, 1].map((f) => r.min + f * (r.max - r.min));
      el.scale.innerHTML = labels.map((v) => {
        const label = fullDay ? String(v / 60) : this._fmt(fmt, v, r.step, true);
        return `<span style="left:${pct(v)}%">${label}</span>`;
      }).join('');
      // Small ticks: every hour for a whole day, otherwise every step if that is not too dense, else 20 parts
      const span = r.max - r.min;
      let minor = fullDay ? 60 : r.step;
      if (!fullDay && span / minor > 48) minor = span / 20;
      const n = Math.round(span / minor);
      const majors = new Set(labels.map((v) => Math.round(pct(v) * 100)));
      el.ruler.innerHTML = Array.from({ length: n + 1 }, (_, i) => {
        const p = (i / n) * 100;
        return `<i class="${majors.has(Math.round(p * 100)) ? 'major' : ''}" style="left:${p}%"></i>`;
      }).join('');
    }
  }

  _clamp(kind, which, v, cur) {
    const r = this._range(kind, this._format(kind));
    // The gap is never smaller than one step (a smaller or broken value would let the handles meet)
    const want = Number(this._config.min_gap);
    const gap = Number.isFinite(want) && want > r.step ? Math.round(want / r.step) * r.step : r.step;
    v = Math.round((v - r.min) / r.step) * r.step + r.min;
    v = +v.toFixed(10);
    v = Math.max(r.min, Math.min(r.max, v));
    return which === 'a' ? Math.min(v, cur.b - gap) : Math.max(v, cur.a + gap);
  }

  _pointerDown(e) {
    const kind = this._kind();
    if (!kind || e.button > 0) return;
    e.preventDefault();
    const r = this._range(kind, this._format(kind));
    const { a, b } = this._values(kind);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const cur = { a, b };
    const track = this._el.track;
    const valueAt = (ev) => {
      const rect = track.getBoundingClientRect();
      return r.min + ((ev.clientX - rect.left) / rect.width) * (r.max - r.min);
    };
    // Grab the handle that was hit, otherwise the nearest one
    let which = e.target.dataset?.t;
    if (!which) {
      const v = valueAt(e);
      which = Math.abs(v - a) <= Math.abs(v - b) ? 'a' : 'b';
    }
    const thumb = which === 'a' ? this._el.ta : this._el.tb;
    this._el.ta.classList.remove('kbd');
    this._el.tb.classList.remove('kbd');
    thumb.classList.add('active');
    thumb.focus({ preventScroll: true });
    track.setPointerCapture(e.pointerId);
    this._drag = true;
    this._error = '';

    const move = (ev) => {
      cur[which] = this._clamp(kind, which, valueAt(ev), cur);
      this._local = { ...cur, until: Infinity };
      this._update();
    };
    const up = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
      thumb.classList.remove('active');
      this._drag = false;
      this._write(kind, cur.a, cur.b);
      this._update();
    };
    if (!e.target.dataset?.t) move(e); // a tap on the track jumps the nearest handle there
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  }

  _key(e, which) {
    const kind = this._kind();
    if (!kind) return;
    const r = this._range(kind, this._format(kind));
    const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
    if (!steps) return;
    e.preventDefault();
    (which === 'a' ? this._el.ta : this._el.tb).classList.add('kbd'); // ring and bubble for keyboard use
    const cur = { ...this._values(kind) };
    cur[which] = this._clamp(kind, which, cur[which] + steps * r.step, cur);
    this._local = { ...cur, until: Infinity };
    this._update();
    clearTimeout(this._keyTimer);
    this._keyTimer = setTimeout(() => this._write(kind, cur.a, cur.b), 700);
  }
}

class RangeSliderCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    else this._render();
  }

  _kind() { return kindOf(this._hass, this._config.start_entity); }

  // Value kinds that make sense for the picked entities
  _formatOptions() {
    const kind = this._kind();
    let keys;
    if (kind === 'time') keys = ['time', 'duration'];
    else if (kind === 'date') keys = ['date'];
    else keys = Object.keys(FORMATS).filter((k) => k !== 'date');
    return keys.map((k) => ({ value: k, label: FORMATS[k].label }));
  }

  _schema() {
    const c = this._config;
    const kind = this._kind();
    const fmt = c.format || (kind === 'time' ? 'time' : kind === 'date' ? 'date' : 'number');
    const numeric = kind === 'number' && !FORMATS[fmt]?.minutes;
    const entity = { entity: { domain: ENTITY_DOMAINS } };
    const bound = kind === 'date' ? { date: {} } : { number: { mode: 'box', step: 'any' } };
    return [
      { name: 'start_entity', required: true, selector: entity },
      { name: 'end_entity', required: true, selector: entity },
      { name: 'name', selector: { text: {} } },
      {
        type: 'grid', name: '', schema: [
          { name: 'format', selector: { select: { mode: 'dropdown', options: this._formatOptions() } } },
          ...(numeric ? [{ name: 'unit', selector: { text: {} } }] : []),
        ],
      },
      { name: 'icon', selector: { icon: {} }, context: { icon_entity: 'start_entity' } },
      {
        name: 'style',
        selector: { select: { mode: 'box', options: [
          { value: 'standard', label: 'Standard' },
          { value: 'gradient', label: 'Gradient' },
        ] } },
      },
      {
        type: 'grid', name: '', schema: [
          { name: 'color', selector: { ui_color: { default_color: 'primary' } } },
          ...(c.style === 'gradient' ? [{ name: 'color_end', selector: { ui_color: { default_color: 'primary' } } }] : []),
        ],
      },
      {
        type: 'expandable', name: '', title: 'Range', schema: [
          {
            type: 'grid', name: '', schema: [
              { name: 'min', selector: bound },
              { name: 'max', selector: bound },
              { name: 'step', selector: { number: { mode: 'box', step: 'any' } } },
              { name: 'min_gap', selector: { number: { mode: 'box', step: 'any' } } },
            ],
          },
        ],
      },
      {
        type: 'grid', name: '', schema: [
          { name: 'show_scale', selector: { boolean: {} } },
          { name: 'show_ticks', selector: { boolean: {} } },
          { name: 'show_icon', selector: { boolean: {} } },
        ],
      },
    ];
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (s) => ({
        start_entity: 'Start entity',
        end_entity: 'End entity',
        name: 'Name',
        format: 'Show values as',
        unit: 'Unit',
        icon: 'Icon',
        color: this._config.style === 'gradient' ? 'Start colour' : 'Colour',
        color_end: 'End colour',
        style: 'Style',
        min: 'Minimum',
        max: 'Maximum',
        step: 'Step',
        min_gap: 'Minimum gap between handles',
        show_scale: 'Show scale labels',
        show_ticks: 'Show ruler ticks',
        show_icon: 'Show icon',
      }[s.name] ?? s.name);
      this._form.computeHelper = (s) => {
        const kind = this._kind();
        const minutes = kind === 'time' || FORMATS[this._config.format]?.minutes;
        return {
          unit: 'Empty = the entity\'s unit or the kind\'s usual unit',
          min: kind === 'date' ? 'Empty = 1 January this year' : minutes ? 'Minutes; empty = 0' : 'Empty = from the entity',
          max: kind === 'date' ? 'Empty = 31 December this year' : minutes ? 'Minutes; empty = 1440 (24:00)' : 'Empty = from the entity',
          step: kind === 'date' ? 'Days (default 1)' : minutes ? 'Minutes (default 15)' : undefined,
          min_gap: 'At least one step; rounded to whole steps (default: one step)',
        }[s.name];
      };
      this._form.addEventListener('value-changed', (e) => {
        const config = { ...e.detail.value };
        Object.keys(config).forEach((k) => (config[k] === '' || config[k] === undefined) && delete config[k]);
        const reshape = ['style', 'format', 'start_entity'].some((k) => config[k] !== this._config[k]);
        this._config = config;
        if (reshape) this._form.schema = this._schema(); // fields depend on these choices
        fireEvent(this, 'config-changed', { config });
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { show_scale: true, show_ticks: true, show_icon: true, ...this._config };
    this._form.schema = this._schema();
  }
}

if (!customElements.get('range-slider-card')) customElements.define('range-slider-card', RangeSliderCard);
if (!customElements.get('range-slider-card-editor')) customElements.define('range-slider-card-editor', RangeSliderCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'range-slider-card',
  name: 'Range Slider Card',
  description: 'One slider with two handles that sets a start and an end entity: numbers, times or dates.',
  preview: true,
  documentationURL: 'https://github.com/baghamut/range-slider-card',
});

console.info(`%c RANGE-SLIDER-CARD %c ${CARD_VERSION} `, 'color:#fff;background:#03a9f4;font-weight:600', 'color:#03a9f4');
