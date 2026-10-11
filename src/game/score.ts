export type Rank = 'S' | 'A' | 'B' | 'C';
export interface ScoreState {
  score: number;
  kanaCombo: number;
  cleanWords: number;
  wordMissed: boolean;
}
export const emptyScore = (): ScoreState => ({ score: 0, kanaCombo: 0, cleanWords: 0, wordMissed: false });
export const comboTier = (chain: number): number => chain >= 50 ? 3 : chain >= 30 ? 2 : chain >= 10 ? 1 : 0;
const kanaPoints = (combo: number) => [10, 12, 15, 20][comboTier(combo)];

/** Apply each committed kana separately, including multi-kana units. No key-count bonus. */
export function scoreInput(state: ScoreState, kana: number, accepted: boolean, wordDone: boolean): ScoreState {
  if (!accepted) return { ...state, kanaCombo: 0, wordMissed: true };
  let { score, kanaCombo, cleanWords } = state;
  for (let i = 0; i < kana; i++) score += kanaPoints(++kanaCombo);
  if (wordDone) {
    score += 100;
    if (!state.wordMissed) { score += 50; cleanWords++; }
  }
  return { score, kanaCombo, cleanWords, wordMissed: wordDone ? false : state.wordMissed };
}

export function routeRank(completed: boolean, accuracy: number, cleanWords: number, words: number): Rank | null {
  if (!completed) return null;
  if (accuracy >= .98 && words > 0 && cleanWords / words >= .8) return 'S';
  return accuracy >= .95 ? 'A' : 'B';
}

/** Reserved for the next chapter integration; speed never affects rank. */
export function chapterRank(victory: boolean, accuracy: number, parries: number, resolved: number, resets: number): Rank | null {
  if (!victory) return null;
  if (resets >= 2) return 'C';
  if (resets === 1) return 'B';
  if (accuracy >= .97 && resolved >= 3 && parries / resolved >= .8) return 'S';
  return accuracy >= .94 && (resolved === 0 || parries / resolved >= .6) ? 'A' : 'B';
}

export function routeStars(completed: boolean, accuracy: number, cleanWords: number, words: number): [boolean, boolean, boolean] {
  return [completed, completed && accuracy >= .95, completed && words > 0 && cleanWords / words >= .8];
}
