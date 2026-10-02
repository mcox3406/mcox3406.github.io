---
layout: page
title: Blog
description: Notes, side projects, and interactive tools.
permalink: /blog/
section: blog
stylesheets: [/assets/css/running.css]
---

{% assign by_year = site.posts | group_by_exp: "post", "post.date | date: '%Y'" %}
{% for year in by_year %}
<div class="year">{{ year.name }}</div>
<ul class="posts">
{% for post in year.items %}
  <li>
    <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%b %d" }}</time>
    <div>
      <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
      {% if post.description %}<div class="d">{{ post.description }}</div>{% endif %}
    </div>
  </li>
{% endfor %}
</ul>
{% endfor %}

<a class="blog-project" href="{{ '/blog/running/' | relative_url }}">
  <div class="blog-art" aria-hidden="true">
    {% include running-track.svg %}
  </div>
  <div class="blog-project-copy"><div><h2>Running</h2><p>Historical running distance, duration, pace, and time-of-day distributions.</p></div><span class="blog-arrow" aria-hidden="true">↗</span></div>
  <span class="blog-project-link">View running statistics <span aria-hidden="true">→</span></span>
</a>
