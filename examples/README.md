# Examples

Two ready-to-weave `bmad-ux` input folders, each containing `DESIGN.md` (visual tokens),
`EXPERIENCE.md` (information architecture + behavior), and `stories/`.

| Example | What it is |
|---------|-----------|
| [`shopkart/`](./shopkart) | **ShopKart** - an e-commerce marketplace (desktop): Home, Product detail. |
| [`sigma/`](./sigma) | **Sigma** - a scientific calculator (mobile): Calculator, History, Settings. |
| [`vital/`](./vital) | **Vital** - a health monitor (mobile): Dashboard, Activity, BMI Calculator, Goals, Profile. |

## Weave one

From the `loomis/` directory, after `npm install && npm run build`:

```bash
# Interactive (opens the studio in your browser; needs STITCH_API_KEY):
node dist/index.js studio ./run-vital ./examples/vital

# No network / no key - drive the in-memory provider end to end:
node dist/index.js studio ./run-vital ./examples/vital --fake
```

The first argument is a **run folder** (created if missing - your output workspace); the second is the
**example input folder**. The woven, offline prototype lands in `<run-folder>/out/` - open `index.html`.
