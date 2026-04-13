/**
 * Gabarits des transporteurs.
 * Chaque entrée contient :
 *   - keywords        : mots-clés (la détection est insensible à la casse)
 *   - cropCoordinates : zone de recadrage en points PDF (x, y depuis bas-gauche, width, height)
 *
 * Système de coordonnées PDF :
 *   - Origine (0, 0) = coin bas-gauche de la page
 *   - x : distance depuis la gauche
 *   - y : distance depuis le bas
 *   - width / height : dimensions de la zone à garder
 *
 * Pour calibrer : utiliser le mode Manuel, dessiner la zone, et lire les
 * coordonnées affichées sous le PDF ("Zone sélectionnée").
 */
export const carriers = {
  /**
   * DPD — A4 portrait (595×842pt)
   * Label : quart haut-gauche (moitié gauche × moitié haute)
   * x:0, y:421, w:297, h:421
   */
  DPD: {
    keywords: ['DPD', 'dpd france', 'dpdgroup', 'chronopost'],
    cropCoordinates: { x: 0, y: 421, width: 297, height: 421 },
  },

  /**
   * Mondial Relay — A4 portrait (595×842pt)
   * Label : moitié basse, paysage ~150×100mm, marges ~3cm gauche/droite
   * Décalé 1cm vers le bas (y: 62 → 34)
   * rotation: -90 → pivoté 90° vers la gauche à l'impression
   */
  MondialRelay: {
    keywords: [
      'mondial relay',
      'mondialrelay',
      'mondial-relay',
      'point relais',
      'point-relais',
      'in-store',
      'locker',
      '24r',
      '24l',
      'mondialrelay.fr',
      'réseau mondial',
    ],
    cropCoordinates: { x: 85, y: 34, width: 425, height: 283 },
    rotation: -90,
  },

  /**
   * DHL — A4 paysage (842×595pt)
   * Label : moitié gauche, portrait 100×150mm, marges ~3cm
   * Étendu de 2cm en haut et en bas (y: 85→28, h: 425→539)
   */
  DHL: {
    keywords: ['dhl', 'deutsche post', 'dhl express', 'dhl parcel', 'dhl.com'],
    cropCoordinates: { x: 85, y: 28, width: 283, height: 539 },
  },
}

/**
 * Détecte le transporteur à partir d'un texte extrait du PDF.
 * Insensible à la casse. Normalise les espaces multiples.
 * Retourne la clé du transporteur (ex: 'DPD') ou null si non détecté.
 *
 * @param {string} rawText - Texte brut extrait du PDF
 * @returns {string|null}
 */
export function detectCarrier(rawText) {
  // Normalisation : minuscules + espaces multiples → un seul espace
  const text = rawText.toLowerCase().replace(/\s+/g, ' ')

  for (const [name, config] of Object.entries(carriers)) {
    if (config.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      return name
    }
  }
  return null
}
