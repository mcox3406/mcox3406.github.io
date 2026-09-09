# mcox3406.github.io

Personal academic site, built with Jekyll and deployed to GitHub Pages by the workflow in `.github/workflows/pages.yml`.

## Editing

| What | Where |
| --- | --- |
| Bio (home page) | `index.md` |
| Sidebar name, nav, links | `_config.yml` (`author`, `nav`, `links`) |
| Publications | `_data/publications.yml` |
| CV | LaTeX source in `cv-src/`; run `latexmk -pdf cox_resume_MIT.tex` there and copy the PDF to `assets/cv.pdf` |
| Photo | put `assets/images/photo.jpg` in place and point the `<img>` in `index.md` at it |
| Blog posts | `_posts/YYYY-MM-DD-slug.md`, with figures, data and notebooks in `assets/posts/<slug>/` |
| Styles | `assets/css/main.css` |
| Fun projects | `fun/index.html`; add another project card here |
| Running planner | `fun/running/index.html`, `assets/css/milepost.css`, `assets/js/milepost*.js` |
| Sidebar mark (unit cell) | `_includes/mark.svg`, favicon in `assets/favicon.svg` |
| Homepage molecular landscape | `_includes/molecular-landscape.svg`; placement and opacity in the home section of `assets/css/main.css` |

## Writing a post

Front matter:

```yaml
---
title: Post title
date: 2026-01-31
description: One line shown on the blog index.
tags: [ml, chemistry]
---
```

Math uses kramdown's `$$ … $$` delimiters for both inline and display math and is rendered at build time with KaTeX, so pages need no math JavaScript. Fenced code blocks are highlighted with Rouge and get a copy button. Everything a post needs (figures, data files, the notebook it came from) goes in `assets/posts/<slug>/` and is referenced with `{{ '/assets/posts/<slug>/...' | relative_url }}`. Files there are served, so a post can link to its own notebook and data. Use a `<figure>` with a `<figcaption>` for captions.

To turn a notebook into a post:

```sh
jupyter nbconvert --to markdown notebook.ipynb --output-dir _posts --NbConvertApp.output_files_dir=../assets/posts/<slug>
```

then add front matter and fix the image paths. Interactive Bokeh or Plotly HTML can be saved in the same folder and included with `<div class="embed"><iframe src="..." height="500"></iframe></div>`.

## Local preview

```sh
bundle install
bundle exec jekyll serve --livereload
```

Server-side KaTeX needs a JavaScript runtime (Node) on the machine that builds the site.

`notebooks/` holds scratch notebooks that are not part of any post and are excluded from the build.

`assets/js/molecules.js` draws random carbon skeletons and is not loaded by any layout; it is kept in case a molecule graphic is wanted later.

## Running planner

`/fun/` is the side-project index. `/fun/running/` is a static, browser-only prototype with a training calendar, race-equivalent pace references, weekly workload, nutrition notes, and local training logs. Use American English and descriptive scientific terminology in the interface; distinguish observations, model estimates, assumptions, and user preferences. The page supports the site's light/dark themes and uses no additional packages or AI requests.

**AI workflow:** Create plan → answer the training questions → edit/copy the coaching prompt into your own AI chat → refine the plan → import the final JSON. Visitors use their own AI service; the site collects no API keys and incurs no AI usage charges. An integrated generation flow would require a separate backend design; do not embed API credentials in this repository or browser code. [OpenAI key guidance](https://developers.openai.com/api/reference/overview#authentication).

The editable coaching instructions and JSON contract live in `buildPrompt` in `assets/js/milepost-core.js`. Imported plans are validated before replacing the current plan: version 1, `mi` or `km`, 1–168 consecutive dates including rest days, typed numeric values, and bounded text fields. Plan text is rendered as text, never HTML. Exported JSON includes check-ins and can be reimported; `.ics` export is available inside day details and contains the full plan as all-day events.

The sample covers September 7–November 8, 2026, ahead of CIM on December 6. Five preparation weeks total 90, 94, 98, 100, and 92 mi, with Tuesday 5K/10K intervals, Friday mile-effort repetitions, easy doubles, and easy 22–24 mi Sunday runs. The existing marathon-specific block starts October 12 at 96, 104, 110, and 88 mi/week, including alternating 22 mi long runs ending with 10 mi at 5:50–5:54/mi. These are planned examples, including the opening Monday; there is no inferred completion. The final preparation and race taper after November 8 are not scheduled. Long-run distance, volume, and fast finishes follow the user's preferences; training/nutrition references are linked on the page.

`SAMPLE_REVISION` identifies this sample. The previous four-week CIM sample automatically gains the missing preparation dates. Earlier CIM samples receive the longer Sunday runs and corresponding weekday mileage reductions only when all affected dates in a week are future/today, unlogged, and match the original sample. Otherwise that week’s distances stay intact. Check-ins, custom workouts, and any edited or removed pace reference are retained. Unmodified sample copy is updated to American English. Imported plans are not auto-extended. Other untouched older demos update automatically; older demos with recorded data are preserved. “Load sample” explicitly replaces the plan after confirmation. Optional daily `phase` labels distinguish the preparation and marathon-specific portions and are retained in JSON exports.

The calendar opens to the device’s current local month and week, including when today falls outside the plan; unscheduled weeks show no planned totals. A local-midnight timer plus focus, visibility, and page-restoration events refresh the date. The current view follows the date across week/month boundaries when already viewing today; browsing another week and unsaved day-dialog inputs are preserved. “Today” always reads the clock again. Importing or explicitly loading a plan shows the current date if included, otherwise its first day for review. No dates, completion flags, or workouts are automatically shifted or generated.

The **Analysis** tab (`/fun/running/#analysis`) adds cumulative and weekly distance, duration, and effort-index charts; a date slider; weekly workout composition; a seven-day workout list; reported-RPE points; a weekly data table; and CSV export. Chart and table selections share the calendar’s selected week. The analysis view and calendar have keyboard-accessible tabs. `analyzePlan` in `milepost-core.js` computes the statistics, `_includes/running-analysis.html` supplies the layout, and `milepost-analytics.js` renders local SVG/HTML charts without external chart libraries or services.

Analysis distinguishes planned totals, **completed plan** (prescribed values for running days checked off through today), and actual reported main-session RPE. **Imported activities** add observed running distance and moving time from a user-controlled Strava snapshot. These are separate from completed prescriptions; imported runs never mark scheduled workouts complete. Future check-ins are excluded from completion and RPE analysis; missing RPE remains missing. The effort index is planned minutes × prescribed main-session RPE, a descriptive daily estimate that combines doubles and workout segments; it is not measured session-RPE load or a fitness/injury-risk score. Full-week averages and week-to-week changes exclude partial weeks; the peak rolling seven-day total requires seven consecutive dates. Completion percentage considers only scheduled running days before today. Charts and CSV use the selected distance units and preserve those definitions for zero-mileage, short, and imported plans.

Pace references use the Daniels–Gilbert equations, reproduced in [Smyth et al. (2022), Eqs. 7–9](https://link.springer.com/article/10.1007/s11257-021-09299-3#Equ7), with binary search for equivalent durations. The 2:35:00 marathon goal corresponds to a VDOT index of about 63.82. This is not measured VO₂max, and equivalents do not establish current fitness. The reference editor accepts a goal or recent result and updates only the reference table. Calendar workout prescriptions are not rescaled. `paceReference` is an optional plan field: `{ distanceMeters, timeSeconds, basis: "goal" | "recent-race" }`. Supported distances are 42195, 21097.5, 10000, 5000, and 1609.344 m. The reference is validated and preserved in JSON exports. It is absent for older plans until explicitly set; other visitors do not inherit the sample's target.

Distance and duration summaries count running only. Optional daily `easyMinutes` accounts for easy segments inside mixed workouts and doubles; when missing, that day's contribution falls back to all/none of its minutes according to RPE ≤ 4. The interface labels whether segment data are complete. This is an estimated duration split, not physiological time-in-zone. Daily completion means all prescribed runs for that date; the log records main-session RPE separately. The mi/km control converts distances and reference paces. Calendar pace strings retain their explicit written units.

Plan data, reference performances, generated training-brief answers, check-ins, imported activity history, and unit preferences are saved under `milepost.v1` in localStorage (the original internal namespace is retained for compatibility). The optional personal sync connection is described below. Private browsing, storage restrictions, or clearing site data can remove persistence; use Export to keep a copy. Clear saved data removes only the planner's data and preserves the site's theme preference.

Run model/validation checks with `node --test tests/milepost*.test.js` and build with `bundle exec jekyll build`. Tests are excluded from the generated site.


### Strava activities and training review

The **Activities** tab (`/fun/running/#activities`) initially uses the [official Strava MCP route documented by Strava](https://support.strava.com/en-us/articles/15401531-strava-mcp-connector), currently launching through Claude for eligible subscribers. Connect in Claude under Customize → Connectors → Strava, authorize there, and use the page’s export prompt in that connected chat. The manual workflow makes no network or AI requests. The optional direct connection adds a personal MCP backend and browser session, described below. Strava credentials are never returned to the browser. Subscription eligibility and the actual authenticated connector fields must be checked in the user’s account; browser tests use explicitly synthetic fixtures and do not verify a live Strava connection.

The prompt asks Claude to map verified fields into a **custom dashboard snapshot**, not a native MCP response: `{version:1, kind:"strava-activities", source:"strava-official-mcp", athleteId, exportedAt, rangeStart, rangeEnd, complete, activities}`. Athlete/activity IDs are numeric strings. Each activity includes `id`, `startLocal` (local wall time, no timezone suffix), `sport` (`Run`, `TrailRun`, or `VirtualRun`), `name`, `distanceMeters`, and `movingSeconds`. Optional `elapsedSeconds`, `elevationMeters` (elevation gain), and `averageHeartRate` stay absent when unavailable. No GPS coordinates or credentials are requested or retained. The exporter must explain missing required fields instead of inventing them. JSON is limited to 4 MB; imports cover at most 184 days; saved history supports up to 5,000 activities and 4,000 coverage dates. Validation is structural: it cannot authenticate an AI-generated file or verify the claimed completeness.

Imports have an explicit preview and save step. Original IDs preserve doubles and prevent duplicate mileage. A complete snapshot updates and reconciles its date range, including previewed removals of previously imported IDs absent from the new snapshot. A partial snapshot adds/updates runs without deletion and marks its range incomplete. Runs outside the range are retained. Older exports and mixed athlete IDs are rejected. Coverage reflects the latest imported range’s completeness claim; today is always unfinished in comparisons. Activity local dates determine calendar placement, regardless of the browser’s timezone.

The page shows recent distance, moving hours, longest individual run, days with doubles, individual activity pace, optional elevation/heart rate, and six weeks of plan-versus-recorded totals through yesterday. Weekly differences require complete export coverage and a plan on every included date. Imported totals can be incomplete; missing exports do not establish rest or missed workouts. The Analysis tab adds imported distance/moving-time series, CSV columns, and coverage counts within plan dates. No actual effort score, physiological zone, readiness verdict, or race prediction is inferred from pace or heart rate. Moving pace uses recorded distance and moving seconds, not elapsed time or estimated interval splits.

**Review workflow:** enter current recovery, fueling, and schedule observations → prepare the review prompt → discuss with Claude using the official connector → import its `training-adjustment` JSON → inspect each workout and before/after weekly totals → Apply. The prompt includes the full current plan, questionnaire, saved check-ins, and the past 42 completed local dates plus today’s available activities; observations are included only when preparing the prompt and are not separately persisted. It asks for missing information, respects user preferences, distinguishes goals from demonstrated fitness, and allows an unchanged plan. If newer activity evidence materially changes the recommendation, refresh the snapshot and regenerate the prompt first.

Adjustment envelopes contain `{version:1, kind:"training-adjustment", contextKey, summary, changes:[{date, reason, workout}]}`. Each `workout` is a full validated replacement day in the plan’s original units. Only existing dates from tomorrow through the next 14 days can change; dates with saved logs are protected. The context token detects changes to the plan, training inputs, check-ins, activity history, or local date and is checked again at Apply. It is a stale-data check, not authentication. Applying preserves historical prescriptions, check-ins, activity history, and pace references. Export a backup first to retain the previous plan; no automatic version archive is maintained.

Plan JSON backups include activity history and training inputs. Restore through **Import plan**: plain plan imports retain activity history; backups containing history replace it, with account-mixing protection. Loading the sample retains imported activities. Clear saved data clears all planner data, including activity history and pending prompts, while preserving the site theme. `milepost-activities-core.js` implements validation, reconciliation, observed totals, and review contracts; `milepost-activities.js` handles the UI in `_includes/running-activities.html`.


### Optional direct personal connection

`services/running-sync/` contains a separate Cloudflare Worker and SQLite-backed Durable Object for Strava’s **official MCP**. `assets/js/milepost-sync.js` adds the direct-connection controls, browser return flow, and automatic refresh to the existing Activities view. The backend's scope and checks are described in [`services/running-sync/README.md`](services/running-sync/README.md). Personal setup notes belong in `local-notes/`, which is ignored by Git and excluded from the site build.

Strava authorization and activity imports have not yet been verified. The official public metadata advertises OAuth client registration, but client admission and authenticated activity-tool schemas still require verification. The UI distinguishes authorization from a working sync, keeps unknown completeness partial, and preserves existing data on errors. No ordinary Strava REST API fallback is used.

Once configured, the page requests the previous 42 local dates plus today on opening and every 15 minutes while visible. It refreshes when returning to the tab if due. The backend renews credentials serially and enforces request spacing; there is no closed-page background job, no webhook subscription, and no AI-generation charge. Activity responses are transient on the backend; the existing validated import model updates local history by original IDs. Plan prescriptions and check-ins remain unchanged. A private access code limits this backend to its owner; this is not a public multi-athlete service.

OAuth credentials are encrypted with a server secret, and the browser receives only a separate 30-day application session under `milepost.sync.v1`. A short-lived browser proof in sessionStorage binds authorization to its originating tab. Sessions are not included in exported training backups. Disconnect deletes backend credentials, attempts revocation, and clears local activity history. Clear saved data also removes the local session but does not independently revoke server authorization. All of `services/` is excluded from the Jekyll build, and local secrets, Wrangler state, and dependencies are gitignored.
