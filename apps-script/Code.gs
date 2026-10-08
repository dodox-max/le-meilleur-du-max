/**
 * Le meilleur du Max by DDX — service d'alertes (Google Apps Script)
 * -------------------------------------------------------------------
 * Ce script :
 *  - enregistre les alertes envoyées depuis le site (dans une feuille Google Sheets),
 *  - vérifie toutes les heures si les données SNCF du site ont changé,
 *  - envoie un email (depuis votre Gmail) quand un train à 0 € apparaît,
 *  - permet de supprimer une alerte grâce au lien contenu dans chaque email.
 *
 * Seule ligne à modifier : l'adresse de votre site, juste en dessous.
 */
var SITE_URL = 'https://VOTRE-PSEUDO.github.io/le-meilleur-du-max/';

var SITE_NAME = 'Le meilleur du Max by DDX';
var MAX_ALERTS_PER_EMAIL = 20;
var MAX_NEW_ALERTS_PER_DAY = 100;
var HEADERS = ['id', 'token', 'email', 'fromCodes', 'fromLabel', 'toCodes', 'toLabel', 'date',
  'fromMin', 'toMin', 'connections', 'createdAt', 'notified', 'status'];

// ------------------------------------------------------------------ installation
/** À lancer UNE fois (bouton « Exécuter ») : crée la feuille et la vérification horaire. */
function setup() {
  sheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkAlerts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAlerts').timeBased().everyHours(1).create();
  Logger.log('Installation terminée. Feuille des alertes : ' + SpreadsheetApp.openById(prop_('SHEET_ID')).getUrl());
}

function prop_(k, v) {
  var p = PropertiesService.getScriptProperties();
  if (v === undefined) return p.getProperty(k);
  p.setProperty(k, v);
}

function sheet_() {
  var id = prop_('SHEET_ID');
  var ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('Alertes — ' + SITE_NAME);
    prop_('SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName('Alertes');
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName('Alertes');
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    HEADERS.forEach(function (h, k) { o[h] = values[i][k]; });
    rows.push(o);
  }
  return rows;
}

function writeCell_(row, header, value) {
  sheet_().getRange(row, HEADERS.indexOf(header) + 1).setValue(value);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function today_() {
  return Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
}

function deleteUrl_(a) {
  return ScriptApp.getService().getUrl() + '?action=delete&id=' + encodeURIComponent(a.id) + '&token=' + encodeURIComponent(a.token);
}

function hhmm_(m) {
  m = Number(m);
  var h = Math.floor((m % 1440) / 60), mn = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mn < 10 ? '0' : '') + mn;
}

function frDate_(d) {
  var x = new Date(d + 'T12:00:00Z');
  var days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return days[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + months[x.getUTCMonth()];
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function describeAlert_(a) {
  var t = (Number(a.fromMin) > 0 || Number(a.toMin) < 1439) ? ' (départ entre ' + hhmm_(a.fromMin) + ' et ' + hhmm_(a.toMin) + ')' : '';
  return a.fromLabel + ' → ' + a.toLabel + ', le ' + frDate_(a.date) + t + (a.connections === true || a.connections === 'TRUE' ? ', correspondances acceptées' : ', trajets directs seulement');
}

function mail_(to, subject, html) {
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Quota quotidien d\'emails Gmail atteint');
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: SITE_NAME });
}

function layout_(title, body) {
  return '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1B1F3B">' +
    '<div style="background:#3A5BFF;color:#fff;padding:16px 20px;border-radius:14px 14px 0 0;font-size:20px;font-weight:bold">' + esc_(SITE_NAME) + '</div>' +
    '<div style="border:2px solid #DDE4F7;border-top:0;padding:18px 20px;border-radius:0 0 14px 14px">' +
    '<h2 style="margin:0 0 12px;font-size:20px">' + esc_(title) + '</h2>' + body +
    '<p style="color:#565E80;font-size:13px;margin-top:20px">Les places à 0 € partent vite et les données SNCF ne sont mises à jour qu\'une fois par jour : vérifiez au moment de réserver.</p>' +
    '</div></div>';
}

// ------------------------------------------------------------------ réception depuis le site
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var p = JSON.parse(e.postData.contents);
    if (p.action === 'create') return json_(create_(p));
    if (p.action === 'list') return json_(list_(p));
    return json_({ ok: false, error: 'Demande inconnue.' });
  } catch (err) {
    return json_({ ok: false, error: 'Erreur du service d\'alertes : ' + err.message });
  } finally {
    lock.releaseLock();
  }
}

function validEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '')); }

function create_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  if (!validEmail_(email)) return { ok: false, error: 'Adresse email invalide.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || p.date < today_()) return { ok: false, error: 'Date invalide ou déjà passée.' };
  var codeOk = function (a) { return Array.isArray(a) && a.length > 0 && a.length < 15 && a.every(function (c) { return /^[A-Z]{5}$/.test(c); }); };
  if (!codeOk(p.from) || !codeOk(p.to)) return { ok: false, error: 'Gares invalides.' };

  var all = readAll_();
  var active = all.filter(function (a) { return a.email === email && a.status === 'active'; });
  if (active.length >= MAX_ALERTS_PER_EMAIL) return { ok: false, error: 'Vous avez déjà ' + MAX_ALERTS_PER_EMAIL + ' alertes actives : supprimez-en une d\'abord.' };
  var todayCount = all.filter(function (a) { return String(a.createdAt).slice(0, 10) === today_(); }).length;
  if (todayCount >= MAX_NEW_ALERTS_PER_DAY) return { ok: false, error: 'Trop d\'alertes créées aujourd\'hui, réessayez demain.' };

  var a = {
    id: 'a' + Utilities.getUuid().slice(0, 8),
    token: 't' + Utilities.getUuid().replace(/-/g, ''),
    email: email,
    fromCodes: p.from.join(','), fromLabel: String(p.fromLabel || '').slice(0, 80),
    toCodes: p.to.join(','), toLabel: String(p.toLabel || '').slice(0, 80),
    date: p.date,
    fromMin: Math.max(0, Math.min(1439, Number(p.fromMin) || 0)),
    toMin: Math.max(0, Math.min(1439, p.toMin === undefined ? 1439 : Number(p.toMin))),
    connections: p.connections !== false,
    createdAt: Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd HH:mm'),
    notified: '[]',
    status: 'active'
  };
  sheet_().appendRow(HEADERS.map(function (h) { return a[h]; }));
  mail_(email, 'Alerte créée : ' + a.fromLabel + ' → ' + a.toLabel,
    layout_('Votre alerte est en place', '<p>' + esc_(describeAlert_(a)) + '</p>' +
      '<p>Vous recevrez un email dès qu\'un train à 0 € apparaîtra dans les données SNCF (vérification après chaque mise à jour, en général le matin). Si des trains sont déjà disponibles, vous serez prévenu à la prochaine vérification, dans l\'heure.</p>' +
      '<p><a href="' + deleteUrl_(a) + '">Supprimer cette alerte</a></p>'));
  return { ok: true, id: a.id };
}

function list_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  if (!validEmail_(email)) return { ok: false, error: 'Adresse email invalide.' };
  var mine = readAll_().filter(function (a) { return a.email === email && a.status === 'active'; });
  if (mine.length) {
    mail_(email, 'Vos alertes ' + SITE_NAME,
      layout_('Vos alertes actives', '<ul>' + mine.map(function (a) {
        return '<li style="margin-bottom:10px">' + esc_(describeAlert_(a)) + '<br><a href="' + deleteUrl_(a) + '">Supprimer cette alerte</a></li>';
      }).join('') + '</ul>'));
  }
  return { ok: true }; // même réponse dans tous les cas, pour ne pas révéler qui a des alertes
}

// ------------------------------------------------------------------ suppression (lien dans l'email)
function doGet(e) {
  var p = (e && e.parameter) || {};
  var title = 'Lien invalide', text = 'Ce lien de suppression n\'est pas valide.';
  if (p.action === 'delete' && p.id && p.token) {
    var a = readAll_().filter(function (x) { return x.id === p.id && x.token === p.token; })[0];
    if (a) {
      writeCell_(a._row, 'status', 'supprimée');
      title = 'Alerte supprimée';
      text = 'Vous ne recevrez plus d\'email pour : ' + describeAlert_(a) + '.';
    }
  }
  return HtmlService.createHtmlOutput(
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#1B1F3B">' +
    '<h1 style="color:#3A5BFF">' + esc_(title) + '</h1><p>' + esc_(text) + '</p>' +
    '<p><a href="' + SITE_URL + '">Retour au site</a></p></div>').setTitle(title);
}

// ------------------------------------------------------------------ vérification horaire
function fetchJSON_(path) {
  var res = UrlFetchApp.fetch(SITE_URL + path, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Site injoignable (' + res.getResponseCode() + ') pour ' + path);
  return JSON.parse(res.getContentText());
}

function addDay_(d, n) {
  var x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd');
}

/** Lancée toutes les heures. Vous pouvez aussi la lancer à la main pour tester. */
function checkAlerts() {
  var meta = fetchJSON_('data/meta.json?t=' + Date.now());
  if (prop_('LAST_STAMP') === meta.stamp) return; // pas de nouvelles données
  var net = fetchJSON_('data/stations.json?v=' + meta.stamp);
  var byCode = {};
  net.stations.forEach(function (s, i) { byCode[s.c] = i; });

  var dayCache = {};
  function day(d) {
    if (!(d in dayCache)) dayCache[d] = meta.days.indexOf(d) === -1 ? [] : fetchJSON_('data/days/' + d + '.json?v=' + meta.stamp).rows;
    return dayCache[d];
  }

  var today = today_();
  var sent = 0;
  readAll_().forEach(function (a) {
    if (a.status !== 'active') return;
    var date = a.date instanceof Date ? Utilities.formatDate(a.date, 'Europe/Paris', 'yyyy-MM-dd') : String(a.date);
    if (date < today) { writeCell_(a._row, 'status', 'expirée'); return; }
    a.date = date;
    var from = String(a.fromCodes).split(',').map(function (c) { return byCode[c]; }).filter(function (x) { return x !== undefined; });
    var to = String(a.toCodes).split(',').map(function (c) { return byCode[c]; }).filter(function (x) { return x !== undefined; });
    if (!from.length || !to.length) return; // gare absente des données ce jour-là
    var ctx = Routing.prepare(net, [day(date), day(addDay_(date, 1))]);
    var withCorr = a.connections === true || a.connections === 'TRUE';
    var r = Routing.searchAtoB(ctx, from, to, {
      fromMin: Number(a.fromMin), toMin: Number(a.toMin),
      maxLegs: withCorr ? 5 : 1, timeBudgetMs: 20000
    });
    var found = r.best;
    if (!found.length) return;
    var notified = [];
    try { notified = JSON.parse(a.notified || '[]'); } catch (e) { notified = []; }
    var fresh = found.filter(function (j) { return notified.indexOf(sig_(net, j)) === -1; });
    if (!fresh.length) return;
    var html = '<p>' + esc_(describeAlert_(a)) + '</p>' + fresh.slice(0, 6).map(function (j) { return journeyHtml_(net, j); }).join('') +
      (fresh.length > 6 ? '<p>… et ' + (fresh.length - 6) + ' autre(s) trajet(s).</p>' : '') +
      '<p><a href="' + SITE_URL + '">Voir tous les trajets sur le site</a></p>' +
      '<p style="font-size:13px"><a href="' + deleteUrl_(a) + '">Supprimer cette alerte</a></p>';
    try {
      mail_(a.email, 'Place à 0 € : ' + a.fromLabel + ' → ' + a.toLabel + ' le ' + frDate_(date), layout_('Une place à 0 € est disponible !', html));
      sent++;
      var keep = notified.concat(fresh.map(function (j) { return sig_(net, j); })).slice(-300);
      writeCell_(a._row, 'notified', JSON.stringify(keep));
    } catch (e) {
      Logger.log('Email non envoyé : ' + e.message);
    }
  });
  prop_('LAST_STAMP', meta.stamp);
  Logger.log('Vérification terminée : ' + sent + ' email(s) envoyé(s).');
}

/** Identifiant d'un trajet, stable d'une mise à jour à l'autre (codes de gares, pas leurs numéros). */
function sig_(net, j) {
  return j.legs.map(function (l) { return l.t + ':' + net.stations[l.o].c + '-' + net.stations[l.d].c + '@' + l.dep; }).join('/');
}

function journeyHtml_(net, j) {
  var parts = j.legs.map(function (l) {
    return '<div>' + hhmm_(l.dep) + ' ' + esc_(net.stations[l.o].n) + ' → ' + hhmm_(l.arr) + ' ' + esc_(net.stations[l.d].n) +
      ' <span style="color:#565E80">(train n° ' + esc_(l.t) + ')</span></div>';
  }).join('');
  var label = j.nCorr === 0 ? 'Direct' : j.nCorr + ' correspondance' + (j.nCorr > 1 ? 's' : '');
  var h = Math.floor(j.duration / 60), m = j.duration % 60;
  return '<div style="background:#EEF3FF;border-radius:10px;padding:10px 12px;margin:8px 0">' +
    '<b>' + hhmm_(j.dep) + ' → ' + hhmm_(j.arr) + '</b> · ' + label + ' · ' + h + ' h ' + (m < 10 ? '0' : '') + m + parts + '</div>';
}
