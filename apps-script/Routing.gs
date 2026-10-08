// Copie de assets/routing.js — à coller tel quel dans un fichier « Routing » du projet Apps Script.
/*
 * Le meilleur du Max by DDX — moteur de recherche de trajets
 * ------------------------------------------------------------
 * Ce fichier ne dépend de rien : il est utilisé par le site (navigateur),
 * par les tests (Node) et par le script des alertes (Google Apps Script).
 *
 * Unités : les horaires sont en minutes depuis minuit du jour choisi.
 * Un train du lendemain a donc des horaires >= 1440.
 */
var Routing = (function () {
  'use strict';

  var DEFAULTS = {
    maxLegs: 5,          // 5 trains = 4 correspondances maximum
    minSameStation: 10,  // minutes minimum pour changer de train dans la même gare
    maxWait: 180,        // 3 h maximum entre l'arrivée d'un train et le départ du suivant
    fromMin: 0,          // premier départ au plus tôt (minutes)
    toMin: 1439,         // premier départ au plus tard (minutes)
    maxDuration: Infinity,
    maxResults: 200000, // garde-fou mémoire (au-delà, la liste est coupée)
    timeBudgetMs: 8000  // garde-fou temps de calcul
  };

  function opt(o) {
    var r = {};
    for (var k in DEFAULTS) r[k] = DEFAULTS[k];
    if (o) for (var j in o) if (o[j] !== undefined && o[j] !== null) r[j] = o[j];
    return r;
  }

  function now() {
    return (typeof Date !== 'undefined') ? Date.now() : 0;
  }

  /**
   * net : contenu de data/stations.json
   *   { stations: [{c, n, k, r}], cities: {k: {members:[i], transfer:min}}, transfers: {"i|j": min} }
   * days : tableau de jours consécutifs, chacun = tableau de [train, o, d, dep, arr]
   *        days[0] = jour choisi, days[1] = lendemain (pour les correspondances de nuit)
   */
  function prepare(net, days) {
    var n = net.stations.length;
    var legsFrom = new Array(n);
    for (var i = 0; i < n; i++) legsFrom[i] = [];
    var all = [];
    for (var di = 0; di < days.length; di++) {
      var rows = days[di] || [];
      var offset = di * 1440;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var leg = { t: row[0], o: row[1], d: row[2], dep: row[3] + offset, arr: row[4] + offset, day: di };
        if (leg.o === leg.d) continue;
        legsFrom[leg.o].push(leg);
        all.push(leg);
      }
    }
    for (var s = 0; s < n; s++) legsFrom[s].sort(function (a, b) { return a.dep - b.dep; });
    return { net: net, legsFrom: legsFrom, all: all };
  }

  function cityOf(net, s) { return net.stations[s].k; }

  /** Temps minimum pour passer de la gare a à la gare b (même ville). Infinity si impossible. */
  function transferTime(net, a, b, o) {
    if (a === b) return o.minSameStation;
    var ka = cityOf(net, a), kb = cityOf(net, b);
    if (ka !== kb) return Infinity;
    var t = net.transfers[a + '|' + b];
    if (t === undefined) t = net.transfers[b + '|' + a];
    if (t === undefined) t = (net.cities[ka] && net.cities[ka].transfer) || 45;
    return t;
  }

  function cityMembers(net, s) {
    var c = net.cities[cityOf(net, s)];
    return c ? c.members : [s];
  }

  /** Première position dans une liste triée par départ où dep >= t */
  function lowerBound(list, t) {
    var lo = 0, hi = list.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid].dep < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /**
   * Nombre minimum de trains pour atteindre une des gares cibles, sans tenir compte des horaires.
   * Sert uniquement à abandonner tôt les pistes sans espoir (le calcul reste exact).
   */
  function minLegsTo(ctx, targets) {
    var net = ctx.net, n = net.stations.length;
    var rev = new Array(n);
    for (var i = 0; i < n; i++) rev[i] = [];
    var seen = {};
    for (var j = 0; j < ctx.all.length; j++) {
      var l = ctx.all[j], key = l.o + '>' + l.d;
      if (seen[key]) continue;
      seen[key] = 1;
      rev[l.d].push(l.o);
    }
    var dist = new Array(n);
    for (var k = 0; k < n; k++) dist[k] = Infinity;
    var queue = [];
    function setCity(s, v) {
      var m = cityMembers(net, s);
      for (var x = 0; x < m.length; x++) if (dist[m[x]] > v) { dist[m[x]] = v; queue.push(m[x]); }
    }
    for (var t = 0; t < targets.length; t++) setCity(targets[t], 0);
    for (var q = 0; q < queue.length; q++) {
      var s = queue[q];
      var preds = rev[s];
      for (var p = 0; p < preds.length; p++) {
        if (dist[preds[p]] > dist[s] + 1) setCity(preds[p], dist[s] + 1);
      }
    }
    return dist;
  }

  /** Construit l'objet "trajet" affiché à partir d'une liste de trains */
  function makeJourney(net, legs, finalTransfer) {
    var steps = [];
    for (var i = 1; i < legs.length; i++) {
      var prev = legs[i - 1], cur = legs[i];
      var type = 'same';
      if (prev.d !== cur.o) type = 'walk';
      else if (prev.t === cur.t) type = 'stay';
      steps.push({
        type: type,
        from: prev.d,
        to: cur.o,
        wait: cur.dep - prev.arr,
        transfer: type === 'walk' ? transferTime(net, prev.d, cur.o, DEFAULTS) : 0
      });
    }
    var dep = legs[0].dep;
    var arr = legs[legs.length - 1].arr + (finalTransfer ? finalTransfer.minutes : 0);
    return {
      legs: legs,
      steps: steps,
      finalTransfer: finalTransfer || null,
      dep: dep,
      arr: arr,
      duration: arr - dep,
      nCorr: legs.length - 1,
      key: legs.map(function (l) { return l.t + ':' + l.o + '-' + l.d + '@' + l.dep; }).join('/')
    };
  }

  function sortJourneys(list) {
    list.sort(function (a, b) {
      return (a.nCorr - b.nCorr) || (a.duration - b.duration) || (a.dep - b.dep);
    });
    return list;
  }

  /**
   * Enlève les doublons : même suite de numéros de train, même départ et même arrivée,
   * mais découpée à des gares différentes. On garde la version avec le moins de trains.
   */
  function dedupe(list) {
    var best = {};
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      var trains = [];
      for (var k = 0; k < j.legs.length; k++) {
        var t = j.legs[k].t;
        if (trains[trains.length - 1] !== t) trains.push(t);
      }
      var sig = trains.join('>') + '|' + j.legs[0].o + '|' + j.dep + '|' + j.arr;
      if (!best[sig] || best[sig].nCorr > j.nCorr) best[sig] = j;
    }
    var out = [];
    for (var s in best) out.push(best[s]);
    return out;
  }

  /**
   * Garde les trajets « intéressants » : on enlève un trajet s'il en existe un autre
   * avec autant ou moins de correspondances, qui part au même moment ou plus tard
   * et arrive au même moment ou plus tôt. La liste d'entrée doit être triée (sortJourneys).
   */
  function pareto(sorted) {
    var SIZE = 4 * 1440 + 2;
    var lowerEq = new Array(SIZE), lowerSuf = new Array(SIZE);
    for (var i = 0; i < SIZE; i++) { lowerEq[i] = Infinity; lowerSuf[i] = Infinity; }
    var out = [];
    var pos = 0;
    while (pos < sorted.length) {
      var k = sorted[pos].nCorr, end = pos;
      while (end < sorted.length && sorted[end].nCorr === k) end++;
      var levEq = new Array(SIZE);
      for (var a = 0; a < SIZE; a++) levEq[a] = lowerEq[a];
      for (var b = pos; b < end; b++) {
        var dj = Math.min(sorted[b].dep, SIZE - 1);
        if (sorted[b].arr < levEq[dj]) levEq[dj] = sorted[b].arr;
      }
      // sufStrict[t] = arrivée la plus tôt parmi les trajets qui partent après t
      var sufStrict = new Array(SIZE + 1);
      sufStrict[SIZE] = Infinity;
      sufStrict[SIZE - 1] = Infinity;
      for (var t = SIZE - 2; t >= 0; t--) sufStrict[t] = Math.min(sufStrict[t + 1], levEq[t + 1]);
      for (var c = pos; c < end; c++) {
        var j = sorted[c], d = Math.min(j.dep, SIZE - 1);
        var dominated = sufStrict[d] <= j.arr || levEq[d] < j.arr || lowerEq[d] <= j.arr;
        if (!dominated) out.push(j);
      }
      for (var e = 0; e < SIZE; e++) lowerEq[e] = levEq[e];
      pos = end;
    }
    return out;
  }

  /**
   * Liste les trains qu'on peut prendre après être arrivé en gare `s` à l'heure `t`
   * (par le train `lastTrain`, ou au départ si lastTrain === null).
   */
  function nextLegs(ctx, s, t, lastTrain, o, first) {
    var net = ctx.net, out = [];
    if (first) {
      var list0 = ctx.legsFrom[s];
      for (var i = lowerBound(list0, o.fromMin); i < list0.length && list0[i].dep <= o.toMin; i++) {
        out.push(list0[i]);
      }
      return out;
    }
    var members = cityMembers(net, s);
    for (var m = 0; m < members.length; m++) {
      var s2 = members[m];
      var minChange = transferTime(net, s, s2, o);
      var list = ctx.legsFrom[s2];
      var from = (s2 === s && lastTrain !== null) ? t : t + minChange;
      for (var k = lowerBound(list, from); k < list.length && list[k].dep <= t + o.maxWait; k++) {
        var l = list[k];
        var stay = (s2 === s && l.t === lastTrain);
        if (!stay && l.dep < t + minChange) continue;
        out.push(l);
      }
    }
    return out;
  }

  /**
   * Module 2 : toutes les combinaisons de A vers B.
   * origins / targets : tableaux d'index de gares (une ville = plusieurs gares).
   */
  function searchAtoB(ctx, origins, targets, options) {
    var o = opt(options);
    var net = ctx.net;
    var start = now();
    var targetSet = {}, targetCity = {};
    for (var i = 0; i < targets.length; i++) { targetSet[targets[i]] = 1; targetCity[cityOf(net, targets[i])] = 1; }
    var originCities = {};
    for (var oi = 0; oi < origins.length; oi++) originCities[cityOf(net, origins[oi])] = 1;
    var dist = minLegsTo(ctx, targets);
    var results = [];
    var truncated = false;

    function record(legs) {
      var last = legs[legs.length - 1];
      var ft = null;
      if (!targetSet[last.d]) {
        // Arrivé dans la bonne ville mais pas à la gare demandée : on ajoute le transfert final
        var bestT = Infinity, bestS = null;
        for (var x = 0; x < targets.length; x++) {
          var tt = transferTime(net, last.d, targets[x], o);
          if (tt < bestT) { bestT = tt; bestS = targets[x]; }
        }
        if (bestS === null || bestT === Infinity) return;
        ft = { from: last.d, to: bestS, minutes: bestT };
      }
      var j = makeJourney(net, legs.slice(), ft);
      if (j.duration > o.maxDuration) return;
      results.push(j);
    }

    function dfs(s, t, legs, usedTrains, usedCities, first) {
      if (truncated) return;
      if (results.length >= o.maxResults || (o.timeBudgetMs && now() - start > o.timeBudgetMs)) {
        truncated = true;
        return;
      }
      var lastTrain = legs.length ? legs[legs.length - 1].t : null;
      var cands = nextLegs(ctx, s, t, lastTrain, o, first);
      for (var c = 0; c < cands.length; c++) {
        var l = cands[c];
        var dk = cityOf(net, l.d);
        if (usedCities[dk]) continue;
        if (usedTrains[l.t] && l.t !== lastTrain) continue;
        if (legs.length + 1 + dist[l.d] > o.maxLegs) continue;
        if (legs.length && l.arr - legs[0].dep > o.maxDuration) continue;
        legs.push(l);
        if (targetCity[dk]) {
          record(legs);
        } else if (legs.length < o.maxLegs) {
          var hadTrain = usedTrains[l.t];
          usedTrains[l.t] = 1;
          usedCities[dk] = 1;
          dfs(l.d, l.arr, legs, usedTrains, usedCities, false);
          usedCities[dk] = 0;
          if (!hadTrain) usedTrains[l.t] = 0;
        }
        legs.pop();
      }
    }

    for (var a = 0; a < origins.length; a++) {
      if (dist[origins[a]] === Infinity) continue;
      var uc = {};
      for (var key in originCities) uc[key] = 1;
      dfs(origins[a], 0, [], {}, uc, true);
    }

    var list = sortJourneys(dedupe(results));
    return { journeys: list, best: pareto(list), truncated: truncated };
  }

  /**
   * Module 1 : depuis une gare, toutes les destinations.
   * Renvoie { direct: {gare: [trains]}, connections: {gare: [trajets]} }
   * Pour les correspondances, on garde par gare d'arrivée les trajets "non battus"
   * (aucun autre trajet ne part plus tard, arrive plus tôt avec autant ou moins de trains).
   */
  function searchFrom(ctx, origins, options) {
    var o = opt(options);
    var net = ctx.net;
    var start = now();
    var originCities = {};
    for (var i = 0; i < origins.length; i++) originCities[cityOf(net, origins[i])] = 1;

    // Trajets directs
    var direct = {};
    for (var a = 0; a < origins.length; a++) {
      var firsts = nextLegs(ctx, origins[a], 0, null, o, true);
      for (var f = 0; f < firsts.length; f++) {
        var l = firsts[f];
        if (originCities[cityOf(net, l.d)]) continue;
        if (l.arr - l.dep > o.maxDuration) continue;
        (direct[l.d] = direct[l.d] || []).push(makeJourney(net, [l], null));
      }
    }
    for (var d in direct) sortJourneys(direct[d]);

    // Correspondances : exploration par "vagues" (1 train, puis 2, puis 3...)
    var labels = {}; // gare -> liste de trajets non battus
    function dominated(list, j) {
      for (var x = 0; x < list.length; x++) {
        var b = list[x];
        if (b.nCorr <= j.nCorr && b.dep >= j.dep && b.arr <= j.arr) return true;
      }
      return false;
    }
    function insert(s, j) {
      var list = labels[s] || (labels[s] = []);
      if (dominated(list, j)) return false;
      labels[s] = list.filter(function (b) {
        return !(j.nCorr <= b.nCorr && j.dep >= b.dep && j.arr <= b.arr);
      });
      labels[s].push(j);
      return true;
    }

    var frontier = [];
    for (var b = 0; b < origins.length; b++) {
      var fl = nextLegs(ctx, origins[b], 0, null, o, true);
      for (var g = 0; g < fl.length; g++) {
        var leg = fl[g];
        if (originCities[cityOf(net, leg.d)]) continue;
        var j1 = makeJourney(net, [leg], null);
        if (j1.duration > o.maxDuration) continue;
        if (insert(leg.d, j1)) frontier.push(j1);
      }
    }
    var truncated = false;
    for (var round = 2; round <= o.maxLegs && frontier.length; round++) {
      var next = [];
      for (var q = 0; q < frontier.length; q++) {
        if (o.timeBudgetMs && now() - start > o.timeBudgetMs) { truncated = true; break; }
        var jr = frontier[q];
        var last = jr.legs[jr.legs.length - 1];
        var usedC = {}, usedT = {};
        for (var oc in originCities) usedC[oc] = 1;
        for (var u = 0; u < jr.legs.length; u++) { usedC[cityOf(net, jr.legs[u].d)] = 1; usedT[jr.legs[u].t] = 1; }
        var cands = nextLegs(ctx, last.d, last.arr, last.t, o, false);
        for (var c = 0; c < cands.length; c++) {
          var nl = cands[c];
          var dk = cityOf(net, nl.d);
          if (usedC[dk]) continue;
          if (usedT[nl.t] && nl.t !== last.t) continue;
          if (nl.arr - jr.dep > o.maxDuration) continue;
          var nj = makeJourney(net, jr.legs.concat([nl]), null);
          if (insert(nl.d, nj)) next.push(nj);
        }
      }
      frontier = next;
      if (truncated) break;
    }

    var connections = {};
    for (var s in labels) {
      var withCorr = labels[s].filter(function (j) { return j.nCorr > 0; });
      if (withCorr.length) connections[s] = sortJourneys(withCorr);
    }
    return { direct: direct, connections: connections, truncated: truncated };
  }

  return {
    DEFAULTS: DEFAULTS,
    pareto: pareto,
    prepare: prepare,
    searchAtoB: searchAtoB,
    searchFrom: searchFrom,
    transferTime: function (net, a, b) { return transferTime(net, a, b, DEFAULTS); }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Routing;
