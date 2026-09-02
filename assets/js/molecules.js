/*
 * Random carbon skeletons, drawn as SVG line art.
 *   .band            -> a spread of molecules that fade in and out (new set each visit)
 *   [data-molecule]  -> one fixed molecule (seeded, so the sidebar mark is stable)
 * Geometry is in bond-length units; rings are regular polygons, chains are zig-zags.
 */
(function () {
  var D = Math.PI / 180;
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function unit(v) { var n = Math.hypot(v[0], v[1]) || 1; return [v[0] / n, v[1] / n]; }
  function rot(v, deg) { var c = Math.cos(deg * D), s = Math.sin(deg * D); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // mulberry32: small seedable PRNG so the mark can be fixed while the band stays random
  function rng(seed) {
    var t = seed >>> 0;
    return function () { t = (t + 0x6D2B79F5) >>> 0; var r = t; r = Math.imul(r ^ (r >>> 15), r | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  }

  function Mol() { this.atoms = []; this.bonds = []; this.rings = []; this.ringAtoms = {}; }
  Mol.prototype.addAtom = function (p) { this.atoms.push(p); return this.atoms.length - 1; };
  Mol.prototype.bond = function (a, b, o) {
    for (var i = 0; i < this.bonds.length; i++) { var x = this.bonds[i]; if ((x[0] === a && x[1] === b) || (x[0] === b && x[1] === a)) { x[2] = Math.max(x[2], o || 1); return; } }
    this.bonds.push([a, b, o || 1]);
  };
  Mol.prototype.clear = function (p, ignore) {
    for (var i = 0; i < this.atoms.length; i++) { if (ignore.indexOf(i) >= 0) continue; if (dist(this.atoms[i], p) < 0.75) return false; }
    return true;
  };
  Mol.prototype.degree = function (i) { var d = 0; this.bonds.forEach(function (b) { if (b[0] === i || b[1] === i) d++; }); return d; };
  Mol.prototype.center = function (ring) { var c = [0, 0]; for (var i = 0; i < ring.length; i++) c = add(c, this.atoms[ring[i]]); return [c[0] / ring.length, c[1] / ring.length]; };

  // regular n-gon centred at c, first vertex at angle a0
  Mol.prototype.ring = function (n, c, a0) {
    var R = 1 / (2 * Math.sin(Math.PI / n)), ids = [], i;
    for (i = 0; i < n; i++) ids.push(this.addAtom(add(c, rot([R, 0], a0 - 360 * i / n))));
    for (i = 0; i < n; i++) this.bond(ids[i], ids[(i + 1) % n]);
    this.rings.push(ids); ids.forEach(function (id) { this.ringAtoms[id] = true; }, this);
    return ids;
  };
  // fuse an n-gon onto the bond p-q of ring r (both atom indices); returns new ring ids or null if it collides
  Mol.prototype.fuse = function (n, r, p, q) {
    var P = this.atoms[p], Q = this.atoms[q], c1 = this.center(r);
    var mid = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2], apo = 1 / (2 * Math.tan(Math.PI / n)), R = 1 / (2 * Math.sin(Math.PI / n));
    var u = unit(sub(mid, c1)), c = add(mid, [u[0] * apo, u[1] * apo]);
    var ap = Math.atan2(P[1] - c[1], P[0] - c[0]) / D, aq = Math.atan2(Q[1] - c[1], Q[0] - c[0]) / D;
    var sgn = (((aq - ap + 540) % 360) - 180) > 0 ? 1 : -1, pts = [], i;
    for (i = 1; i < n - 1; i++) pts.push(add(c, rot([R, 0], ap - sgn * 360 * i / n)));
    for (i = 0; i < pts.length; i++) if (!this.clear(pts[i], [])) return null;
    var ids = [p]; pts.forEach(function (pt) { ids.push(this.addAtom(pt)); }, this); ids.push(q);
    for (i = 0; i < ids.length; i++) this.bond(ids[i], ids[(i + 1) % ids.length]);
    this.rings.push(ids); ids.forEach(function (id) { this.ringAtoms[id] = true; }, this);
    return ids;
  };
  // zig-zag chain of `len` carbons leaving atom `from` in direction `dir`
  Mol.prototype.chain = function (from, dir, len, R) {
    var prev = from, cur, d = unit(dir), sgn = R() < 0.5 ? 1 : -1, p, i;
    for (i = 0; i < len; i++) {
      p = add(this.atoms[prev], d);
      if (!this.clear(p, [prev])) break;
      cur = this.addAtom(p); this.bond(prev, cur);
      // occasional methyl off the chain
      if (i > 0 && R() < 0.25) { var m = add(this.atoms[cur], rot(d, -sgn * 60)); if (this.clear(m, [cur])) this.bond(cur, this.addAtom(m)); }
      d = rot(d, sgn * 60); sgn = -sgn; prev = cur;
    }
    return prev;
  };

  function randomMolecule(R) {
    var m = new Mol(), i;
    var n0 = R() < 0.8 ? 6 : 5;
    var r0 = m.ring(n0, [0, 0], 90 + (R() < 0.5 ? 0 : 30));
    // fused rings
    var rings = [r0], tries = 0;
    while (rings.length < 3 && tries++ < 6 && R() < (rings.length === 1 ? 0.55 : 0.3)) {
      var r = rings[Math.floor(R() * rings.length)], k = Math.floor(R() * r.length), p = r[k], q = r[(k + 1) % r.length];
      if (m.degree(p) > 2 || m.degree(q) > 2) continue;
      var nr = m.fuse(R() < 0.7 ? 6 : 5, r, p, q); if (nr) rings.push(nr);
    }
    // ring double bonds, sparingly
    m.rings.forEach(function (r) {
      if (R() < 0.5) { var k = Math.floor(R() * r.length); m.bond(r[k], r[(k + 1) % r.length], 2); }
    });
    // branches
    var nb = 1 + Math.floor(R() * 3), ringIds = Object.keys(m.ringAtoms).map(Number);
    for (i = 0; i < nb; i++) {
      var a = ringIds[Math.floor(R() * ringIds.length)];
      if (m.degree(a) !== 2) continue;
      var ring = m.rings.filter(function (r) { return r.indexOf(a) >= 0; })[0];
      var dir = unit(sub(m.atoms[a], m.center(ring)));
      var len = R() < 0.5 ? 1 : 2 + Math.floor(R() * 2);
      var end = m.chain(a, dir, len, R);
      // terminal double bond now and then
      if (end !== a && R() < 0.25) { var last = m.bonds.filter(function (b) { return b[0] === end || b[1] === end; }); if (last.length === 1) last[0][2] = 2; }
    }
    return m;
  }

  function render(m, S, pad) {
    var xs = [], ys = [], i;
    for (i = 0; i < m.atoms.length; i++) { xs.push(m.atoms[i][0] * S); ys.push(-m.atoms[i][1] * S); }
    var minx = Math.min.apply(null, xs) - pad, maxx = Math.max.apply(null, xs) + pad, miny = Math.min.apply(null, ys) - pad, maxy = Math.max.apply(null, ys) + pad;
    function X(p) { return (p[0] * S).toFixed(2); } function Y(p) { return (-p[1] * S).toFixed(2); }
    function seg(a, b) { return '<line class="b" x1="' + X(a) + '" y1="' + Y(a) + '" x2="' + X(b) + '" y2="' + Y(b) + '"/>'; }
    function ringOf(a, b) { for (var k = 0; k < m.rings.length; k++) if (m.rings[k].indexOf(a) >= 0 && m.rings[k].indexOf(b) >= 0) return m.center(m.rings[k]); return null; }
    var out = '';
    m.bonds.forEach(function (b) {
      var p1 = m.atoms[b[0]], p2 = m.atoms[b[1]];
      if (b[2] === 1) { out += seg(p1, p2); return; }
      var u = unit(sub(p2, p1)), n = [-u[1], u[0]], ctr = ringOf(b[0], b[1]), off = 0.12, sh = 0.15;
      if (ctr) {
        var mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        if ((ctr[0] - mid[0]) * n[0] + (ctr[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
        out += seg(p1, p2) + seg(add(add(p1, [n[0] * off, n[1] * off]), [u[0] * sh, u[1] * sh]), add(add(p2, [n[0] * off, n[1] * off]), [-u[0] * sh, -u[1] * sh]));
      } else {
        out += seg(add(p1, [n[0] * off, n[1] * off]), add(p2, [n[0] * off, n[1] * off])) + seg(add(p1, [-n[0] * off, -n[1] * off]), add(p2, [-n[0] * off, -n[1] * off]));
      }
    });
    return { svg: out, box: [minx, miny, maxx - minx, maxy - miny] };
  }
  function wrap(r, extra) { return '<svg viewBox="' + r.box.map(function (v) { return v.toFixed(1); }).join(' ') + '" xmlns="http://www.w3.org/2000/svg" ' + (extra || '') + '>' + r.svg + '</svg>'; }

  // fixed mark: same molecule every visit
  Array.prototype.forEach.call(document.querySelectorAll('[data-molecule]'), function (el) {
    var seed = parseInt(el.getAttribute('data-seed') || '7', 10);
    el.innerHTML = wrap(render(randomMolecule(rng(seed)), 30, 12), 'role="img" aria-hidden="true"');
  });

  // band: twelve slots across a 1400x300 canvas, jittered, each with a fresh molecule
  Array.prototype.forEach.call(document.querySelectorAll('.band'), function (el) {
    var R = Math.random, W = 1400, H = 300;
    var slots = [[90, 70], [330, 200], [560, 60], [760, 210], [990, 80], [1240, 190], [200, 260], [460, 120], [880, 40], [1120, 260], [1330, 50], [640, 290]];
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">';
    slots.forEach(function (s, i) {
      var r = render(randomMolecule(R), 18 + R() * 8, 4), cx = r.box[0] + r.box[2] / 2, cy = r.box[1] + r.box[3] / 2;
      var x = s[0] + (R() - 0.5) * 60, y = s[1] + (R() - 0.5) * 40, a = (R() - 0.5) * 70, delay = -(R() * 24).toFixed(1);
      svg += '<g class="m" style="--d:' + delay + 's" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + a.toFixed(1) + ') translate(' + (-cx).toFixed(1) + ' ' + (-cy).toFixed(1) + ')">' + r.svg + '</g>';
    });
    el.innerHTML = svg + '</svg>';
  });
})();
