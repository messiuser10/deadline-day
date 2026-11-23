import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ResultsView, SeasonView } from '@deadline-day/protocol';
import { get } from '../lib/api';
import { indexSeason } from '../lib/season';

/** A stored season never changes, so it is fetched once per game and season number. */
export function useSeasonView(code: string, number: number) {
  const q = useQuery({
    queryKey: ['season', code, number],
    queryFn: () => get<{ season: SeasonView }>(`/api/games/${code}/season?number=${number}`).then((r) => r.season),
    staleTime: Infinity,
  });
  const index = useMemo(() => (q.data ? indexSeason(q.data) : null), [q.data]);
  return { ...q, index };
}

export function useResults(code: string, number: number, enabled = true) {
  return useQuery({
    queryKey: ['results', code, number],
    queryFn: () => get<{ results: ResultsView }>(`/api/games/${code}/results?number=${number}`).then((r) => r.results),
    staleTime: 60_000,
    enabled,
  });
}
