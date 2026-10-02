// QWERTY touch typing: 0 = thumb, 1 = index, 2 = middle,
// 3 = ring, 4 = pinky. Rows: number = 0, upper = 1, home = 2, lower = 3.
export const FINGER: Record<string, { hand: 'L' | 'R'; finger: 0|1|2|3|4; row: number }> = Object.fromEntries(
  [
    ['1234567890-', 0, ['L4', 'L3', 'L2', 'L1', 'L1', 'R1', 'R1', 'R2', 'R3', 'R4', 'R4']],
    ['qwertyuiop', 1, ['L4', 'L3', 'L2', 'L1', 'L1', 'R1', 'R1', 'R2', 'R3', 'R4']],
    ['asdfghjkl;', 2, ['L4', 'L3', 'L2', 'L1', 'L1', 'R1', 'R1', 'R2', 'R3', 'R4']],
    ['zxcvbnm,./', 3, ['L4', 'L3', 'L2', 'L1', 'L1', 'R1', 'R1', 'R2', 'R3', 'R4']],
  ].flatMap(([keys, row, fingers]) => Array.from(keys as string, (key, i) => {
    const position = (fingers as string[])[i];
    return [key, {
      hand: position[0] as 'L' | 'R',
      finger: Number(position[1]) as 0|1|2|3|4,
      row: row as number,
    }];
  })),
);
