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
| Running statistics | `fun/running/index.html`, `assets/css/running.css`, `assets/js/running*.js`, `assets/data/running.json` |
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

## Running statistics

`/fun/running/` displays aggregate running statistics: estimated time-of-day running probability, a daily distance calendar, weekly mileage, mean distance by weekday, and distance versus moving pace. Labels and descriptions are factual; there is no individual activity table. Editable page copy is in `fun/running/index.html`, with summary labels in `renderStats` in `assets/js/running.js`. It shares the site's type, colors, and light/dark themes. There are no training plans, AI requests, account connections, or background activity syncs. The only data request is for the site's static JSON snapshot.

### Preserved planner and Strava work

The previous planner, manual MCP workflow, personal Cloudflare service, and uncommitted runtime fixes are preserved on GitHub at [`archive/running-planner-strava-2026-09-10`](https://github.com/mcox3406/mcox3406.github.io/tree/archive/running-planner-strava-2026-09-10), commit `4404cd8`. That branch includes the old setup documentation and tests. To revisit it, use a separate worktree or branch; it does not need to be deployed to restore development. The retrospective removes the client connection code, service source, endpoint configuration, and service CI from the active tree. It does not revoke external credentials or delete an already deployed Cloudflare Worker.

### Activity history and future updates

`assets/data/running.json` combines Matthew's supplied running exports for 2025 and 2026: **601 activities and 617 covered local dates**. The page opens to the latest year; the year selector also includes 2025.

| Export range | Activities | Distance | Moving time | Complete dates |
| --- | ---: | ---: | ---: | ---: |
| 2025-01-01–2025-12-31 | 358 | 4,648,329.74 m (2,888.3 mi) | 1,189,061 s (330.3 h) | 365 |
| 2026-01-01–2026-09-09 | 243 | 3,771,837.65 m (2,343.7 mi) | 959,010 s (266.4 h) | 252 |

The exports declare their respective date ranges complete. Validation confirms no duplicate IDs or overlapping coverage across the two exports. Activity fields are preserved exactly, with records sorted by local start and completeness normalized to date-by-date coverage. The original downloads remain unchanged. Completeness is retained as the exporter's assertion; dates after September 9, 2026 have no export coverage and are excluded from probability and weekday-average denominators.

Synthetic data remains available only through `RunningCore.demo()` for tests, and the downloadable JSON template is explicitly marked as a demo. Future exports can replace the public snapshot using this workflow:

1. Obtain an activity export locally or through a connected MCP chat. **Data and import** includes an export request and JSON/CSV templates. The connected chat retrieves records; the website does not authenticate with a provider.
2. Preview the snapshot using **Data and import → Preview import → Use this history**. Check units, local dates, coverage, and totals against the original source.
3. Export the validated snapshot. To make it the public history, replace `assets/data/running.json` with that reviewed file and commit it. Imported files otherwise stay in the visitor's browser. The page retains only activity IDs, names, local start times, sport, distance, moving duration, optional elapsed duration and elevation gain, plus athlete ID, coverage, and the demo flag. Review names and times before publishing; routes and credentials are not part of the normalized format.

JSON contract (also in `assets/data/running-template.json`):

```json
{
  "version": 1,
  "kind": "running-activities",
  "rangeStart": "2025-01-01",
  "rangeEnd": "2025-12-31",
  "complete": true,
  "activities": [
    {"id": "original-id", "startLocal": "2025-01-03T07:30:00", "sport": "Run", "name": "Morning run", "distanceMeters": 10000, "movingSeconds": 3600}
  ]
}
```

The downloadable JSON template is marked `demo: true`; remove that flag when replacing its examples with verified activity history. IDs are strings; local timestamps have no timezone suffix. Supported sports are `Run`, `TrailRun`, and `VirtualRun`. Distances/elevation are meters, times seconds. Optional `elapsedSeconds` and `elevationMeters` remain absent when missing. Zero-distance and zero-moving-time records are rejected. The parser rejects duplicate IDs, invalid dates/numbers, and snapshots above 12 MB or 20,000 activities. Extra fields are discarded. Importing replaces the current history after an explicit preview; separate snapshots are not silently merged.

`complete: true` declares every running activity in the entire inclusive local-date range was retrieved, including dates with no activity. This is an exporter assertion, not independently verified. Alternatively, use `coverage: {"2025-01-01": true, "2025-01-02": false}` for date-specific completeness. Dates absent from coverage are unknown. CSV uses the same activity column names as JSON and has no coverage declaration; the probability and weekday-average charts are unavailable until complete coverage is supplied in JSON. Native provider exports must be converted explicitly; no implicit unit or timezone guessing.

Old `strava-activities` snapshots, exported activity histories, and planner backups containing `activityHistory` are accepted. The new storage key is `running.retrospective.v1`; old `milepost.v1` data remains untouched and can be recovered through the data dialog when it contains activities. Unit preferences use `running.retrospective.units`; theme preferences remain separate. Returning to the site's snapshot downloads a backup of the active local import before clearing the new storage key. Storage failures are surfaced; imports still work in memory and can be exported.

### Statistical definitions

- Time-of-day probability: local start plus moving duration approximates a continuous running interval. Split at midnight, merge overlapping intervals on each date, then divide occupied minutes in each 15-minute clock bin by `15 × fully covered dates`. The denominator includes covered dates with no runs. Weekday/weekend controls filter both numerator and denominator. Pauses cannot be located, so this is a descriptive approximation, not exact moving-time telemetry or a forecast. Today and future/incomplete dates are excluded.
- Daily/weekly totals and scatter points include imported runs in the selected year through today, even with incomplete coverage. A run's entire distance is assigned to its local start date. Weeks start Monday. Partial weeks and incomplete coverage use faded bars; calendar underlines flag recorded distances with incomplete coverage.
- Weekday distance is mean recorded distance across fully covered past occurrences of that weekday, including zeros. Uncovered dates are excluded. Moving pace is moving seconds divided by distance in the selected units. Optional elevation remains in the activity snapshot when available.
- All calendar arithmetic uses UTC only as a container for local wall-clock values, so results do not change with the viewer's timezone. Year boundaries, leap days, doubles, and overlapping intervals are covered by the model tests. A clock refresh updates today's cutoff on focus, visibility, and once per minute.

The UI uses local SVG and DOM elements, with no chart dependencies. The time slider works with keyboard arrows; the daily calendar has one tab stop, arrow navigation, Home/End, and Enter/Space selection. Calendar selection displays the daily total. Plot descriptions, point titles, and captions provide alternate context.

Run `node --test tests/running*.test.js` and `bundle exec jekyll build` before publishing.
