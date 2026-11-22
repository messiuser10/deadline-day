/**
 * Assignment solvers used by lineups, the auction feasibility check and AI club XIs.
 */

/** Cost that marks a forbidden pairing. Large but finite so the arithmetic stays exact. */
export const FORBIDDEN = 1e9;

/**
 * Hungarian algorithm (Kuhn-Munkres with potentials), minimizing total cost.
 * cost is rows x cols with rows <= cols. Returns, for each row, the chosen column.
 */
export function hungarian(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]!.length;
  if (m < n) throw new Error(`hungarian needs rows <= cols (got ${n} x ${m})`);
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      const row = cost[i0 - 1]!;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = row[j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]! > 0) result[p[j]! - 1] = j - 1;
  return result;
}

/**
 * Maximum bipartite matching (augmenting paths). adjacency[left] lists the right nodes it may take.
 * Returns the matching size and, for each left node, its right node or -1.
 */
export function maxBipartiteMatching(
  adjacency: readonly (readonly number[])[],
  rightCount: number,
): { size: number; matchOfLeft: number[] } {
  const matchOfRight = new Array<number>(rightCount).fill(-1);
  const matchOfLeft = new Array<number>(adjacency.length).fill(-1);
  let size = 0;

  // Greedy start, then augment.
  for (let l = 0; l < adjacency.length; l++) {
    for (const r of adjacency[l]!) {
      if (matchOfRight[r] === -1) {
        matchOfRight[r] = l;
        matchOfLeft[l] = r;
        size++;
        break;
      }
    }
  }

  const visited = new Array<number>(rightCount).fill(-1);
  const tryAugment = (l: number, stamp: number): boolean => {
    for (const r of adjacency[l]!) {
      if (visited[r] === stamp) continue;
      visited[r] = stamp;
      const other = matchOfRight[r]!;
      if (other === -1 || tryAugment(other, stamp)) {
        matchOfRight[r] = l;
        matchOfLeft[l] = r;
        return true;
      }
    }
    return false;
  };

  for (let l = 0; l < adjacency.length; l++) {
    if (matchOfLeft[l] !== -1) continue;
    if (tryAugment(l, l)) size++;
  }
  return { size, matchOfLeft };
}
