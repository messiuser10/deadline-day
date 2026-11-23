/** The rules in five steps, shared by the How to Play page and the first-visit walkthrough. */
export const HOW_TO_PLAY: readonly { title: string; body: string }[] = [
  {
    title: 'Pick a formation',
    body: 'Create or join a game, name your team and choose one of ten formations. The auction pool is sized from everyone’s formations, plus a few spare players per position.',
  },
  {
    title: 'Nominate and bid',
    body: 'Teams take turns putting a player up for auction. Everyone who has an open slot he can play bids until the clock runs out. A late bid resets the clock, so no sniping.',
  },
  {
    title: 'Mind the budget',
    body: 'Every team starts with the same budget and must always keep enough to fill its remaining slots at the cheapest base price. The server stops any bid that would strand you.',
  },
  {
    title: 'Fill your XI',
    body: 'The auction ends when every team has 11 players. Bought a winger who can play striker? He can fill either slot.',
  },
  {
    title: 'Play the season',
    body: 'Your team joins the strongest real clubs to make a 20-team league. Buying a club’s star weakens that club. 38 matchdays are simulated, then the awards and grades come out.',
  },
];
