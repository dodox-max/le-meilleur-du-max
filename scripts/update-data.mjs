// Robot de mise à jour des données — lancé automatiquement par GitHub Actions.
// 1. Regarde si la SNCF a publié une nouvelle version du jeu de données « tgvmax ».
// 2. Si oui : télécharge le fichier, garde seulement les trains avec des places MAX,
//    et écrit des petits fichiers par jour dans le dossier data/ du site.
//
// Lancement manuel : node scripts/update-data.mjs            (vérifie puis met à jour si besoin)
//                    node scripts/update-data.mjs --force    (met à jour même sans nouveauté)
//                    node scripts/update-data.mjs --csv fichier.csv   (utilise un fichier local)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, prettyName, regionOf, cityOf, TRANSFERS } from './stations-info.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DAYS = path.join(DATA, 'days');
const API = 'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax';
const CSV_URL = `${API}/exports/csv?delimiter=%3B&use_labels=false&timezone=Europe%2FParis`;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const LOCAL_CSV = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

async function fetchWithRetry(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'le-meilleur-du-max (usage personnel)' } });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status} pour ${url}`);
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
  throw last;
}

// Lecture CSV (séparateur ;) qui gère les guillemets
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Retrouve les colonnes même si la SNCF change un peu leurs noms
function findColumns(header) {
  const h = header.map((x) => normalize(x).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (fn, label) => {
    const i = h.findIndex(fn);
    if (i < 0) throw new Error(`Colonne introuvable : ${label}. Colonnes reçues : ${header.join(', ')}`);
    return i;
  };
  return {
    date: find((x) => x === 'date', 'date'),
    train: find((x) => x.startsWith('train'), 'numéro de train'),
    oCode: find((x) => x.includes('origine') && x.includes('iata'), 'code origine'),
    dCode: find((x) => x.includes('destination') && x.includes('iata'), 'code destination'),
    oName: find((x) => x === 'origine', 'origine'),
    dName: find((x) => x === 'destination', 'destination'),
    dep: find((x) => x.includes('depart'), 'heure de départ'),
    arr: find((x) => x.includes('arrivee'), 'heure d\'arrivée'),
    avail: find((x) => x.includes('dispo') || x.includes('happy'), 'disponibilité'),
    axe: h.findIndex((x) => x === 'axe'),
    entity: h.findIndex((x) => x === 'entity'),
  };
}

const YES = new Set(['oui', 'true', '1', 't', 'yes', 'vrai']);
const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s).trim()); return m ? +m[1] * 60 + +m[2] : null; };

async function sourceVersion() {
  try {
    const res = await fetchWithRetry(API, 2);
    const meta = await res.json();
    const m = (meta.metas && meta.metas.default) || meta.metas || {};
    return m.data_processed || m.modified || m.metadata_processed || null;
  } catch (e) {
    console.log('Impossible de lire la date de mise à jour SNCF :', e.message);
    return null;
  }
}

async function main() {
  fs.mkdirSync(DAYS, { recursive: true });
  const oldMeta = readJSON(path.join(DATA, 'meta.json'), {});

  const version = LOCAL_CSV ? `local-${Date.now()}` : await sourceVersion();
  if (!FORCE && version && oldMeta.sourceUpdatedAt === version) {
    console.log(`Pas de nouvelle version (SNCF : ${version}). Rien à faire.`);
    return;
  }
  console.log(`Nouvelle version détectée : ${version || 'inconnue'} (avant : ${oldMeta.sourceUpdatedAt || 'aucune'})`);

  const text = LOCAL_CSV
    ? fs.readFileSync(LOCAL_CSV, 'utf8')
    : await (await fetchWithRetry(CSV_URL)).text();
  const rows = parseCSV(text.replace(/^﻿/, ''));
  const header = rows.shift();
  const col = findColumns(header);
  console.log(`${rows.length} lignes reçues.`);

  const stations = [];      // { c, raw }
  const stationIdx = new Map();
  const idx = (code, raw) => {
    if (!stationIdx.has(code)) { stationIdx.set(code, stations.length); stations.push({ c: code, raw }); }
    return stationIdx.get(code);
  };

  const byDay = new Map();
  let kept = 0, skippedBus = 0;
  for (const r of rows) {
    if (r.length < header.length - 1) continue;
    if (!YES.has(String(r[col.avail]).trim().toLowerCase())) continue;
    const axe = col.axe >= 0 ? normalize(r[col.axe]) : '';
    const entity = col.entity >= 0 ? normalize(r[col.entity]) : '';
    if (axe.includes('AUTOCAR') || entity.includes('AUTOCAR')) { skippedBus++; continue; }
    const date = String(r[col.date]).slice(0, 10);
    const dep = toMin(r[col.dep]);
    let arr = toMin(r[col.arr]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dep === null || arr === null) continue;
    if (arr < dep) arr += 1440; // arrivée après minuit
    const o = idx(r[col.oCode], r[col.oName]);
    const d = idx(r[col.dCode], r[col.dName]);
    if (o === d) continue;
    const train = String(r[col.train]).trim();
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push([train, o, d, dep, arr]);
    kept++;
  }
  console.log(`${kept} trajets avec places MAX gardés (${skippedBus} autocars ignorés).`);
  if (kept === 0) throw new Error('Aucun trajet disponible trouvé : le format des données a peut-être changé.');

  // Gares : nom lisible, ville, région
  const unknownRegion = [];
  const cities = {};
  const out = stations.map((s, i) => {
    const g = cityOf(s.c, s.raw);
    const key = g ? g.key : `#${i}`;
    if (g) {
      cities[key] = cities[key] || { name: g.name, members: [], transfer: g.transfer };
      cities[key].members.push(i);
    }
    let r = regionOf(s.c, s.raw);
    if (!r) { unknownRegion.push(s.raw); r = 'Autre'; }
    return { c: s.c, n: prettyName(s.c, s.raw), k: key, r };
  });
  // les villes à une seule gare n'ont pas besoin d'entrée
  for (const k of Object.keys(cities)) if (cities[k].members.length < 2) delete cities[k];
  for (const s of out) if (!cities[s.k] && !s.k.startsWith("#")) s.k = `#${out.indexOf(s)}`;

  // Une seule gare « intramuros » connue dans la ville : on garde juste le nom de la ville
  for (const s of out) {
    const m = /^(.*) \(gare [A-Z]+\)$/.exec(s.n);
    if (m && !cities[s.k]) s.n = m[1];
  }

  const transfers = {};
  for (const [pair, min] of Object.entries(TRANSFERS)) {
    const [a, b] = pair.split('|');
    if (stationIdx.has(a) && stationIdx.has(b)) transfers[`${stationIdx.get(a)}|${stationIdx.get(b)}`] = min;
  }

  if (unknownRegion.length) console.log(`Gares sans région connue (à ajouter dans scripts/stations-info.mjs) : ${unknownRegion.join(' | ')}`);
  const unnamed = out.filter((s) => /\(gare /.test(s.n));
  if (unnamed.length) console.log(`Gares « intramuros » sans nom précis : ${unnamed.map((s) => s.n).join(' | ')}`);

  // Écriture des fichiers
  const stamp = Date.now().toString(36);
  for (const f of fs.readdirSync(DAYS)) fs.unlinkSync(path.join(DAYS, f));
  const days = [...byDay.keys()].sort();
  for (const day of days) {
    const list = byDay.get(day).sort((a, b) => a[3] - b[3]);
    fs.writeFileSync(path.join(DAYS, `${day}.json`), JSON.stringify({ date: day, rows: list }));
  }
  fs.writeFileSync(path.join(DATA, 'stations.json'), JSON.stringify({ stations: out, cities, transfers }));
  const meta = {
    sourceUpdatedAt: version,
    fetchedAt: new Date().toISOString(),
    stamp,
    days,
    trips: kept,
    stations: out.length,
  };
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`Terminé : ${days.length} jours (${days[0]} → ${days[days.length - 1]}), ${out.length} gares.`);
}

main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
