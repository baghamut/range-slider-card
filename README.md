# Range Slider Card

A Home Assistant dashboard card with **one slider and two handles**. It sets two entities at
once — a start and an end — and looks like the standard Home Assistant slider.

Use it for anything that is a range made of two values:

- a heating or hot water window: `06:00 – 20:30`
- minimum and maximum temperature, humidity or fan speed
- a "from / to" pair of `input_number` helpers

![screenshot](screenshot.png)

## Supported entities

Both entities must be of the same kind:

| Kind | Domains |
|---|---|
| Numbers | `input_number`, `number` |
| Times | `time`, `input_datetime` (time only, no date) |

For numbers, the minimum, maximum and step come from the start entity, unless you set them in
the card. For times, the slider runs from 00:00 to 24:00 in 15-minute steps by default.

## Installation

### HACS

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/baghamut/range-slider-card`,
   type **Dashboard**.
2. Install **Range Slider Card** and reload the browser.

### Manual

1. Copy `range-slider-card.js` to `config/www/`.
2. Settings → Dashboards → ⋮ → **Resources** → add `/local/range-slider-card.js`, type
   **JavaScript module**.

## Configuration

Add the card from the card picker (**Range Slider Card**) and pick the two entities in the
visual editor, or use YAML:

```yaml
type: custom:range-slider-card
start_entity: input_datetime.heating_start
end_entity: input_datetime.heating_end
name: Heating
```

| Option | Default | Description |
|---|---|---|
| `start_entity` | required | Entity for the left handle |
| `end_entity` | required | Entity for the right handle |
| `name` | start entity's name | Title shown above the slider |
| `icon` | start entity's icon | Icon next to the title |
| `color` | `primary` | A Home Assistant colour name (`red`, `teal`, …) or any CSS colour |
| `min` / `max` | from the entity | Range of the slider (times: minutes, `0` – `1440`) |
| `step` | from the entity | Step (times: minutes, default `15`) |
| `min_gap` | `step` | Smallest distance between the two handles |
| `show_scale` | `true` | Show the scale under the slider |
| `show_icon` | `true` | Show the icon |

### Examples

Minimum and maximum temperature from two `input_number` helpers:

```yaml
type: custom:range-slider-card
start_entity: input_number.boiler_min_flow
end_entity: input_number.boiler_max_flow
name: Flow temperature
color: deep-orange
min_gap: 5
```

A time window with 30-minute steps:

```yaml
type: custom:range-slider-card
start_entity: time.dhw_window_start
end_entity: time.dhw_window_end
name: Hot water
step: 30
```

## How it behaves

- Drag a handle, or tap the track to move the nearest handle there.
- The value is written when you release the handle, so each drag is one service call per entity.
- The handles cannot cross: they always stay at least `min_gap` apart.
- Keyboard: Tab to a handle, then the arrow keys (one step) or Page Up / Page Down (ten steps).
- A time of 24:00 is saved as 23:59, because Home Assistant times cannot be 24:00.

## License

MIT
