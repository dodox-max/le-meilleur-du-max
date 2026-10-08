/* Le meilleur du Max by DDX — interface du site */
(function () {
  'use strict';

  var CONFIG = window.MAX_CONFIG || {};
  var PAGE = 20;
  var state = { meta: null, net: null, days: {}, options: [], byCode: {}, loadError: null };

  // ---------------------------------------------------------------- outils
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[-'’()]/g, ' ').replace(/\bst\b/g, 'saint').replace(/\s+/g, ' ').trim();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(m) { return pad(Math.floor((m % 1440) / 60)) + ':' + pad(m % 60); }
  function nextDayTag(m) { return m >= 1440 ? '<small class="j-day"> le lendemain</small>' : ''; }
  function fmtDur(m) {
    var h = Math.floor(m / 60), mn = m % 60;
    if (!h) return mn + ' min';
    return h + ' h' + (mn ? ' ' + pad(mn) : '');
  }
  function toMin(v, def) {
    var m = /^(\d{1,2}):(\d{2})/.exec(v || '');
    return m ? (+m[1] * 60 + +m[2]) : def;
  }
  function parisToday() {
    var p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return p.slice(0, 10);
  }
  function addDays(d, n) {
    var x = new Date(d + 'T12:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }
  function fmtDate(d, long) {
    var x = new Date(d + 'T12:00:00Z');
    return x.toLocaleDateString('fr-FR', long
      ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
      : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function st(i) { return state.net.stations[i]; }
  function cityName(i) {
    var s = st(i), c = state.net.cities[s.k];
    return c ? c.name : s.n;
  }

  // ---------------------------------------------------------------- données
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadBase() {
    return getJSON('data/meta.json?t=' + Date.now()).then(function (meta) {
      state.meta = meta;
      return getJSON('data/stations.json?v=' + meta.stamp);
    }).then(function (net) {
      state.net = net;
      buildOptions();
      showFreshness();
      setupDates();
      fillRegions();
    }).catch(function (e) {
      state.loadError = e;
      $('fresh').textContent = 'Données indisponibles pour le moment';
    });
  }

  function loadDay(d) {
    if (state.days[d]) return state.days[d];
    if (state.meta.days.indexOf(d) === -1) { state.days[d] = Promise.resolve([]); return state.days[d]; }
    state.days[d] = getJSON('data/days/' + d + '.json?v=' + state.meta.stamp)
      .then(function (x) { return x.rows; })
      .catch(function (e) { delete state.days[d]; throw e; });
    return state.days[d];
  }

  function contextFor(d) {
    return Promise.all([loadDay(d), loadDay(addDays(d, 1))]).then(function (two) {
      return Routing.prepare(state.net, two);
    });
  }

  function showFreshness() {
    var m = state.meta, raw = m.sourceUpdatedAt, d = new Date(raw);
    if (!raw || isNaN(d)) d = new Date(m.fetchedAt);
    var txt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }) +
      ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ');
    $('fresh').innerHTML = 'Places SNCF mises à jour le <strong>' + esc(txt) + '</strong>';
  }

  // ---------------------------------------------------------------- autocomplétion
  function buildOptions() {
    var net = state.net, opts = [];
    Object.keys(net.cities).forEach(function (k) {
      var c = net.cities[k];
      opts.push({ label: c.name, sub: 'toutes les gares', ids: c.members.slice(), city: true });
    });
    net.stations.forEach(function (s, i) {
      state.byCode[s.c] = i;
      opts.push({ label: s.n, sub: s.r === 'Autre' ? '' : s.r, ids: [i] });
    });
    opts.forEach(function (o) { o.key = norm(o.label); });
    opts.sort(function (a, b) { return a.label.localeCompare(b.label, 'fr'); });
    state.options = opts;
  }

  function findOptions(q) {
    var n = norm(q);
    if (!n) return [];
    var scored = [];
    state.options.forEach(function (o) {
      var s = -1;
      if (o.key.indexOf(n) === 0) s = o.city ? 0 : 1;
      else if ((' ' + o.key).indexOf(' ' + n) !== -1) s = 2;
      else if (o.key.indexOf(n) !== -1) s = 3;
      if (s >= 0) scored.push({ o: o, s: s });
    });
    scored.sort(function (a, b) { return a.s - b.s || a.o.label.length - b.o.label.length; });
    return scored.slice(0, 8).map(function (x) { return x.o; });
  }

  var combos = {};
  function Combo(id) {
    var input = $(id), box = input.parentNode, list = null, items = [], active = -1;
    var self = { value: null, input: input };
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', id + '-list');

    function close() {
      if (list) { list.remove(); list = null; }
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function choose(o) {
      self.value = o;
      input.value = o.label + (o.city ? ' (toutes les gares)' : '');
      input.setCustomValidity('');
      close();
    }
    function highlight(label, q) {
      var n = norm(q), k = norm(label), i = k.indexOf(n);
      if (i < 0 || n.length !== q.trim().length) return esc(label);
      return esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + n.length)) + '</mark>' + esc(label.slice(i + n.length));
    }
    function render() {
      if (!state.net) return;
      var q = input.value;
      items = findOptions(q);
      if (!list) {
        list = document.createElement('ul');
        list.id = id + '-list';
        list.setAttribute('role', 'listbox');
        box.appendChild(list);
        input.setAttribute('aria-expanded', 'true');
      }
      if (!items.length) {
        list.innerHTML = '<li class="none">Aucune gare ne correspond. Essayez le nom de la ville.</li>';
        return;
      }
      list.innerHTML = items.map(function (o, i) {
        return '<li role="option" id="' + id + '-o' + i + '" aria-selected="' + (i === active) + '" data-i="' + i + '">' +
          '<span>' + highlight(o.label, q) + '</span><small>' + esc(o.sub) + '</small></li>';
      }).join('');
    }
    input.addEventListener('input', function () {
      self.value = null;
      active = -1;
      if (input.value.trim().length >= 1) render(); else close();
    });
    input.addEventListener('focus', function () { if (input.value && !self.value) render(); });
    input.addEventListener('keydown', function (e) {
      if (!list || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        render();
        input.setAttribute('aria-activedescendant', id + '-o' + active);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(items[active >= 0 ? active : 0]);
      } else if (e.key === 'Escape') {
        close();
      }
    });
    box.addEventListener('mousedown', function (e) {
      var li = e.target.closest('li[data-i]');
      if (li) { e.preventDefault(); choose(items[+li.dataset.i]); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });

    /** Valeur choisie, ou meilleure correspondance du texte tapé */
    self.get = function () {
      if (self.value) return self.value;
      var found = findOptions(input.value.replace(/\(toutes les gares\)/, ''));
      if (found.length) { choose(found[0]); return found[0]; }
      input.setCustomValidity('Choisissez une gare dans la liste');
      input.reportValidity();
      return null;
    };
    self.set = function (o) { if (o) choose(o); };
    combos[id] = self;
    return self;
  }

  // ---------------------------------------------------------------- onglets
  function setupTabs() {
    var tabs = [].slice.call(document.querySelectorAll('.tabs [role="tab"]'));
    function select(t) {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute('aria-selected', on);
        x.tabIndex = on ? 0 : -1;
        $(x.getAttribute('aria-controls')).hidden = !on;
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        select(n); n.focus();
      });
    });
    return function (id) { select($(id)); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  }

  // ---------------------------------------------------------------- dates
  function setupDates() {
    var days = state.meta.days, first = days[0], last = days[days.length - 1];
    var today = parisToday();
    var def = days.indexOf(today) !== -1 ? today : first;
    ['ex-d1', 'ex-d2', 'rt-date', 'al-date'].forEach(function (id) {
      var el = $(id);
      el.min = first > today ? today : first;
      el.max = last;
      if (!el.value) el.value = def;
    });
    $('al-date').min = today;
    $('ex-d2').value = addDays(def, 1) <= last ? addDays(def, 1) : def;

    function chips(container, defs, onPick) {
      container.innerHTML = '';
      defs.forEach(function (d) {
        if (d.from > last) return;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'chip'; b.textContent = d.label;
        b.addEventListener('click', function () { onPick(d); });
        container.appendChild(b);
      });
    }
    var dow = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 = dimanche
    var sat = addDays(today, dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow);
    var sun = addDays(sat, 1);
    var satStart = sat < today ? today : sat;
    chips($('ex-quick'), [
      { label: "Aujourd'hui", from: today, to: today },
      { label: 'Demain', from: addDays(today, 1), to: addDays(today, 1) },
      { label: 'Ce week-end', from: satStart, to: sun },
      { label: 'Les 7 prochains jours', from: today, to: addDays(today, 6) }
    ], function (d) {
      var range = d.from !== d.to;
      document.querySelector('input[name="ex-mode"][value="' + (range ? 'range' : 'day') + '"]').checked = true;
      syncMode();
      $('ex-d1').value = d.from;
      $('ex-d2').value = d.to > last ? last : d.to;
    });
    chips($('rt-quick'), [
      { label: "Aujourd'hui", from: today },
      { label: 'Demain', from: addDays(today, 1) },
      { label: 'Samedi', from: satStart },
      { label: 'Dimanche', from: sun }
    ], function (d) { $('rt-date').value = d.from; });
  }

  function syncMode() {
    var range = document.querySelector('input[name="ex-mode"]:checked').value === 'range';
    $('ex-d2-wrap').hidden = !range;
    $('ex-d1-label').textContent = range ? 'Du' : 'Le';
    $('ex-d2').required = range;
  }

  function fillRegions() {
    var seen = {};
    state.net.stations.forEach(function (s) { seen[s.r] = 1; });
    var sel = $('ex-region');
    Object.keys(seen).sort(function (a, b) {
      if (a === 'Autre' || a === 'Étranger') return 1;
      if (b === 'Autre' || b === 'Étranger') return -1;
      return a.localeCompare(b, 'fr');
    }).forEach(function (r) {
      var o = document.createElement('option');
      o.value = r; o.textContent = r === 'Autre' ? 'Autres gares' : r;
      sel.appendChild(o);
    });
  }

  // ---------------------------------------------------------------- états
  function loading(el, text) {
    el.innerHTML = '<div class="loader"><div class="track"></div>' + esc(text) + '</div>';
  }
  var ICON_EMPTY = '<svg class="state-ico" viewBox="0 0 56 56" aria-hidden="true"><rect x="10" y="8" width="36" height="34" rx="8" fill="#DDE4F7"/><rect x="16" y="14" width="24" height="12" rx="3" fill="#fff"/><circle cx="19" cy="34" r="3" fill="#3A5BFF"/><circle cx="37" cy="34" r="3" fill="#3A5BFF"/><path d="M14 48l6-6M42 48l-6-6" stroke="#1B1F3B" stroke-width="3" stroke-linecap="round"/></svg>';
  var ICON_ERR = '<svg class="state-ico" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="22" fill="#FFE1E6"/><path d="M28 16v15" stroke="#F2475E" stroke-width="5" stroke-linecap="round"/><circle cx="28" cy="39" r="3.2" fill="#F2475E"/></svg>';
  function empty(el, title, text, actions) {
    el.innerHTML = '<div class="state">' + ICON_EMPTY + '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="state-actions"></div></div>';
    var box = el.querySelector('.state-actions');
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'go' + (a.secondary ? ' secondary' : ''); b.textContent = a.label;
      b.style.margin = '4px';
      b.addEventListener('click', a.run);
      box.appendChild(b);
    });
  }
  function error(el, retry) {
    el.innerHTML = '<div class="state error">' + ICON_ERR + '<h3>Les données des trains n\'ont pas pu être chargées</h3>' +
      '<p>Vérifiez votre connexion internet puis réessayez. Si le problème continue, les données SNCF sont peut-être en cours de mise à jour.</p>' +
      '<button type="button" class="go">Réessayer</button></div>';
    el.querySelector('button').addEventListener('click', retry);
  }
  function ready(el, retry) {
    if (state.net) return true;
    error(el, function () { state.loadError = null; loadBase().then(retry); });
    return false;
  }

  // ---------------------------------------------------------------- affichage d'un trajet
  function journeyHTML(j, opts) {
    opts = opts || {};
    var h = '<article class="journey"><div class="j-head">' +
      '<span class="j-times">' + fmtTime(j.dep) + ' → ' + fmtTime(j.arr) + '</span>' +
      (opts.date ? '<span class="pill">' + esc(fmtDate(opts.date)) + '</span>' : '') +
      '<span class="pill">' + fmtDur(j.duration) + '</span>' +
      (j.nCorr === 0 ? '<span class="pill direct">Direct</span>'
        : '<span class="pill corr">' + plural(j.nCorr, 'correspondance', 'correspondances') + '</span>') +
      '</div><ol class="line">';
    j.legs.forEach(function (l, i) {
      if (i > 0) h += gapHTML(j.steps[i - 1], l);
      var c = 'var(--seg-' + ((i % 5) + 1) + ')';
      h += '<li class="leg" style="--c:' + c + '">' +
        '<div class="stop"><time>' + fmtTime(l.dep) + '</time><span class="st">' + esc(st(l.o).n) + nextDayTag(l.dep) + '</span></div>' +
        '<p class="train-no">Train n° <b>' + esc(l.t) + '</b>, ' + fmtDur(l.arr - l.dep) + '</p>' +
        '<div class="stop"><time>' + fmtTime(l.arr) + '</time><span class="st">' + esc(st(l.d).n) + nextDayTag(l.arr) + '</span></div>' +
        '</li>';
    });
    if (j.finalTransfer) {
      h += '<li class="gap walk"><b>Changement de gare :</b> rejoignez ' + esc(st(j.finalTransfer.to).n) +
        ', comptez environ ' + fmtDur(j.finalTransfer.minutes) + ' en transports en commun.</li>';
    }
    h += '</ol>';
    if (j.nCorr > 0) h += '<p class="j-total">Durée totale <b>' + fmtDur(j.duration) + '</b>, ' + plural(j.legs.length, 'réservation', 'réservations') + ' MAX à faire.</p>';
    return h + '</article>';
  }

  function gapHTML(s, next) {
    if (s.type === 'walk') {
      return '<li class="gap walk"><b>Changement de gare :</b> ' + esc(st(s.from).n) + ' → ' + esc(st(s.to).n) +
        '. Comptez environ ' + fmtDur(s.transfer) + ' en transports en commun (' + fmtDur(s.wait) + ' entre les deux trains).</li>';
    }
    if (s.type === 'stay') {
      return '<li class="gap"><b>Restez à bord</b> du train n° ' + esc(next.t) + ' : la suite du trajet est une 2e réservation à 0 €' +
        (s.wait > 0 ? ' (arrêt de ' + fmtDur(s.wait) + ')' : '') + '.</li>';
    }
    return '<li class="gap"><b>Correspondance :</b> ' + fmtDur(s.wait) + ' à ' + esc(st(s.from).n) + '.</li>';
  }

  // ---------------------------------------------------------------- module 1
  var explore = { data: null, tab: 'direct', sort: 'fast' };

  function runExplore(e) {
    if (e) e.preventDefault();
    var out = $('ex-results');
    if (!ready(out, runExplore)) return;
    var from = combos['ex-from'].get();
    if (!from) return;
    var range = document.querySelector('input[name="ex-mode"]:checked').value === 'range';
    var d1 = $('ex-d1').value, d2 = range ? $('ex-d2').value : d1;
    if (!d1) return;
    if (d2 < d1) { var t = d1; d1 = d2; d2 = t; }
    var dates = [];
    for (var d = d1; d <= d2 && dates.length < 31; d = addDays(d, 1)) dates.push(d);
    var opts = {
      fromMin: toMin($('ex-t1').value, 0),
      toMin: toMin($('ex-t2').value, 1439),
      maxDuration: +$('ex-dur').value || Infinity
    };
    var region = $('ex-region').value;
    loading(out, 'Recherche des trains à 0 €…');
    var dests = {}, truncated = false;
    function add(kind, s, date, j) {
      var key = st(s).k;
      var reg = st(s).r;
      if (region && reg !== region) return;
      var D = dests[key] || (dests[key] = { key: key, name: cityName(s), region: reg, direct: [], conn: [], ids: cityIdsOf(s) });
      D[kind].push({ date: date, j: j });
    }
    var chain = Promise.resolve();
    dates.forEach(function (date) {
      chain = chain.then(function () { return contextFor(date); }).then(function (ctx) {
        return new Promise(function (res) {
          setTimeout(function () {
            var r = Routing.searchFrom(ctx, from.ids, opts);
            truncated = truncated || r.truncated;
            Object.keys(r.direct).forEach(function (s) { r.direct[s].forEach(function (j) { add('direct', +s, date, j); }); });
            Object.keys(r.connections).forEach(function (s) { r.connections[s].forEach(function (j) { add('conn', +s, date, j); }); });
            res();
          }, 20);
        });
      });
    });
    chain.then(function () {
      explore.data = { from: from, dates: dates, dests: dests, truncated: truncated };
      explore.tab = 'direct';
      renderExplore();
    }).catch(function () { error(out, runExplore); });
  }

  function cityIdsOf(s) {
    var c = state.net.cities[st(s).k];
    return c ? c.members.slice() : [s];
  }

  function renderExplore() {
    var out = $('ex-results'), X = explore.data;
    var all = Object.keys(X.dests).map(function (k) { return X.dests[k]; });
    var direct = all.filter(function (d) { return d.direct.length; });
    var conn = all.filter(function (d) { return d.conn.length; });
    var when = X.dates.length > 1 ? 'du ' + fmtDate(X.dates[0]) + ' au ' + fmtDate(X.dates[X.dates.length - 1]) : fmtDate(X.dates[0], true);

    if (!direct.length && !conn.length) {
      empty(out, 'Aucune destination à 0 € trouvée', 'Aucun train MAX disponible depuis ' + X.from.label + ' ' + when +
        ' avec ces filtres. Essayez une autre date, élargissez les horaires ou retirez le filtre de région.');
      return;
    }
    var list = explore.tab === 'direct' ? direct : conn;
    var kind = explore.tab === 'direct' ? 'direct' : 'conn';
    list.forEach(function (d) {
      var items = d[kind];
      d._best = Math.min.apply(null, items.map(function (x) { return x.j.duration; }));
      d._n = items.length;
    });
    list.sort(function (a, b) {
      if (explore.sort === 'name') return a.name.localeCompare(b.name, 'fr');
      if (explore.sort === 'count') return b._n - a._n || a._best - b._best;
      return a._best - b._best || a.name.localeCompare(b.name, 'fr');
    });

    var h = '<div class="res-head"><h2 class="res-title">Au départ de ' + esc(X.from.label) + '</h2>' +
      '<p class="res-sub">' + esc(when) + '</p></div>' +
      '<div class="subtabs" role="tablist">' +
      '<button role="tab" data-t="direct" aria-selected="' + (kind === 'direct') + '">Trajets directs<span class="count">' + direct.length + '</span></button>' +
      '<button role="tab" data-t="conn" aria-selected="' + (kind === 'conn') + '">Avec correspondances<span class="count">' + conn.length + '</span></button>' +
      '</div>';
    if (!list.length) {
      h += '<div class="state"><h3>' + (kind === 'direct' ? 'Aucun trajet direct' : 'Aucune destination de plus avec correspondances') + '</h3><p>' +
        (kind === 'direct' ? 'Regardez l\'onglet « Avec correspondances ».' : 'Toutes les destinations sont déjà accessibles en direct, ou rien d\'autre n\'est disponible.') + '</p></div>';
      out.innerHTML = h;
      bindExploreTabs(out);
      return;
    }
    h += '<div class="toolbar"><span class="res-sub">' + plural(list.length, 'destination', 'destinations') +
      (kind === 'conn' ? ', jusqu\'à 4 correspondances' : '') + '</span>' +
      '<label><span class="sr">Trier </span><select id="ex-sort" aria-label="Trier les destinations">' +
      '<option value="fast"' + (explore.sort === 'fast' ? ' selected' : '') + '>Les plus rapides</option>' +
      '<option value="name"' + (explore.sort === 'name' ? ' selected' : '') + '>Par nom</option>' +
      '<option value="count"' + (explore.sort === 'count' ? ' selected' : '') + '>Le plus de trains</option>' +
      '</select></label></div><div class="dest-list">';
    list.forEach(function (d, i) {
      var items = d[kind];
      var chips;
      if (X.dates.length > 1) {
        var days = {};
        items.forEach(function (x) { days[x.date] = 1; });
        chips = Object.keys(days).sort().map(function (dd) { return '<span>' + esc(fmtDate(dd)) + '</span>'; });
      } else {
        var times = {};
        items.forEach(function (x) { times[x.j.dep] = 1; });
        chips = Object.keys(times).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { return '<span>' + fmtTime(t) + '</span>'; });
      }
      if (chips.length > 8) chips = chips.slice(0, 8).concat(['<span>+' + (chips.length - 8) + '</span>']);
      h += '<div class="dest"><button type="button" aria-expanded="false" data-i="' + i + '">' +
        '<span class="dest-name">' + esc(d.name) + '</span>' +
        '<span class="dest-best"><b>' + fmtDur(d._best) + '</b><span>' + plural(items.length, 'option', 'options') + '</span></span>' +
        '<span class="dest-region">' + esc(d.region === 'Autre' ? '' : d.region) + '</span>' +
        '<span class="times">' + chips.join('') + '</span></button><div class="dest-body" hidden></div></div>';
    });
    h += '</div>';
    if (X.truncated) h += '<p class="res-sub">La recherche a été écourtée pour rester rapide : quelques trajets avec beaucoup de correspondances peuvent manquer.</p>';
    out.innerHTML = h;
    bindExploreTabs(out);
    $('ex-sort').addEventListener('change', function () { explore.sort = this.value; renderExplore(); });
    out.querySelectorAll('.dest > button').forEach(function (b) {
      b.addEventListener('click', function () {
        var body = b.nextElementSibling, open = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', !open);
        body.hidden = open;
        if (!open && !body.dataset.done) { fillDest(body, list[+b.dataset.i], kind); body.dataset.done = 1; }
      });
    });
  }

  function bindExploreTabs(out) {
    out.querySelectorAll('.subtabs button').forEach(function (b) {
      b.addEventListener('click', function () { explore.tab = b.dataset.t; renderExplore(); });
    });
  }

  function fillDest(body, d, kind) {
    var X = explore.data;
    var items = d[kind].slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.j.dep - b.j.dep;
    });
    var shown = 0;
    var box = document.createElement('div');
    box.className = 'journeys';
    body.appendChild(box);
    var more = document.createElement('button');
    more.type = 'button'; more.className = 'link-btn';
    function page() {
      var html = '';
      items.slice(shown, shown + 6).forEach(function (x) {
        html += journeyHTML(x.j, { date: X.dates.length > 1 ? x.date : null });
      });
      box.insertAdjacentHTML('beforeend', html);
      shown += 6;
      more.hidden = shown >= items.length;
      more.textContent = 'Afficher ' + Math.min(6, items.length - shown) + ' trajets de plus';
    }
    more.addEventListener('click', page);
    body.appendChild(more);
    page();
    var go = document.createElement('button');
    go.type = 'button'; go.className = 'link-btn';
    go.textContent = 'Toutes les combinaisons vers ' + d.name;
    go.addEventListener('click', function () {
      combos['rt-from'].set(X.from);
      combos['rt-to'].set(optionFor(d.ids));
      $('rt-date').value = X.dates[0];
      $('rt-t1').value = $('ex-t1').value;
      $('rt-t2').value = $('ex-t2').value;
      selectTab('tab-route');
      runRoute();
    });
    body.appendChild(go);
  }

  function optionFor(ids) {
    for (var i = 0; i < state.options.length; i++) {
      var o = state.options[i];
      if (o.ids.length === ids.length && o.ids.every(function (x, k) { return x === ids[k]; })) return o;
    }
    return { label: st(ids[0]).n, ids: ids };
  }

  // ---------------------------------------------------------------- module 2
  var route = { res: null, view: 'best', shown: PAGE };

  function runRoute(e) {
    if (e) e.preventDefault();
    var out = $('rt-results');
    if (!ready(out, runRoute)) return;
    var A = combos['rt-from'].get(); if (!A) return;
    var B = combos['rt-to'].get(); if (!B) return;
    var date = $('rt-date').value;
    if (!date) return;
    if (A.ids.some(function (x) { return B.ids.indexOf(x) !== -1; }) || st(A.ids[0]).k === st(B.ids[0]).k) {
      empty(out, 'Départ et arrivée sont dans la même ville', 'Choisissez deux villes différentes.');
      return;
    }
    loading(out, 'Calcul de toutes les combinaisons…');
    contextFor(date).then(function (ctx) {
      setTimeout(function () {
        var r = Routing.searchAtoB(ctx, A.ids, B.ids, {
          fromMin: toMin($('rt-t1').value, 0),
          toMin: toMin($('rt-t2').value, 1439)
        });
        route.res = { A: A, B: B, date: date, r: r };
        route.view = 'best';
        route.shown = PAGE;
        renderRoute();
      }, 20);
    }).catch(function () { error(out, runRoute); });
  }

  function renderRoute() {
    var out = $('rt-results'), R = route.res, r = R.r;
    var title = '<div class="res-head"><h2 class="res-title">' + esc(R.A.label) + ' → ' + esc(R.B.label) + '</h2>' +
      '<p class="res-sub">' + esc(fmtDate(R.date, true)) + '</p></div>';
    if (!r.journeys.length) {
      empty(out, 'Aucun train à 0 € pour ce trajet ce jour-là',
        'Même en combinant jusqu\'à 5 trains (4 correspondances de 3 h maximum), aucune solution n\'est disponible. Essayez une autre date, ou créez une alerte pour être prévenu si une place se libère.',
        [
          { label: 'Essayer le lendemain', run: function () { $('rt-date').value = addDays(R.date, 1); runRoute(); } },
          { label: 'Créer une alerte', secondary: true, run: function () { prefillAlert(R.A, R.B, R.date); } }
        ]);
      out.insertAdjacentHTML('afterbegin', title);
      return;
    }
    var list = route.view === 'best' ? r.best : r.journeys;
    var h = title +
      '<div class="subtabs" role="tablist">' +
      '<button role="tab" data-v="best" aria-selected="' + (route.view === 'best') + '">Conseillés<span class="count">' + r.best.length + '</span></button>' +
      '<button role="tab" data-v="all" aria-selected="' + (route.view === 'all') + '">Toutes<span class="count">' + r.journeys.length.toLocaleString('fr-FR') + '</span></button>' +
      '</div><p class="res-sub" style="margin:0 4px 12px">' +
      (route.view === 'best'
        ? 'Les trajets les plus pratiques, triés par nombre de correspondances puis par durée. Les autres combinaisons (partir plus tôt pour arriver plus tard, plus de changements…) sont dans l\'onglet « Toutes ».'
        : 'Toutes les combinaisons possibles, triées par nombre de correspondances puis par durée.') +
      (r.truncated ? ' La recherche a été écourtée pour rester rapide : certaines combinaisons très longues peuvent manquer.' : '') +
      '</p><div class="journeys">';
    list.slice(0, route.shown).forEach(function (j) { h += journeyHTML(j); });
    h += '</div>';
    if (list.length > route.shown) {
      h += '<div class="more-results"><button type="button" class="go secondary" id="rt-more">Afficher ' +
        Math.min(PAGE, list.length - route.shown) + ' trajets de plus</button></div>';
    }
    out.innerHTML = h;
    out.querySelectorAll('.subtabs button').forEach(function (b) {
      b.addEventListener('click', function () { route.view = b.dataset.v; route.shown = PAGE; renderRoute(); });
    });
    var more = $('rt-more');
    if (more) more.addEventListener('click', function () { route.shown += PAGE; renderRoute(); });
  }

  // ---------------------------------------------------------------- alertes
  function alertsOn() { return !!(CONFIG.alertsUrl && /^https:\/\//.test(CONFIG.alertsUrl)); }

  function callAlerts(payload) {
    return fetch(CONFIG.alertsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function prefillAlert(A, B, date) {
    combos['al-from'].set(A);
    combos['al-to'].set(B);
    $('al-date').value = date;
    selectTab('tab-alerts');
    $('al-email').focus();
  }

  function msg(el, text, ok) {
    el.textContent = text;
    el.className = 'form-msg ' + (ok ? 'ok' : 'err');
  }

  function createAlert(e) {
    e.preventDefault();
    var m = $('al-msg');
    if (!alertsOn()) { msg(m, 'Les alertes ne sont pas encore activées sur ce site.', false); return; }
    if (!state.net) { msg(m, 'Les données des trains ne sont pas chargées, réessayez dans un instant.', false); return; }
    var A = combos['al-from'].get(); if (!A) return;
    var B = combos['al-to'].get(); if (!B) return;
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg(m, 'Création de l\'alerte…', true);
    callAlerts({
      action: 'create',
      from: A.ids.map(function (i) { return st(i).c; }), fromLabel: A.label,
      to: B.ids.map(function (i) { return st(i).c; }), toLabel: B.label,
      date: $('al-date').value,
      fromMin: toMin($('al-t1').value, 0), toMin: toMin($('al-t2').value, 1439),
      connections: $('al-corr').checked,
      email: $('al-email').value.trim()
    }).then(function (r) {
      if (r.ok) msg(m, 'Alerte créée. Un email de confirmation vient de partir (pensez à regarder dans les spams).', true);
      else msg(m, r.error || 'L\'alerte n\'a pas pu être créée.', false);
    }).catch(function () {
      msg(m, 'Le service d\'alertes ne répond pas. Vérifiez votre connexion et réessayez.', false);
    }).then(function () { btn.disabled = false; });
  }

  function listAlerts(e) {
    e.preventDefault();
    var m = $('al-list-msg');
    if (!alertsOn()) { msg(m, 'Les alertes ne sont pas encore activées sur ce site.', false); return; }
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    callAlerts({ action: 'list', email: $('al-list-email').value.trim() }).then(function (r) {
      if (r.ok) msg(m, 'Si des alertes existent pour cette adresse, un email avec les liens de suppression vient de partir.', true);
      else msg(m, r.error || 'La demande n\'a pas abouti.', false);
    }).catch(function () {
      msg(m, 'Le service d\'alertes ne répond pas. Vérifiez votre connexion et réessayez.', false);
    }).then(function () { btn.disabled = false; });
  }

  // ---------------------------------------------------------------- démarrage
  var selectTab = setupTabs();
  ['ex-from', 'rt-from', 'rt-to', 'al-from', 'al-to'].forEach(Combo);
  document.querySelectorAll('input[name="ex-mode"]').forEach(function (r) { r.addEventListener('change', syncMode); });
  $('form-explore').addEventListener('submit', runExplore);
  $('form-route').addEventListener('submit', runRoute);
  $('form-alert').addEventListener('submit', createAlert);
  $('form-alert-list').addEventListener('submit', listAlerts);
  $('rt-swap').addEventListener('click', function () {
    var a = combos['rt-from'], b = combos['rt-to'];
    var va = a.value, vb = b.value, ta = a.input.value, tb = b.input.value;
    a.value = vb; b.value = va; a.input.value = tb; b.input.value = ta;
  });
  if (!alertsOn()) $('al-off').hidden = false;
  loadBase();
})();
