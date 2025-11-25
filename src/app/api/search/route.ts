import { createFromSource } from 'fumadocs-core/search/server'
import { iterationSource } from '@/lib/source'

export const { GET } = createFromSource(iterationSource, {
  language: 'english',
  localeMap: {
    en: 'english',
    ko: 'english', // Fallback to English for Korean
  },
})
