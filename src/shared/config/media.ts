/** Local, user-provided Minecraft screenshots shipped with the application. */
export const media = {
  hero: 'worlds/village-lake.webp',
  forest: 'worlds/alpine-lake.webp',
  sunset: 'worlds/sunset-ridge.webp',
  river: 'worlds/forest-river.webp',
  valley: 'worlds/green-valley.webp',
  mountains: 'worlds/pine-mountains.webp',
  desert: 'worlds/sunlit-mountains.webp',
  cherry: 'worlds/cherry-evening.webp'
} as const

export type MediaKey = keyof typeof media
