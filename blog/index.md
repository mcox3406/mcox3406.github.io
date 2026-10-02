---
layout: page
title: Blog
description: Notes, side projects, and interactive tools.
permalink: /blog/
section: blog
stylesheets: [/assets/css/blog.css]
---

{% assign projects = site.pages | where: "blog_entry", true %}
{% assign entries = site.posts | concat: projects | sort: "date" | reverse %}
<div class="blog-list">
{% for entry in entries %}
  <article class="blog-entry">
    <a class="blog-entry-link{% unless entry.thumbnail or entry.thumbnail_include %} blog-entry-text{% endunless %}" href="{{ entry.url | relative_url }}">
      {% if entry.thumbnail or entry.thumbnail_include %}
      <div class="blog-thumbnail{% if entry.thumbnail_include %} blog-thumbnail-illustration{% endif %}" aria-hidden="true">
        {% if entry.thumbnail_include %}{% include {{ entry.thumbnail_include }} %}{% else %}<img src="{{ entry.thumbnail | relative_url }}" alt="" loading="lazy" width="240" height="160">{% endif %}
      </div>
      {% endif %}
      <div class="blog-entry-copy">
        <time datetime="{{ entry.date | date_to_xmlschema }}">{{ entry.date | date: "%B %-d, %Y" }}</time>
        <h2>{{ entry.title }}</h2>
        {% if entry.description %}<p>{{ entry.description }}</p>{% endif %}
      </div>
    </a>
  </article>
{% endfor %}
</div>
