/** Menu metadata only. Each future game supplies a separate rules module and 3D asset set. */
export const games = [
  {
    id: 'american-checkers', name: 'Checkers', variant: 'American', boardSize: 8,
    illustration: 'checkersIllustration', detail: 'The familiar game, in a little patch of meadow.',
    rulesStatus: 'american-approved',
  },
  {
    id: 'international-draughts', name: 'Draughts', variant: 'International', boardSize: 10,
    illustration: 'draughtsIllustration', detail: 'A wider field. More room to think ahead.',
    rulesStatus: 'fmjd-2024-approved',
  },
];
