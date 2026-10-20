# Changelog

Everything that changes in Loomis goes here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions follow [SemVer](https://semver.org/).
We're pre-1.0, so the CLI verbs and the JSON output can still change between minor versions.

## [Unreleased]

### Added
- Links are wired by their labels. `nav-graph` keeps the label each `- Label -> Screen` line in `EXPERIENCE.md` gives a link, and `wire` looks for that label first. A link whose `data-nav` hook Stitch dropped, or whose hook still names a screen the spec has since changed, now goes on the element that carries its label. A labelled link into a start screen, such as Sign out, goes on its label instead of a back arrow. When several Nav lines link the same two screens, such as a back link and a submit button, the edge keeps every label in a new `labels` list, and each element carrying one is linked, even when another element already links the two screens; a submit button that lost its hook still goes where the spec says.

### Fixed
- `refine` no longer waits ten minutes on an image. An edit that adds pictures, such as a poster on each card, can answer naming only the images it made, with DOM operations that put them on the page, or naming the new page before it has a device type. Loomis waited on the last screen named, an image, which never gets a page, and the paid edit was lost. With no page among the screens named, it now applies the answer's DOM operations, and otherwise waits for whichever named screen gets a page. If that still times out, the error names every screen it waited for.
- `wire` no longer reports links nobody declared. `nav-graph` guessed a way back for every link, so a top bar's Profile link on every page made Profile "link back" to every page, and those guesses were all 65 of the unconnected edges in a real 34-screen run. A link in a Nav list is now one-way. The IA's "Reached from" edges still get a way back, except out of a screen whose Nav list already declares its links.
- `refine` keeps the edits Stitch makes in place. Stitch's edit agent can edit a screen in place: its answer then names no new screen and carries DOM operations for the client to apply, which Stitch's own page does, while the screen it stores keeps its old HTML. Loomis took the screen being edited as the target and waited ten minutes for a change that never came, and the edit was lost. It now applies the operations to the screen's HTML (set or remove an attribute or class, remove, replace, insert or fill an element), acting on the element Stitch quotes when a selector matches several, or when it matches none and only one element looks like the quote. They go on top of the screen as the run has it, so successive in-place edits add up. An answer with no screen and no operations fails straight away with Stitch's words.
- `refine` no longer loses edits Stitch has made. It waited three minutes for the edited page, and an edit of a big page can take longer; and the answer to an edit can name an image beside the page, while Loomis polled the last screen named. A refine now takes the page, as a generate does, and waits up to ten minutes. If the edit still hasn't landed, the error names Stitch's screen, so it can be fetched later instead of paid for again.
- `refine` edits a screen as the device Stitch made it for. Stitch can make a phone screen in a project whose `DESIGN.md` says desktop, and the edit went to Stitch as a desktop one, which can lay the screen out again for a desktop.
- The bundle names no remote host at all. `assemble` already vendored Google Fonts, but kept each page's `preconnect` hints to Google's hosts. Connection hints to remote hosts now go when assets are vendored.
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
