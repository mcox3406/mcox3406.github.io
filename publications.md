---
layout: page
title: Publications
permalink: /publications/
---

{% assign pubs = site.data.publications | sort: "year" | reverse %}
<ul class="pubs">
{% for p in pubs %}
  <li>
    <div>{{ p.title }}</div>
    <div class="a">{{ p.authors | replace: "M. Cox", "<b>M. Cox</b>" }}</div>
    <div class="v">{{ p.venue }}, {{ p.year }}{% if p.note %} ({{ p.note }}){% endif %}
      {% if p.doi %}<a href="https://doi.org/{{ p.doi }}">doi</a>{% endif %}
      {% if p.arxiv %}<a href="https://arxiv.org/abs/{{ p.arxiv }}">arXiv</a>{% endif %}
      {% if p.pdf %}<a href="{{ p.pdf | relative_url }}">pdf</a>{% endif %}
      {% if p.code %}<a href="{{ p.code }}">code</a>{% endif %}
    </div>
  </li>
{% endfor %}
</ul>
