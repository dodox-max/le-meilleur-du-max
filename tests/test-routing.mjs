// Tests du moteur de correspondances.
//   node tests/test-routing.mjs          → tests sur les données présentes dans data/
// Partie 1 : règles (réseau d'exemple construit à la main).
// Partie 2 : trajets réels à partir des données SNCF de data/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Routing = require('../assets/routing.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}
const hhmm = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${m >= 1440 ? ' (J+1)' : ''}`;
const dur = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

function describe(net, j) {
  const parts = [];
  j.legs.forEach((l, i) => {
    if (i > 0) {
      const s = j.steps[i - 1];
      if (s.type === 'walk') parts.push(`  ↳ changement de gare ${net.stations[s.from].n} → ${net.stations[s.to].n} (${s.transfer} min de trajet, ${s.wait} min au total)`);
      else if (s.type === 'stay') parts.push(`  ↳ on reste dans le train n°${l.t} (nouvelle réservation)`);
      else parts.push(`  ↳ correspondance de ${s.wait} min`);
    }
    parts.push(`  ${hhmm(l.dep)} ${net.stations[l.o].n} → ${hhmm(l.arr)} ${net.stations[l.d].n}  [train ${l.t}]`);
  });
  if (j.finalTransfer) parts.push(`  ↳ transfert final vers ${net.stations[j.finalTransfer.to].n} (${j.finalTransfer.minutes} min)`);
  return `${j.nCorr} correspondance(s), durée ${dur(j.duration)}\n${parts.join('\n')}`;
}

// ---------------------------------------------------------------
console.log('\n=== Partie 1 : règles de correspondance (réseau d\'exemple) ===');
{
  const S = ['Paris Gare de Lyon', 'Paris Montparnasse', 'Lyon Part-Dieu', 'Bordeaux St Jean', 'Toulouse', 'Agen', 'Montauban', 'Narbonne', 'Perpignan', 'Béziers'];
  const net = {
    stations: S.map((n, i) => ({ c: 'X' + i, n, k: i < 2 ? 'PARIS' : '#' + i, r: '' })),
    cities: { PARIS: { members: [0, 1], transfer: 60 } },
    transfers: { '0|1': 45 },
  };
  const h = (s) => { const [a, b] = s.split(':'); return +a * 60 + +b; };
  const rows = [
    ['A1', 2, 0, h('07:00'), h('09:00')],   // Lyon → Paris GdL
    ['B1', 1, 3, h('10:00'), h('12:10')],   // Paris Montparnasse → Bordeaux (60 min après : ok avec 45 min de transfert)
    ['B2', 1, 3, h('09:30'), h('11:40')],   // trop tôt : 30 min < 45 min de transfert
    ['C1', 3, 4, h('12:20'), h('14:30')],   // Bordeaux → Toulouse : 10 min de correspondance (ok)
    ['C2', 3, 4, h('12:15'), h('14:20')],   // 5 min : trop court
    ['C3', 3, 4, h('15:20'), h('17:30')],   // 3h10 d'attente : trop long
    ['D1', 4, 9, h('15:00'), h('16:30')],   // Toulouse → Béziers
    ['E1', 9, 7, h('17:00'), h('17:30')],   // Béziers → Narbonne
    ['F1', 7, 8, h('18:00'), h('19:00')],   // Narbonne → Perpignan (5e train depuis Paris : 4 correspondances)
    ['G1', 3, 5, h('12:30'), h('13:30')],   // Bordeaux → Agen (train G1)
    ['G1', 5, 6, h('13:32'), h('14:10')],   // Agen → Montauban (même train G1, 2 min d'arrêt)
  ];
  const ctx = Routing.prepare(net, [rows]);

  const r1 = Routing.searchAtoB(ctx, [2], [4], {});
  const keys = r1.journeys.map((j) => j.legs.map((l) => l.t).join('+'));
  check('Lyon → Toulouse : changement de gare à Paris avec 45 min de transfert', keys.includes('A1+B1+C1'), keys.join(', '));
  check('Refuse un changement de gare trop court (B2)', !keys.some((k) => k.includes('B2')));
  check('Refuse une correspondance de moins de 10 min (C2)', !keys.some((k) => k.includes('C2')));
  check('Refuse une attente de plus de 3 h (C3)', !keys.some((k) => k.includes('C3')));
  const walk = r1.journeys[0] && r1.journeys[0].steps.find((s) => s.type === 'walk');
  check('Le transfert Gare de Lyon → Montparnasse est signalé', !!walk && walk.transfer === 45);

  const r2 = Routing.searchAtoB(ctx, [1], [8], {});
  check('Paris Montparnasse → Perpignan avec 4 correspondances (5 trains) trouvé', r2.journeys.some((j) => j.nCorr === 4));
  const r3 = Routing.searchAtoB(ctx, [1], [8], { maxLegs: 4 });
  check('Avec une limite à 3 correspondances, il n\'est plus trouvé', r3.journeys.length === 0);

  const r4 = Routing.searchAtoB(ctx, [3], [6], {});
  check('Rester dans le même train (2 réservations, arrêt de 2 min) est accepté',
    r4.journeys.some((j) => j.steps.some((s) => s.type === 'stay')));

  const r5 = Routing.searchAtoB(ctx, [2], [1], {});
  check('Arrivée dans la bonne ville mais autre gare : transfert final ajouté',
    r5.journeys.some((j) => j.finalTransfer && j.finalTransfer.minutes === 45));

  const from = Routing.searchFrom(ctx, [2], {});
  check('« Où puis-je aller ? » depuis Lyon : Paris en direct', !!from.direct[0]);
  const fromP = Routing.searchFrom(ctx, [1], {});
  check('« Où puis-je aller ? » depuis Paris Montparnasse : Perpignan avec 4 correspondances', !!fromP.connections[8] && fromP.connections[8][0].nCorr === 4);
}

// ---------------------------------------------------------------
console.log('\n=== Partie 2 : trajets réels (données SNCF du dossier data/) ===');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/meta.json'), 'utf8'));
const net = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/stations.json'), 'utf8'));
const byName = (q) => {
  const res = [];
  net.stations.forEach((s, i) => { if (s.n.toLowerCase().includes(q.toLowerCase())) res.push(i); });
  return res;
};
const loadDay = (d) => {
  const f = path.join(ROOT, 'data/days', `${d}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).rows : [];
};

const CASES = process.env.CASES ? JSON.parse(process.env.CASES) : [
  ['Tarbes', 'Dax'],
  ['Paris', 'Nîmes'],
  ['Paris Montparnasse', 'Carcassonne'],
  ['Narbonne', 'Nîmes'],
  ['Bordeaux', 'Marseille'],
  ['Lille', 'Bordeaux'],
  ['Nantes', 'Lyon'],
  ['Strasbourg', 'Montpellier'],
  ['Rennes', 'Nice'],
];

const day = process.env.DAY || meta.days[Math.min(3, meta.days.length - 1)];
console.log(`Jour testé : ${day} (données SNCF du ${meta.sourceUpdatedAt})`);
const next = new Date(day + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
const ctx = Routing.prepare(net, [loadDay(day), loadDay(next.toISOString().slice(0, 10))]);

for (const [a, b] of CASES) {
  const A = byName(a), B = byName(b);
  if (!A.length || !B.length) { console.log(`\n${a} → ${b} : gare absente des données ce jour-là.`); continue; }
  const t0 = Date.now();
  const r = Routing.searchAtoB(ctx, A, B, {});
  const ms = Date.now() - t0;
  const byCorr = {};
  r.journeys.forEach((j) => { byCorr[j.nCorr] = (byCorr[j.nCorr] || 0) + 1; });
  console.log(`\n${a} → ${b} : ${r.journeys.length} solution(s) en ${ms} ms ${JSON.stringify(byCorr)}${r.truncated ? ' (liste coupée)' : ''}`);
  r.journeys.slice(0, 2).forEach((j) => console.log(describe(net, j)));
  // Vérifications automatiques sur chaque solution
  let ok = true;
  for (const j of r.journeys) {
    for (let i = 0; i < j.steps.length; i++) {
      const s = j.steps[i];
      if (s.wait > 180) ok = false;
      if (s.type === 'same' && s.wait < 10) ok = false;
      if (s.type === 'walk' && s.wait < s.transfer) ok = false;
      if (j.legs[i].d !== s.from || j.legs[i + 1].o !== s.to) ok = false;
    }
    if (j.nCorr > 4) ok = false;
  }
  for (let i = 1; i < r.journeys.length; i++) {
    const p = r.journeys[i - 1], c = r.journeys[i];
    if (p.nCorr > c.nCorr || (p.nCorr === c.nCorr && p.duration > c.duration)) ok = false;
  }
  check('toutes les solutions respectent les règles et le tri', ok);
}

console.log(failures ? `\n${failures} test(s) en échec.` : '\nTous les tests sont réussis.');
process.exit(failures ? 1 : 0);
