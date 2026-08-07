# SVG Format Guide: Diagnosis and Fixing

Inline SVG charts for this blog live in `public/posts/<slug>/charts/*.svg`.
They are embedded via `<img src="...svg">`, so they **must be valid XML** — a single
syntax error makes the browser show a broken image icon.

## Common Failure Modes

### 1. Unescaped ampersands (most common, breaks parsing)

A bare `&` in any attribute value or text node is invalid XML.

```xml
<!-- BROKEN: bare & in aria-label -->
<svg aria-label="...the S&P 500 at 4.75x...">

<!-- FIXED: escape as &amp; -->
<svg aria-label="...the S&amp;P 500 at 4.75x...">
```

Rule: **every `&` must be `&amp;`** — in `aria-label`, `title`, `desc`, and text nodes.
The only exception is the XML declaration `<?xml ... ?>` on line 1.

### 2. Bars not anchored to the axis baseline

Bars must start from the x-axis (the baseline `y`), not float in mid-air.

```xml
<!-- BROKEN: floating bar (does not touch y=340 baseline) -->
<rect x="120" y="40" width="44" height="180" .../>

<!-- FIXED: bar extends from baseline up -->
<rect x="120" y="160" width="44" height="180" .../>
```

Compute bar geometry from the scale:
```
bar_top    = baseline_y - (value * px_per_unit)
bar_height = value * px_per_unit
```

### 3. Y-axis labels misaligned with gridlines / bars

Labels must sit on the same `y` as their gridline, which must match the scale
used to draw the bars.

```
scale: px_per_unit = (baseline_y - top_y) / max_value
label_y_for_value_V = baseline_y - (V * px_per_unit)
```

A label is wrong if:
- it's inverted (0 at top, max at bottom) — flip the label positions
- the spacing is doubled/halved vs. the bar scale — recompute from `px_per_unit`

### 4. Content overflowing the viewBox

Every element must fit inside `viewBox="0 0 W H"`:
- No `y < 0` or `y > H`
- No `rect` whose `y + height > H`
- Source/credit text must have `y < H`

### 5. Reference lines at wrong position

A benchmark/reference line must use the **same scale** as the data bars.
If bars use `px_per_unit = 15.2`, the line for value `V` is at:
```
line_position = axis_origin + (V * px_per_unit)
```
Do not mix scales (e.g. using `total_width * ratio` instead of `px_per_unit`).

## Diagnosis Workflow

Run these in `public/posts/<slug>/charts/`:

```bash
# 1. XML well-formedness (catches unescaped &, malformed tags)
xmllint --noout chart-name.svg && echo "VALID" || echo "BROKEN"
```

```bash
# 2. Geometry check: find overflows and negative coordinates
python3 << 'EOF'
import re
xml = open('chart-name.svg').read()
vb = re.search(r'viewBox="([\d\s.]+)"', xml).group(1).split()
vbw, vbh = float(vb[2]), float(vb[3])
print(f"viewBox: {vb[2]} x {vb[3]}")
for m in re.finditer(r'<rect[^>]*?y="([\d.]+)"[^>]*?height="([\d.]+)"', xml):
    y, h = float(m.group(1)), float(m.group(2))
    if y < 0 or y + h > vbh: print(f"  OVERFLOW rect: y={y} h={h}")
for m in re.finditer(r'<text[^>]*y="([\d.]+)"[^>]*>([^<]*)</text>', xml):
    y = float(m.group(1))
    if y < 0 or y > vbh: print(f"  OVERFLOW text: y={y} '{m.group(2)}'")
```

```bash
# 3. Label-gridline alignment: label Ys must match gridline Ys
python3 << 'EOF'
import re
xml = open('chart-name.svg').read()
labels = [g[1] for g in re.findall(r'<text x="\d+" y="([\d.]+)"[^>]*>[\dx%]+</text>', xml)]
grids  = [g[1] for g in re.findall(r'<line x1="\d+" y1="([\d.]+)"[^>]*opacity="0\.0[68]"', xml)]
print("label Ys:", sorted(set(labels), key=float))
print("grid  Ys:", sorted(set(grids),  key=float))
```

## Validation Checklist

Before committing a chart, verify:

- [ ] `xmllint --noout` passes (no XML errors)
- [ ] No bare `&` — all escaped as `&amp;`
- [ ] All bars start from the baseline (`y + height == baseline_y`)
- [ ] Y-axis labels align with gridlines and match bar scale
- [ ] No element overflows the viewBox
- [ ] Reference/benchmark lines use the same scale as bars
- [ ] `<title>` and `<desc>` present (accessibility)
- [ ] `role="img"` and `aria-label` present on `<svg>`
