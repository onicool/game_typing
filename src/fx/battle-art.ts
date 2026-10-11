export type PlayerPose = 'idle' | 'attack' | 'guard';
export type SentinelPose = 'idle' | 'attack' | 'hit';
export const POSE_HOLD_MS = 150;

/** Presentation uses the paused game clock; it never creates gameplay events. */
export function combatPoses(age: number, action: 'attack' | 'defend', defending: boolean, motion: boolean) {
  const recent = motion && age >= 0 && age < POSE_HOLD_MS;
  const attacking = recent && action === 'attack';
  return {
    player: (attacking ? 'attack' : defending || (recent && action === 'defend') ? 'guard' : 'idle') as PlayerPose,
    sentinel: (attacking ? 'hit' : defending && motion ? 'attack' : 'idle') as SentinelPose,
  };
}
export const battleArt = (file: string) => `${import.meta.env.BASE_URL}battle-art/${file}`;
export const playerPoses: PlayerPose[] = ['idle', 'attack', 'guard'];
export const sentinelPoses: SentinelPose[] = ['idle', 'attack', 'hit'];
