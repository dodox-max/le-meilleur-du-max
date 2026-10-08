// Informations ajoutées aux gares de l'open data SNCF :
// nom lisible, ville (pour les changements de gare), région, temps de transfert.
// Vous pouvez compléter ces listes : le robot de mise à jour signale dans son
// journal les gares qu'il ne sait pas classer.

export function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- Gares regroupées sous « (intramuros) » dans l'open data ----------
// Le code (colonne « Origine IATA ») permet de savoir de quelle gare il s'agit.
export const KNOWN_CODES = {
  FRPLY: 'Paris Gare de Lyon',
  FRPMO: 'Paris Montparnasse',
  FRPNO: 'Paris Gare du Nord',
  FRPST: "Paris Gare de l'Est",
  FRPAZ: 'Paris Austerlitz',
  FRLPD: 'Lyon Part-Dieu',
  FRLPE: 'Lyon Perrache',
};

// Temps de transfert réalistes (transports en commun + marge), en minutes.
export const TRANSFERS = {
  'FRPLY|FRPAZ': 25, 'FRPLY|FRPNO': 35, 'FRPLY|FRPST': 40, 'FRPLY|FRPMO': 45,
  'FRPAZ|FRPMO': 40, 'FRPAZ|FRPNO': 45, 'FRPAZ|FRPST': 40,
  'FRPMO|FRPNO': 50, 'FRPMO|FRPST': 50, 'FRPNO|FRPST': 20,
  'FRLPD|FRLPE': 30,
};

// Villes ayant plusieurs gares : clé de ville, règle de reconnaissance, temps de transfert par défaut
export const CITY_GROUPS = [
  { key: 'PARIS', name: 'Paris', test: (n) => n.startsWith('PARIS'), transfer: 60 },
  { key: 'LYON', name: 'Lyon', test: (n) => n.startsWith('LYON') && !n.includes('EXUPERY'), transfer: 30 },
  { key: 'LILLE', name: 'Lille', test: (n) => n.startsWith('LILLE'), transfer: 20 },
  { key: 'MARSEILLE', name: 'Marseille', test: (n) => n.startsWith('MARSEILLE'), transfer: 30 },
  { key: 'MONTPELLIER', name: 'Montpellier', test: (n) => n.startsWith('MONTPELLIER'), transfer: 40 },
  { key: 'NIMES', name: 'Nîmes', test: (n) => n.startsWith('NIMES'), transfer: 40 },
  { key: 'AVIGNON', name: 'Avignon', test: (n) => n.startsWith('AVIGNON'), transfer: 25 },
  { key: 'VALENCE', name: 'Valence', test: (n) => n.startsWith('VALENCE'), transfer: 30 },
  { key: 'BESANCON', name: 'Besançon', test: (n) => n.startsWith('BESANCON'), transfer: 35 },
  { key: 'BELFORT', name: 'Belfort', test: (n) => n.startsWith('BELFORT'), transfer: 35 },
  { key: 'TOURS', name: 'Tours', test: (n) => n === 'TOURS' || n.includes('PIERRE DES CORPS'), transfer: 20 },
  { key: 'ORLEANS', name: 'Orléans', test: (n) => n.startsWith('ORLEANS') || n.includes('AUBRAIS'), transfer: 20 },
  { key: 'REIMS', name: 'Reims', test: (n) => n === 'REIMS' || n.startsWith('CHAMPAGNE ARDENNE'), transfer: 30 },
  { key: 'NICE', name: 'Nice', test: (n) => n.startsWith('NICE'), transfer: 25 },
  { key: 'TOULOUSE', name: 'Toulouse', test: (n) => n.startsWith('TOULOUSE'), transfer: 30 },
  { key: 'BORDEAUX', name: 'Bordeaux', test: (n) => n.startsWith('BORDEAUX'), transfer: 30 },
  { key: 'NANTES', name: 'Nantes', test: (n) => n.startsWith('NANTES'), transfer: 30 },
];

// ---------- Régions ----------
const REGION_KEYWORDS = {
  'Île-de-France': ['PARIS', 'MARNE LA VALLEE', 'MASSY', 'AEROPORT ROISSY', 'ROISSY', 'VERSAILLES', 'CHESSY'],
  'Auvergne-Rhône-Alpes': ['LYON', 'SAINT EXUPERY', 'VALENCE', 'GRENOBLE', 'CHAMBERY', 'AIX LES BAINS', 'ANNECY',
    'ANNEMASSE', 'THONON', 'EVIAN', 'BELLEGARDE', 'BOURG EN BRESSE', 'SAINT ETIENNE', 'ST ETIENNE', 'CLERMONT',
    'VICHY', 'RIOM', 'MOULINS', 'SAINT GERMAIN DES FOSSES', 'ST GERMAIN DES FOSSES', 'ROANNE', 'MONTLUCON',
    'MONTELIMAR', 'MODANE', 'SAINT JEAN DE MAURIENNE', 'ST JEAN DE MAURIENNE', 'SAINT AVRE', 'ALBERTVILLE',
    'MOUTIERS', 'AIME', 'LANDRY', 'BOURG SAINT MAURICE', 'BOURG ST MAURICE', 'CLUSES', 'SALLANCHES',
    'SAINT GERVAIS', 'ST GERVAIS', 'LA ROCHE SUR FORON', 'CULOZ', 'AMBERIEU', 'VIENNE', 'VOIRON', 'ISSOIRE',
    'BRIOUDE', 'LE PUY', 'AURILLAC', 'PONTCHARRA', 'ROMANS', 'ST MARCELLIN', 'SAINT MARCELLIN', 'MACLAS'],
  'Bourgogne-Franche-Comté': ['DIJON', 'BESANCON', 'BELFORT', 'MONTBARD', 'MACON', 'LE CREUSOT', 'CHALON SUR SAONE',
    'BEAUNE', 'AUXERRE', 'SENS', 'NEVERS', 'DOLE', 'MOUCHARD', 'FRASNE', 'PONTARLIER', 'LAROCHE MIGENNES',
    'MONTCHANIN', 'VESOUL', 'MONTBELIARD', 'LONS LE SAUNIER', 'TONNERRE', 'COSNE', 'LA CHARITE', 'DECIZE'],
  'Grand Est': ['STRASBOURG', 'COLMAR', 'MULHOUSE', 'METZ', 'NANCY', 'REIMS', 'CHAMPAGNE ARDENNE', 'MEUSE TGV',
    'LORRAINE TGV', 'THIONVILLE', 'SAVERNE', 'SELESTAT', 'EPINAL', 'REMIREMONT', 'SAINT DIE', 'ST DIE',
    'LUNEVILLE', 'SARREBOURG', 'BAR LE DUC', 'CHALONS', 'VITRY', 'CHARLEVILLE', 'SEDAN', 'RETHEL', 'TROYES',
    'CHAUMONT', 'FORBACH', 'SAINT AVOLD', 'ST AVOLD', 'HAGUENAU', 'VERDUN', 'SAINT DIZIER', 'ST DIZIER',
    'SAINT MIHIEL', 'SOUILLY', 'EPERNAY', 'CHATEAU THIERRY', 'LANGRES', 'TOUL', 'PONT A MOUSSON'],
  'Hauts-de-France': ['LILLE', 'ARRAS', 'DOUAI', 'VALENCIENNES', 'HAUTE PICARDIE', 'AMIENS', 'CALAIS', 'BOULOGNE',
    'DUNKERQUE', 'HAZEBROUCK', 'BETHUNE', 'LENS', 'TOURCOING', 'ROUBAIX', 'CROIX', 'SAINT QUENTIN',
    'ST QUENTIN', 'ABBEVILLE', 'ETAPLES', 'RANG DU FLIERS', 'CREIL', 'MAUBEUGE', 'COMPIEGNE', 'BEAUVAIS',
    'SAINT OMER', 'ST OMER', 'AULNOYE', 'LAON', 'SOISSONS', 'NOYELLES'],
  'Normandie': ['ROUEN', 'LE HAVRE', 'CAEN', 'CHERBOURG', 'BAYEUX', 'LISIEUX', 'EVREUX', 'DEAUVILLE', 'TROUVILLE',
    'GRANVILLE', 'ARGENTAN', 'ALENCON', 'SAINT LO', 'ST LO', 'VALOGNES', 'CARENTAN', 'VERNON', 'DIEPPE',
    'YVETOT', 'BERNAY', 'L AIGLE', 'FLERS', 'BRIOUZE'],
  'Bretagne': ['RENNES', 'BREST', 'QUIMPER', 'LORIENT', 'VANNES', 'SAINT BRIEUC', 'ST BRIEUC', 'MORLAIX',
    'GUINGAMP', 'LAMBALLE', 'SAINT MALO', 'ST MALO', 'DOL', 'REDON', 'AURAY', 'QUIMPERLE', 'LANDERNEAU',
    'VITRE', 'PLOUARET', 'ROSPORDEN', 'QUESTEMBERT', 'LANNION', 'HENNEBONT'],
  'Pays de la Loire': ['NANTES', 'ANGERS', 'LE MANS', 'LAVAL', 'SAUMUR', 'SAINT NAZAIRE', 'ST NAZAIRE',
    'LA BAULE', 'LE CROISIC', 'PORNICHET', 'LA ROCHE SUR YON', 'LES SABLES', 'SABLE SUR SARTHE', 'ANCENIS',
    'LE POULIGUEN', 'SAVENAY', 'CHOLET', 'BATZ', 'LE POULIGUEN'],
  'Centre-Val de Loire': ['TOURS', 'PIERRE DES CORPS', 'ORLEANS', 'AUBRAIS', 'BLOIS', 'VENDOME', 'CHATEAUROUX',
    'BOURGES', 'VIERZON', 'ISSOUDUN', 'CHARTRES', 'AMBOISE', 'ARGENTON', 'MONTARGIS', 'GIEN', 'CHATEAUDUN'],
  'Nouvelle-Aquitaine': ['BORDEAUX', 'POITIERS', 'FUTUROSCOPE', 'LA ROCHELLE', 'NIORT', 'ANGOULEME', 'LIBOURNE',
    'ARCACHON', 'AGEN', 'MARMANDE', 'DAX', 'PAU', 'ORTHEZ', 'BAYONNE', 'BIARRITZ', 'SAINT JEAN DE LUZ',
    'ST JEAN DE LUZ', 'HENDAYE', 'LIMOGES', 'BRIVE', 'CHATELLERAULT', 'SURGERES', 'ROCHEFORT', 'SAINTES',
    'COGNAC', 'PERIGUEUX', 'LA SOUTERRAINE', 'UZERCHE', 'MONT DE MARSAN', 'FACTURE', 'BIGANOS', 'LA TESTE',
    'MORCENX', 'GUERET', 'PUYOO', 'SALIES', 'ROYAN', 'JONZAC', 'COUTRAS', 'SAINT SULPICE LAURIERE'],
  'Occitanie': ['TOULOUSE', 'MONTPELLIER', 'NIMES', 'PERPIGNAN', 'NARBONNE', 'BEZIERS', 'AGDE', 'SETE',
    'CARCASSONNE', 'MONTAUBAN', 'LOURDES', 'TARBES', 'CAHORS', 'SOUILLAC', 'GOURDON', 'FIGEAC', 'RODEZ',
    'ALBI', 'CASTELNAUDARY', 'LEZIGNAN', 'LUNEL', 'CERBERE', 'BANYULS', 'PORT VENDRES', 'COLLIOURE',
    'ARGELES', 'ELNE', 'LATOUR DE CAROL', 'LA TOUR DE CAROL', 'FOIX', 'PAMIERS', 'AX LES THERMES', 'LUCHON',
    'SAINT GAUDENS', 'ST GAUDENS', 'MURET', 'LANNEMEZAN', 'CAPVERN', 'MONTREJEAU', 'MENDE', 'BEDARIEUX',
    'MILLAU', 'ALES', 'CAUSSADE', 'MOISSAC', 'VALENCE D AGEN', 'AUCH', 'GRUISSAN', 'LA NOUVELLE', 'SALSES',
    'L HOSPITALET', 'TARASCON SUR ARIEGE'],
  "Provence-Alpes-Côte d'Azur": ['MARSEILLE', 'AIX EN PROVENCE', 'AVIGNON', 'TOULON', 'NICE', 'CANNES', 'ANTIBES',
    'MENTON', 'SAINT RAPHAEL', 'ST RAPHAEL', 'LES ARCS', 'HYERES', 'ARLES', 'MIRAMAS', 'ORANGE', 'BANDOL',
    'LA CIOTAT', 'FREJUS', 'JUAN LES PINS', 'VILLEFRANCHE SUR MER', 'BEAULIEU', 'CAGNES', 'GRASSE',
    'BRIANCON', 'GAP', 'MANOSQUE', 'SISTERON', 'CAVAILLON', 'TARASCON', 'MONTDAUPHIN', 'EMBRUN', 'VEYNES',
    'SAINT CHARLES', 'CASSIS', 'SIX FOURS', 'OLLIOULES'],
};

// Liste triée : les mots-clés les plus longs d'abord (« AIX LES BAINS » avant « AIX »)
const REGION_INDEX = Object.entries(REGION_KEYWORDS)
  .flatMap(([region, kws]) => kws.map((kw) => ({ kw, region })))
  .sort((a, b) => b.kw.length - a.kw.length);

export function regionOf(code, rawName) {
  if (code && !String(code).toUpperCase().startsWith('FR')) return 'Étranger';
  const n = normalize(rawName);
  for (const { kw, region } of REGION_INDEX) {
    if (n === kw || n.startsWith(kw + ' ') || n.includes(' ' + kw + ' ') || n.endsWith(' ' + kw)) {
      return region;
    }
  }
  return null;
}

// ---------- Noms lisibles ----------
const ACCENTS = {
  NIMES: 'Nîmes', BEZIERS: 'Béziers', AEROPORT: 'Aéroport', ANGOULEME: 'Angoulême', BESANCON: 'Besançon',
  CHAMBERY: 'Chambéry', ORLEANS: 'Orléans', MACON: 'Mâcon', MONTELIMAR: 'Montélimar', SETE: 'Sète',
  VENDOME: 'Vendôme', PERIGUEUX: 'Périgueux', MONTLUCON: 'Montluçon', CHATEAUROUX: 'Châteauroux',
  CHALONS: 'Châlons', CHALON: 'Chalon', LEZIGNAN: 'Lézignan', FREJUS: 'Fréjus', RAPHAEL: 'Raphaël',
  QUIMPERLE: 'Quimperlé', ETAPLES: 'Étaples', EPINAL: 'Épinal', SELESTAT: 'Sélestat', DIE: 'Dié',
  LUNEVILLE: 'Lunéville', GENEVE: 'Genève', ZURICH: 'Zürich', BALE: 'Bâle', EVIAN: 'Évian',
  MOUTIERS: 'Moûtiers', VALLEE: 'Vallée', CHATELLERAULT: 'Châtellerault', SURGERES: 'Surgères', ALES: 'Alès',
  GUERET: 'Guéret', BETHUNE: 'Béthune', SAONE: 'Saône', RHONE: 'Rhône', HYERES: 'Hyères', BRIANCON: 'Briançon',
  ALENCON: 'Alençon', EVREUX: 'Évreux', VITRE: 'Vitré', COMPIEGNE: 'Compiègne', CHATEAU: 'Château',
  AMBERIEU: 'Ambérieu', MONTREJEAU: 'Montréjeau', BEDARIEUX: 'Bédarieux', EPERNAY: 'Épernay',
  CERBERE: 'Cerbère', ARGELES: 'Argelès', ARIEGE: 'Ariège', COTE: 'Côte', PYRENEES: 'Pyrénées',
  STE: 'Ste', ST: 'St', TGV: 'TGV', CDG: 'CDG', INOUI: 'INOUI', MLV: 'MLV',
};
const SMALL = new Set(['SUR', 'EN', 'LES', 'LE', 'LA', 'DE', 'DU', 'DES', 'AUX', 'ET', 'D', 'L', 'SOUS']);

export function prettyName(code, rawName) {
  if (KNOWN_CODES[code]) return KNOWN_CODES[code];
  let raw = String(rawName || '').trim();
  const intra = /\(intramuros\)/i.test(raw);
  raw = raw.replace(/\s*\(intramuros\)\s*/i, '').replace(/\s+GARE$/i, '').replace(/\s+AUVERGNE RHONE ALPES$/i, '');
  const words = normalize(raw).split(' ').filter(Boolean);
  const out = words.map((w, i) => {
    if (ACCENTS[w]) return ACCENTS[w];
    if (i > 0 && SMALL.has(w)) return w.toLowerCase();
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
  if (intra) return `${out} (gare ${code})`;
  return out;
}

export function cityOf(code, rawName) {
  const n = normalize(rawName);
  for (const g of CITY_GROUPS) if (g.test(n)) return g;
  return null;
}
