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
| Sidebar mark (unit cell) | `_includes/mark.svg`, favicon in `assets/favicon.svg` |

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
