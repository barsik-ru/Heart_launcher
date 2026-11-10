export const brand = {
  name: 'HEART',
  productName: 'Heart Minecraft Launcher',
  version: '0.3.24',
  server: {
    host: '87.228.56.12',
    port: 25565
  },
  website: 'https://example.com',
  downloadHosts: [
    'cdn.verdant.example',
    'api.modrinth.com',
    'cdn.modrinth.com',
    'meta.fabricmc.net',
    'maven.fabricmc.net',
    'piston-meta.mojang.com',
    'piston-data.mojang.com',
    'resources.download.minecraft.net',
    'libraries.minecraft.net'
  ] as const,
  colors: {
    background: '#0c120e',
    surface: '#141d16',
    panel: '#202d22',
    border: '#354637',
    accent: '#abc98f',
    accentStrong: '#c1dda5',
    text: '#e2e9df'
  },
  game: {
    minecraftVersion: '1.21.11',
    fabricVersion: '0.19.5',
    modpackVersion: '1.21.11',
    javaMajorVersion: 21
  }
} as const

export type BrandConfig = typeof brand