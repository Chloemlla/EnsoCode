---
name: bar-chart
description: Render a small horizontal bar chart in the chat when presenting a numeric breakdown (counts, sizes, durations) with up to ~20 labelled values.
---

When a numeric breakdown would be easier to read as a chart, emit a fenced code block whose
language tag is `enso.example.wordstats:bars`. Put one `label: number` pair per line:

````markdown
```enso.example.wordstats:bars
src: 1240
docs: 310
test: 95
```
````

Keep labels short, use plain numbers (no units or thousands separators), and still state the key
takeaway in prose — the chart only renders when the Word Stats plugin is enabled.
