# Changelog

Everything that changes in Loomis goes here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions follow [SemVer](https://semver.org/).
We're pre-1.0, so the CLI verbs and the JSON output can still change between minor versions.

## [Unreleased]

### Fixed
- Real screens arrive again. Stitch's `get_screen` now takes the screen's resource name alone and refuses a request with any other field, so every screen timed out after Stitch had generated it. Loomis now sends only the name.
- A tool that runs but fails (MCP's `isError`) is raised as an error with its message, instead of being taken as an answer that a poll waits on until it times out.
- A screen can no longer come out as an image. Stitch's answer to a generate can name a screen it reused, such as a logo, beside the new page, and Loomis took the last one named. It now takes the page, the screen with a device type.

## [0.2.0] - 2026-06-22 - first public release

The first version I'm putting out. It does everything I set out to build, plus the studio I added
on top. 142 tests pass.

### Building the prototype
- Reads your `DESIGN.md`, pins a design system from it (colors, fonts, tone), and stops to let you approve the look before it generates anything.
- Lists your screens from `EXPERIENCE.md` and your stories, then generates each one with Stitch, one at a time, so a slow or failed screen never drags down the rest.
- Links the screens into a real page-graph, pulls every asset local, and bundles a site that runs offline. A link checker makes sure nothing's broken, and even a half-finished run still opens.
- Skips screens that haven't changed on a re-run, and keeps the previous version of anything you change.
- Lets you re-roll a screen, edit one in your own words, ask for a few alternatives and pick one, or fold your edits back into the spec so a clean re-run reproduces them.

### The studio
- `studio` runs the whole weave on a local page in your browser and stops where you decide things.
- Reopen a project and your screens are right there, no rebuild. One studio per project.
- A command bar that reads what you ask: edit a screen, get alternatives, or add a new one. It never quietly replaces a screen when you asked for a new one, and it shows you what it chose.
- A `--brain=agent` mode hands those decisions to an outside agent instead of the built-in one.
- Live previews, feedback while it works, and a theme that follows your system's light or dark setting.
- `watch` gives you a read-only progress board if you'd rather run headless.

### Packaging
- MIT license, the BMAD persona and workflow as files, two example apps (Sigma, Vital), and the docs (README, this changelog, contributing guide, architecture notes).
- `init` now creates the run folder for you if it isn't there.

### What's not done yet
- Standalone is the supported way to install it for 0.2.0. The BMAD module ships as files but isn't drop-in yet. Wiring it into a BMAD project is manual right now, and a one-command installer is next.
- Stitch is the only provider so far; others can plug into the same port.
- The studio's own UI loads web fonts online. The prototype it builds stays fully offline.
- Still on the list: the BMAD installer, multi-device output, and a few smaller refinements.
