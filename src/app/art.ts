import { Assets, type Texture } from 'pixi.js';

/** Every Pixi texture the game uses. Backgrounds, logo and hero art are DOM images and load separately. */
const NAMES = [
  'sym_thunderbird', 'sym_kraken', 'sym_stag', 'sym_wyrm', 'sym_runestone', 'sym_horn', 'sym_crown',
  'sym_fire', 'sym_water', 'sym_storm', 'sym_earth', 'sym_wild', 'sym_wild_stack', 'sym_moongate', 'sym_door',
  'orb', 'orb_mini', 'orb_minor', 'orb_major', 'orb_grand',
  'badge_doubler', 'badge_collector', 'badge_rowbreaker', 'badge_extraspin',
  'slot_empty', 'coin', 'frame_corner', 'frame_edge',
] as const;
export type ArtName = (typeof NAMES)[number];

const ART: Partial<Record<ArtName, Texture>> = {};

/** Texture for an art name, or undefined if it failed to load (callers fall back to placeholders). */
export const art = (name: ArtName): Texture | undefined => ART[name];

export const artUrl = (file: string) => new URL(`${import.meta.env.VITE_FLAT ? '' : 'art/'}${file}`, document.baseURI).href;

export async function loadArt(onProgress?: (p: number) => void) {
  const total = NAMES.length;
  let done = 0;
  await Promise.all(
    NAMES.map(async (name) => {
      try {
        ART[name] = await Assets.load<Texture>({ alias: name, src: artUrl(`${name}.webp`) });
      } catch {
        // Missing art keeps its placeholder.
      }
      onProgress?.(++done / total);
    }),
  );
}

/** Preload DOM images (backgrounds, logo, hero) so theme switches don't flash. */
export function preloadImages(files: string[]) {
  for (const f of files) {
    const img = new Image();
    img.src = artUrl(f);
  }
}
