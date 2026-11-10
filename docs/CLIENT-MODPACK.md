# Heart — клиентская Fabric-сборка

## Источник и обновление

Heart не требует опубликованного Modrinth-профиля или `.mrpack`. Каталог находится в `src/main/services/minecraft/modrinth-modpack.ts`. На установке лаунчер запрашивает Modrinth API и выбирает последний `release` для `Minecraft 1.21.11` + `Fabric`. Обязательные зависимости разрешаются автоматически.

## Клиентский allowlist

### Клиентские функции и визуальные эффекты

- AmbientSounds
- Cosy Critters & Creepy Crawlies
- Falling Leaves
- Particle Rain
- Presence Footsteps
- Visuality
- Sound Physics Remastered
- Iris Shaders + Sodium
- Entity Culling
- ImmediatelyFast
- Dynamic FPS
- Mod Menu

### Производительность и общий контент

- FerriteCore — полезен и клиенту, и серверу
- Lithium — полезен клиентскому интегрированному серверу и backend; клиенту разрешена независимая установка
- Alex's Mobs Continued — общий контент, также должен быть на сервере
- Immersive Ores — общий контент, также должен быть на сервере
- Traveler's Backpack — общий контент, требуется клиенту и серверу

### Библиотеки

- Fabric API
- Fabric Language Kotlin
- Cloth Config
- CreativeCore
- Другие обязательные зависимости, полученные из метаданных версий Modrinth (например, CodxLib, Kirin UI или Player Ability Lib, если они объявлены как required)

## Исключено из клиента

- Chunky — генерация чанков / администрирование backend
- Flan — серверные claims / защита территорий
- Ledger — серверный журнал действий
- LuckPerms — серверная система прав
- Vanilla Permissions — серверная система прав
- GrimAC — серверный античит
- FabricProxy-Lite — мост Fabric backend ↔ Velocity
- Terralith, Infinity Cave, Lithostitched и AdoraBuild Structures — серверная генерация мира и структуры

Список исключений — пояснение архитектуры, не команда автоматически удалять файлы пользователя. Лаунчер управляет только своими JAR-файлами, перечисленными в `heart-launcher/client-mods.json`.

## Безопасность загрузок

- Modrinth API запрашивается по HTTPS.
- Файлы разрешены только с `cdn.modrinth.com`.
- Проверяются имя `.jar`, размер и доступные SHA-1/SHA-512.
- Скачивание сначала идёт во временный `.part`; только после успешной проверки файл атомарно переносится в `mods/`.
- Текущий состав сборки и установленные версии записываются в `heart-launcher/client-mods.json`.

## Важная оговорка по версиям backend

На сервере в предоставленном списке указаны Alex's Mobs Continued 2.2.4 и CodxLib 1.6.1. На Modrinth для Fabric 1.21.11 сейчас доступны Alex's Mobs Continued 2.2.2+1.21.11 и CodxLib 1.6.0+fabric-1.21.11. Это патч-расхождение: оба файла подходят для Minecraft 1.21.11, но я не могу гарантировать сетевую совместимость без проверки на самом сервере. Для полной идентичности нужно подключить CurseForge provider и зафиксировать точные серверные JAR-файлы. Не изменяйте серверные версии ради клиента до успешного теста подключения.

## Локальная разработка

1. Распаковать проект.
2. В корне выполнить `npm install`.
3. Выполнить `npm run typecheck`.
4. Запустить `npm run dev`.
5. На главной странице нажать «Скачать и играть». Лаунчер автоматически подготовит Java 21, Minecraft, Fabric, библиотеки, ассеты и клиентские моды, после чего запустит игру.

Для production-сборки отдельно потребуются настройка реальной авторизации и проверка запуска JVM с нативными библиотеками на целевой Windows-системе.

### Server-only dependencies (HeartBridge hotfix)

Modrinth dependencies marked `client_side: unsupported` are now skipped by the client resolver, even when a parent project lists them as a required dependency. They must be installed on the dedicated Fabric backend when required by that backend mod. In the current pack, CodxLib is a server-side dependency of Alex's Mobs Continued: install the compatible CodxLib 1.6.0 Fabric 1.21.11 JAR in the backend `survival/mods` folder, not in the launcher-managed client `mods` folder.
