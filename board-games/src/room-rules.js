/** User-approved initial settings; no network or clock enforcement is implied here. */
export function createDefaultRoomRules() {
  return {
    visibility: 'private',
    creatorSide: null, // The room creator must choose; do not silently assign a side.
    touchMove: false,
    legalMoveHints: true,
    resignation: true,
    drawOffers: true,
    mutuallyAgreedTakebacks: false,
    rematches: true,
    clock: { enabled: false, initialSeconds: 80 * 60, incrementSeconds: 30, incrementStepSeconds: 15 },
    disconnect: { mode: 'reconnect', graceSeconds: 5 * 60, pauseClock: true, extensionBy: 'connected-player', extensionSeconds: 5 * 60, extensionLimit: null, timeoutResult: 'no-result' },
    moveInput: { confirmRequired: true, captureSelection: 'complete-route' },
    drawClaims: 'player-claim',
    draughtsDrawOfferMinimumMoves: 40,
    rematch: { swapSides: true, bothReadyRequired: true },
    takeback: { plies: 1, restoreTurnStartClocks: true, clocksRunWhilePending: true },
  };
}
