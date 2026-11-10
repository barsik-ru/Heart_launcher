import { useAppStore } from '../stores/app-store'
import { translations } from './translations'

export function useTranslation() {
  const language = useAppStore(state => state.settings?.language ?? 'ru')
  const dictionary = translations[language]

  const tr = (russian: string, english: string): string =>
    language === 'en' ? english : russian

  return { ...dictionary, locale: language, tr }
}
