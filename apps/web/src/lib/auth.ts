import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuestInput, LoginInput, PublicSettings, RegisterInput, UserView } from '@deadline-day/protocol';
import { get, post } from './api';
import { reconnectSocket } from './socket';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await get<{ user: UserView | null }>('/api/auth/me')).user,
    staleTime: 60_000,
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['public-settings'],
    queryFn: () => get<PublicSettings>('/api/settings/public'),
    staleTime: 5 * 60_000,
  });
}

function useAuthMutation<I>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: I) => (await post<{ user: UserView | null }>(path, input)).user,
    onSuccess: (user) => {
      qc.setQueryData(['me'], user);
      reconnectSocket();
    },
  });
}

export const useLogin = () => useAuthMutation<LoginInput>('/api/auth/login');
export const useRegister = () => useAuthMutation<RegisterInput>('/api/auth/register');
export const useGuest = () => useAuthMutation<GuestInput>('/api/auth/guest');
export const useLogout = () => useAuthMutation<Record<string, never>>('/api/auth/logout');
