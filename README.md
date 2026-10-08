# Le meilleur du Max by DDX

Site personnel pour trouver les trains à 0 € avec l'abonnement MAX JEUNE, à partir de l'open data SNCF
« Disponibilité à 30 jours de places MAX JEUNE et MAX SENIOR ».

## Ce qu'il y a dans ce dossier

| Élément | Rôle |
|---|---|
| `index.html`, `assets/` | Le site (pages, styles, moteur de recherche `routing.js`) |
| `assets/config.js` | Seul réglage à faire : l'adresse du service d'alertes |
| `data/` | Les trains disponibles, remplis automatiquement par le robot (ne pas modifier) |
| `scripts/update-data.mjs` | Le robot qui télécharge les données SNCF |
| `scripts/stations-info.mjs` | Noms des gares, régions, temps de changement de gare (modifiable) |
| `.github/workflows/mise-a-jour.yml` | Planning du robot : toutes les 30 min, puis publication du site |
| `apps-script/` | Le service d'alertes par email, à coller dans Google Apps Script |
| `tests/` | Tests du calcul des correspondances |

## Règles de calcul

- Jusqu'à 4 correspondances (5 trains).
- Correspondance dans la même gare : 10 min minimum, 3 h maximum.
- Changement de gare dans la même ville (Paris, Lyon, Lille, Nîmes, Avignon…) : temps de transfert
  en transports en commun ajouté (voir `scripts/stations-info.mjs`), toujours dans la limite de 3 h.
- Rester dans le même train avec deux réservations MAX est proposé quand le trajet complet n'est pas disponible.
- Tri : nombre de correspondances, puis durée totale.

## Tester sur son ordinateur (facultatif)

```
node scripts/update-data.mjs --force
node tests/test-routing.mjs
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
```
