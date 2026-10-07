import { create } from 'zustand'
import type { PulpFeed } from '../types/pulp-feed'
import { db } from '../utils/db'

interface PulpStore {
  pulpFeeds: PulpFeed[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadPulpFeeds: () => Promise<void>
  refreshPulpFeeds: () => Promise<void>
}

export const usePulpStore = create<PulpStore>((set, get) => ({
  pulpFeeds: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadPulpFeeds: async () => {
    if (get().loaded) return
    await get().refreshPulpFeeds()
  },
  refreshPulpFeeds: async () => {
    set({ isLoading: true, error: null })
    try {
      const pulpFeeds = await db.pulpFeeds.orderBy('id').toArray()
      set({ pulpFeeds, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '投料记录读取失败，请检查浏览器存储权限' })
    }
  },
}))
