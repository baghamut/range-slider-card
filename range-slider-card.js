/*
 * Range Slider Card for Home Assistant
 * A slider with two handles that sets two entities at once: a start and an end.
 * Works with number-like entities (input_number, number) and time entities
 * (time, input_datetime with time only). Type: custom:range-slider-card
 * https://github.com/baghamut/range-slider-card  ·  MIT License
 */
const CARD_VERSION = '0.1.0';

const NUMBER_DOMAINS = ['input_number', 'number'];
const TIME_DOMAINS = ['time', 'input_datetime'];
const ENTITY_DOMAINS = [...NUMBER_DOMAINS, ...TIME_DOMAINS];
const DAY = 1440; // minutes

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

// What kind of value an entity holds: 'number', 'time' or null (unsupported)
const kindOf = (hass, entityId) => {
  const st = entityId && hass?.states[entityId];
  if (!st) return null;
  const domain = entityId.split('.')[0];
  if (NUMBER_DOMAINS.includes(domain)) return 'number';
  if (domain === 'time') return 'time';
  if (domain === 'input_datetime') return st.attributes.has_time && !st.attributes.has_date ? 'time' : null;
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
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() { return this._config?.name ? 2 : 1; }
  getGridOptions() { return { columns: 6, min_columns: 3, rows: 'auto' }; }

  // ---- model ---------------------------------------------------------------

  // 'number', 'time' (time entities) or 'minutes' (number entities shown as a time of day)
  _kind() {
    const a = kindOf(this._hass, this._config.start_entity);
    const b = kindOf(this._hass, this._config.end_entity);
    if (!a || a !== b) return null;
    return a === 'number' && this._config.format === 'time' ? 'minutes' : a;
  }

  _range(kind) {
    const c = this._config;
    const attr = this._hass.states[c.start_entity]?.attributes || {};
    if (kind === 'minutes') {
      const step = Number(c.step ?? attr.step ?? 15) || 15;
      return { min: Number(c.min ?? attr.min ?? 0), max: Number(c.max ?? attr.max ?? DAY), step };
    }
    if (kind === 'time') {
      const step = Number(c.step) || 15;
      return { min: Number(c.min ?? 0), max: Number(c.max ?? DAY), step };
    }
    const step = Number(c.step ?? attr.step ?? 1) || 1;
    return { min: Number(c.min ?? attr.min ?? 0), max: Number(c.max ?? attr.max ?? 100), step };
  }

  _read(kind, entityId) {
    const s = this._hass.states[entityId]?.state;
    return kind === 'time' ? parseTime(s) : parseFloat(s);
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

  _fmt(kind, v, step) {
    if (!Number.isFinite(v)) return '—';
    if (kind !== 'number') return formatTime(v);
    const unit = this._hass.states[this._config.start_entity]?.attributes.unit_of_measurement;
    return `${v.toFixed(decimalsOf(step))}${unit ? ` ${unit}` : ''}`;
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
        .thumb:focus-visible, .thumb.active { box-shadow: 0 0 0 8px color-mix(in srgb, var(--rs-color) 20%, transparent); }
        .thumb.active { cursor: grabbing; }
        .scale { position: relative; height: 14px; margin: 4px 10px 0; font-size: 11px; color: var(--secondary-text-color); }
        .scale span { position: absolute; transform: translateX(-50%); }
        /* style: gradient — thick track, colour gradient between the handles, white handles with a ring */
        .gradient .track { height: 22px; }
        .gradient .track::before { top: 4px; height: 14px; border-radius: 7px;
                                   background: var(--secondary-background-color, rgba(127,127,127,.15)); }
        .gradient .bar { top: 4px; height: 14px; border-radius: 7px;
                         background: linear-gradient(90deg, var(--rs-color), var(--rs-color2)); }
        .gradient .thumb { width: 22px; height: 22px; margin: -11px 0 0 -11px; background: #fff; box-sizing: border-box;
                           border: 3px solid var(--rs-color); box-shadow: 0 1px 3px rgba(0,0,0,.35); }
        .gradient .thumb[data-t="b"] { border-color: var(--rs-color2); }
        .gradient .thumb:focus-visible, .gradient .thumb.active {
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
          <div class="thumb" data-t="a" role="slider" tabindex="0"></div>
          <div class="thumb" data-t="b" role="slider" tabindex="0"></div>
        </div>
        <div class="scale"></div>
        <div class="warn" hidden></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._el = {
      card: $('ha-card'), icon: $('.icon'), name: $('.name'), val: $('.val'), track: $('.track'),
      bar: $('.bar'), ta: $('.thumb[data-t="a"]'), tb: $('.thumb[data-t="b"]'), scale: $('.scale'), warn: $('.warn'),
    };
    this._el.track.addEventListener('pointerdown', (e) => this._pointerDown(e));
    [this._el.ta, this._el.tb].forEach((t) => t.addEventListener('keydown', (e) => this._key(e, t.dataset.t)));
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
        : 'Both entities must be numbers (input_number, number) or times (time, input_datetime)';
    }
    el.warn.hidden = !warn;
    el.warn.textContent = warn;
    el.card.classList.toggle('off', !kind);
    if (!kind) { el.val.textContent = ''; return; }

    const r = this._range(kind);
    const { a, b } = this._values(kind);
    const pct = (v) => ((Math.max(r.min, Math.min(r.max, v)) - r.min) / (r.max - r.min)) * 100;
    const ok = Number.isFinite(a) && Number.isFinite(b);
    const L = ok ? pct(a) : 0;
    const R = ok ? pct(b) : 0;
    el.bar.style.left = `${L}%`;
    el.bar.style.width = `${Math.max(0, R - L)}%`;
    el.ta.style.left = `${L}%`;
    el.tb.style.left = `${R}%`;
    el.val.textContent = ok ? `${this._fmt(kind, a, r.step)} – ${this._fmt(kind, b, r.step)}` : '—';
    [[el.ta, a, 'Start'], [el.tb, b, 'End']].forEach(([t, v, label]) => {
      t.setAttribute('aria-label', label);
      t.setAttribute('aria-valuemin', r.min);
      t.setAttribute('aria-valuemax', r.max);
      t.setAttribute('aria-valuenow', v);
      t.setAttribute('aria-valuetext', this._fmt(kind, v, r.step));
    });

    const scaleKey = `${kind}|${r.min}|${r.max}|${c.show_scale}`;
    if (this._scaleKey !== scaleKey) {
      this._scaleKey = scaleKey;
      el.scale.hidden = !c.show_scale;
      const isTime = kind !== 'number';
      const ticks = isTime && r.min === 0 && r.max === DAY
        ? [0, 360, 720, 1080, 1440]
        : [0, 0.25, 0.5, 0.75, 1].map((f) => r.min + f * (r.max - r.min));
      el.scale.innerHTML = ticks.map((v) => {
        const label = isTime ? (r.min === 0 && r.max === DAY ? String(Math.round(v / 60)) : formatTime(v))
          : String(+v.toFixed(decimalsOf(r.step)));
        return `<span style="left:${pct(v)}%">${label}</span>`;
      }).join('');
    }
  }

  _clamp(kind, which, v, cur) {
    const r = this._range(kind);
    const gap = Number(this._config.min_gap ?? r.step);
    v = Math.round((v - r.min) / r.step) * r.step + r.min;
    v = +v.toFixed(10);
    v = Math.max(r.min, Math.min(r.max, v));
    return which === 'a' ? Math.min(v, cur.b - gap) : Math.max(v, cur.a + gap);
  }

  _pointerDown(e) {
    const kind = this._kind();
    if (!kind || e.button > 0) return;
    e.preventDefault();
    const r = this._range(kind);
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
    const r = this._range(kind);
    const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
    if (!steps) return;
    e.preventDefault();
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

  _schema() {
    const entity = { entity: { domain: ENTITY_DOMAINS } };
    return [
      { name: 'start_entity', required: true, selector: entity },
      { name: 'end_entity', required: true, selector: entity },
      { name: 'name', selector: { text: {} } },
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
          ...(this._config.style === 'gradient'
            ? [{ name: 'color_end', selector: { ui_color: { default_color: 'primary' } } }] : []),
        ],
      },
      {
        type: 'expandable', name: '', title: 'Range', schema: [
          {
            type: 'grid', name: '', schema: [
              { name: 'min', selector: { number: { mode: 'box', step: 'any' } } },
              { name: 'max', selector: { number: { mode: 'box', step: 'any' } } },
              { name: 'step', selector: { number: { mode: 'box', step: 'any' } } },
              { name: 'min_gap', selector: { number: { mode: 'box', step: 'any' } } },
            ],
          },
        ],
      },
      {
        type: 'grid', name: '', schema: [
          { name: 'show_scale', selector: { boolean: {} } },
          { name: 'show_icon', selector: { boolean: {} } },
        ],
      },
      {
        name: 'format',
        selector: { select: { mode: 'dropdown', options: [
          { value: 'number', label: 'Number' },
          { value: 'time', label: 'Time of day (number entities hold minutes, 0–1440)' },
        ] } },
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
        icon: 'Icon',
        color: this._config.style === 'gradient' ? 'Start colour' : 'Colour',
        color_end: 'End colour',
        style: 'Style',
        min: 'Minimum',
        max: 'Maximum',
        step: 'Step',
        min_gap: 'Minimum gap between handles',
        show_scale: 'Show scale',
        show_icon: 'Show icon',
        format: 'Show numbers as',
      }[s.name] ?? s.name);
      this._form.computeHelper = (s) => ({
        min: 'Empty = from the entity (times: 0)',
        max: 'Empty = from the entity (times: 1440 = 24:00)',
        step: 'Times are in minutes (default 15)',
      }[s.name]);
      this._form.addEventListener('value-changed', (e) => {
        const config = { ...e.detail.value };
        Object.keys(config).forEach((k) => (config[k] === '' || config[k] === undefined) && delete config[k]);
        const styleChanged = config.style !== this._config.style;
        this._config = config;
        if (styleChanged) this._form.schema = this._schema(); // show or hide "End colour"
        fireEvent(this, 'config-changed', { config });
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { show_scale: true, show_icon: true, ...this._config };
    this._form.schema = this._schema();
  }
}

if (!customElements.get('range-slider-card')) customElements.define('range-slider-card', RangeSliderCard);
if (!customElements.get('range-slider-card-editor')) customElements.define('range-slider-card-editor', RangeSliderCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'range-slider-card',
  name: 'Range Slider Card',
  description: 'One slider with two handles that sets a start and an end entity (numbers or times).',
  preview: true,
  documentationURL: 'https://github.com/baghamut/range-slider-card',
});

console.info(`%c RANGE-SLIDER-CARD %c ${CARD_VERSION} `, 'color:#fff;background:#03a9f4;font-weight:600', 'color:#03a9f4');
