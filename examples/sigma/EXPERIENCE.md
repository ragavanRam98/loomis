# EXPERIENCE.md - Sigma

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Calculator | App open | Enter expressions and compute with full scientific functions |
| History | The clock icon on Calculator | Review and reuse past calculations |
| Settings | The settings icon on Calculator | Angle mode, precision, and appearance |

## Calculator

Purpose: The main scientific calculator - a large result display above a dense, tactile keypad.
Story: calc-main
Layout:
- Top bar with the app name "Sigma" on the left, and a clock/history icon plus a settings gear icon on the right
- A large right-aligned display: the current expression on a smaller muted line, and the live result in large bright type beneath it
- A small "DEG" chip near the display showing the current angle mode
- A row of scientific function keys: 2nd, deg/rad, sin, cos, tan
- A second row of scientific keys: ln, log, square-root, x squared, x to the power y
- A third row of scientific keys: open paren, close paren, pi, e, factorial
- The main keypad as a 4-column grid: AC, delete, %, divide on the first row; then 7 8 9 multiply; 4 5 6 minus; 1 2 3 plus; and 0, decimal point, equals on the last row
- The equals key is emphasised in the warm accent color; operator keys use the primary blue
Microcopy:
- title: "Sigma"
- angleMode: "DEG"
- clear: "AC"
- result: "1,024"
States:
- result: after equals, the result shows large and the expression moves to the secondary line
- error: an invalid expression shows "Math Error" in the danger color
Nav:
- History icon -> History
- Settings icon -> Settings

## History

Purpose: A scrollable list of past calculations the user can tap to reuse.
Story: history-view
Layout:
- Top bar with a back chevron on the left and a "History" title
- A vertical list of past calculations; each row shows the expression on top and the result beneath in the accent color
- A "Clear history" text button below the list
- A calm empty state shown when there are no calculations yet
Microcopy:
- title: "History"
- clearAll: "Clear history"
- empty: "No calculations yet."
States:
- empty: when there is no history, show the empty message centered
Nav:
- A history row -> Calculator
- Back chevron -> Calculator

## Settings

Purpose: Configure angle mode, decimal precision, and appearance.
Story: settings
Layout:
- Top bar with a back chevron and a "Settings" title
- A grouped settings list: an "Angle mode" row with a Degrees / Radians segmented toggle; a "Decimal places" stepper row; a "Haptic feedback" switch row; and a "Theme" row
- An "About Sigma" row at the bottom showing the app version
Microcopy:
- title: "Settings"
- angleLabel: "Angle mode"
- about: "About Sigma"
States:
- default: Degrees is selected
Nav:
- Back chevron -> Calculator
