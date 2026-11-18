# Review 56: UI cleanup P545 to P553

Reviewed `d33c7399..07f29234`, excluding audit and brief files. Read the ROOM.md and layout-css.test.js merge resolutions first. No product files changed.

## R56-1: Medium: Teams hides read errors while closed

File: `src/ui/FamilyTree.jsx:515`, with the alert at line 622.

The initial teams request still runs while Teams is closed. Its catch sets an error, but the closed body also hides that alert. A failed read leaves an ordinary Teams heading with no sign that saved teams could not be read.

How to see it: clear the saved Teams fold choice, make `client.teams()` reject, and open Agents. The error appears only after opening Teams.

Fix: render the error outside the folded body, so the heading can stay closed without hiding a failure.

## R56-2: Medium: Family action targets cover the Edit button

File: `src/styles.css:10784`, with the row layout at lines 9662 and 9672.

Add, Chat and trash are 18 pixels high, but their centered targets are 24 pixels high. The actions row has no vertical padding or gap from the Edit button above it. Each target extends 3 pixels into that button and 3 pixels below its own row. The new 6 pixel horizontal gap only separates actions on the same line.

How to see it: in Agents, click the bottom edge of a lane's Edit button directly above Add or Chat. The action target catches that click. The last 3 pixels below the trash icon's row can also open its remove card. This follows from the CSS; a check by eye is left to the orchestrator.

Fix: reserve at least 24 pixels of height for the actions row while keeping the visible icons centered at 18 pixels. Test that adjacent row buttons do not intersect the targets.

## R56-3: Low: The code map still puts Repository first

File: `docs/agents/architecture/CODE.md:54`.

The RepositoryPanel entry still says `the Repository section at the top of Projects`. P551 puts it after the current and recent projects in `src/ui/Sidebar.jsx:861`. ROOM.md now gives the correct order, so the two architecture files disagree.

How to see it: open Projects with current and recent projects present, or read `renderProjects` at lines 818 to 862.

Fix: change the code map entry to say Repository follows the project rows.

The merge resolutions retain the footer placement, state rules, target assertions and white console assertions. End ages use finishedAt and stay blank without it. Branch wording and the menu pin action remain. Needs you appears once before the project form; its rows were text-only before this range too. The reviewed tab dots, runner notice and address title match their changes.

Checked and fine
