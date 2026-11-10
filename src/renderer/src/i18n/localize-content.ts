import type { NewsArticle } from '@shared/types'
import type { Language } from './translations'

const demoArticles: Record<string, { title: string; excerpt: string; content: string }> = {
  '1': {
    title: 'Fabric API, Sodium and Lithium updated',
    excerpt: 'Three core components of the Fabric client were updated in pack 1.4.2. The Legacy Tweaks mod was removed.',
    content: 'Fabric API, Sodium and Lithium have been updated in version 1.4.2. Legacy Tweaks has been removed from the client. The full changelog and installation options are available on the modpack page.'
  },
  '2': {
    title: 'Ambient Environment and BetterF3 added',
    excerpt: 'Two new mods are now part of client pack 1.4.2. The performance profile was also revised.',
    content: 'Ambient Environment and BetterF3 have been added to client pack 1.4.2. Performance profiles and render distance settings have also been adjusted.'
  },
  '3': {
    title: 'Client performance profile updated',
    excerpt: 'Render distance settings and the client performance profile have been revised.',
    content: 'The configuration pack now includes updated render distance settings and a revised performance profile. Current values are listed on the modpack page.'
  }
}

export function localizeArticle(article: NewsArticle, language: Language): NewsArticle {
  if (language !== 'en') return article
  const translation = demoArticles[article.id]
  return translation ? { ...article, ...translation } : article
}

const errorTranslations: Array<[string, string]> = [
  ['Неверный логин или пароль для DEMO-аккаунта.', 'Incorrect username or password for the demo account.'],
  ['Этот логин уже зарегистрирован в текущей DEMO-сессии.', 'This username is already registered in the current demo session.'],
  ['Этот ник уже сохранён в локальных профилях Heart Launcher. Войди в существующий профиль вместо повторной регистрации.', 'This nickname is already saved in local Heart Launcher profiles. Sign in to the existing profile instead of registering again.'],
  ['Другая операция уже выполняется.', 'Another operation is already in progress.'],
  ['Нет активной сессии.', 'There is no active session.'],
  ['Microsoft OAuth не подключён в этой версии.', 'Microsoft sign-in is not connected in this version.'],
  ['Привязка Microsoft не подключена.', 'Microsoft account linking is not connected.'],
  ['Восстановление пароля появится после подключения backend API.', 'Password recovery will be available when the backend API is connected.'],
  ['Операция отменена', 'Operation cancelled'],
  ['Неизвестная ошибка', 'Unknown error'],
  ['Сервис недоступен: подключите backend adapter или включите DEMO в development.', 'Service unavailable: configure the backend adapter or enable DEMO in development.'],
  ['Backend API не подключён', 'Backend API is not connected'],
  ['Launcher engine не подключён.', 'The launcher engine is not connected.'],
  ['Проверка не выполнена.', 'Verification did not complete.'],
  ['Демо-режим: проверка завершена, файлы не изменялись.', 'Demo mode: verification finished; no files were changed.'],
  ['Сервис пока не подключён. Это приложение подготовлено к интеграции с backend API.', 'This service is not connected yet. The app is prepared for backend API integration.'],
  ['Backend API вернул некорректный список новостей.', 'The backend API returned an invalid news list.'],
  ['Не удалось получить сведения о сборке.', 'Could not retrieve modpack details.'],
  ['Не удалось открыть демонстрационный профиль.', 'Could not open the demo profile.'],
  ['Демонстрационные показатели', 'Demo server metrics'],
  ['Microsoft OAuth будет подключён отдельным безопасным этапом.', 'Microsoft sign-in will be added in a separate secure step.'],
  ['Launcher API не подключён.', 'Launcher API is not connected.'],
  ['Updater provider не подключён.', 'Updater provider is not connected.']
]

export function localizeError(message: string, language: Language): string {
  if (language !== 'en') return message
  let translated = message
  for (const [source, target] of errorTranslations) {
    translated = translated.replaceAll(source, target)
  }
  return translated
}
