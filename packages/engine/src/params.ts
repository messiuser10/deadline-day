/** Simulation parameters (section 9). Admin-editable; these are the defaults. */

export type Tiebreaker = 'goal_difference' | 'goals_for' | 'head_to_head';

export interface PointsSystem {
  win: number;
  draw: number;
  loss: number;
}

export interface SimParams {
  baseGoals: number;
  homeAdvantage: number;
  sensitivity: number;
  /** 0..1; the log-normal sigma on expected goals is chaos x 0.2. */
  chaos: number;
  outOfPositionPenalty: number;
  /** Rating of the generic Academy Reserve used when an AI club has nobody left for a slot. */
  reserveRating: number;
  chemistry: boolean;
  injuries: boolean;
  points: PointsSystem;
  /** Applied in order after points; a seeded random draw always comes last. */
  tiebreakers: Tiebreaker[];
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  baseGoals: 1.25,
  homeAdvantage: 1.1,
  sensitivity: 0.075,
  chaos: 0.5,
  outOfPositionPenalty: 8,
  reserveRating: 62,
  chemistry: false,
  injuries: false,
  points: { win: 3, draw: 1, loss: 0 },
  tiebreakers: ['goal_difference', 'goals_for', 'head_to_head'],
};

export function withSimDefaults(partial: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_SIM_PARAMS,
    ...partial,
    points: { ...DEFAULT_SIM_PARAMS.points, ...partial.points },
    tiebreakers: partial.tiebreakers ?? [...DEFAULT_SIM_PARAMS.tiebreakers],
  };
}
