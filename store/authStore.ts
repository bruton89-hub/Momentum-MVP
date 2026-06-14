import { create } from "zustand";
import type { UserProfile } from "@/types";

interface AuthState {
  userId: string | null;
  profile: UserProfile | null;
  isLoading: boolean; // true while auth state is being determined
  setUserId: (id: string | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  profile: null,
  isLoading: true,
  setUserId: (userId) => set({ userId }),
  setProfile: (profile) => set({ profile }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () => set({ userId: null, profile: null, isLoading: false }),
}));
