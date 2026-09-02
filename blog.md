---
layout: page
title: Blog
description: Occasional notes and musings.
permalink: /blog/
section: blog
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
