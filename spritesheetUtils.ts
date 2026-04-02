import type { Assets, Asset, PixelData } from './types';
import { TILE_SIZE } from './constants';
import { THEMES } from './palettes';

// Master palette for consistent color rendering
const masterPalette = THEMES['pixel-pro'].palette;

/**
 * Generates a PNG spritesheet from assets where each animation type gets its own row.
 * Static assets (no animations) get a single row with one frame.
 *
 * Layout:
 * - Each asset is stacked vertically
 * - For animated assets, each animation type is a separate row
 * - Frames within an animation are laid out horizontally
 *
 * The PNG also encodes metadata in a JSON header comment for reconstruction.
 */
export function generateSpritesheetPNG(assets: Assets, palette: string[]): { blob: Blob; metadata: SpritesheetMetadata } {
  // Calculate dimensions and build metadata
  const metadata: SpritesheetMetadata = {
    version: 1,
    tileSize: TILE_SIZE,
    assets: [],
  };

  let totalRows = 0;
  let maxFramesInAnyRow = 1;

  // First pass: calculate dimensions and gather metadata
  for (const assetId of Object.keys(assets)) {
    const asset = assets[assetId];
    const assetMeta: AssetMetadata = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      animationFps: asset.animationFps,
      rows: [],
    };

    if (asset.animations && Object.keys(asset.animations).length > 0) {
      // Animated asset - one row per animation type
      for (const animType of Object.keys(asset.animations)) {
        const frames = asset.animations[animType];
        assetMeta.rows.push({
          animationType: animType,
          frameCount: frames.length,
          rowIndex: totalRows,
        });
        maxFramesInAnyRow = Math.max(maxFramesInAnyRow, frames.length);
        totalRows++;
      }
    } else {
      // Static asset - single row with one frame
      assetMeta.rows.push({
        animationType: 'STATIC',
        frameCount: 1,
        rowIndex: totalRows,
      });
      totalRows++;
    }

    metadata.assets.push(assetMeta);
  }

  // Calculate canvas dimensions
  const width = maxFramesInAnyRow * TILE_SIZE;
  const height = totalRows * TILE_SIZE;

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Fill with transparent background
  ctx.clearRect(0, 0, width, height);

  // Second pass: draw all sprites
  let currentRow = 0;
  for (const assetId of Object.keys(assets)) {
    const asset = assets[assetId];

    if (asset.animations && Object.keys(asset.animations).length > 0) {
      // Draw each animation type as a row
      for (const animType of Object.keys(asset.animations)) {
        const frames = asset.animations[animType];
        for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
          const frameData = frames[frameIdx];
          drawSprite(ctx, frameData, frameIdx * TILE_SIZE, currentRow * TILE_SIZE, palette);
        }
        currentRow++;
      }
    } else {
      // Draw static sprite
      drawSprite(ctx, asset.data, 0, currentRow * TILE_SIZE, palette);
      currentRow++;
    }
  }

  // Convert to blob
  const dataUrl = canvas.toDataURL('image/png');
  const blob = dataURLToBlob(dataUrl);

  return { blob, metadata };
}

/**
 * Parses a spritesheet PNG and metadata back into Assets
 */
export async function parseSpritesheetPNG(
  imageBlob: Blob,
  metadata: SpritesheetMetadata,
  existingAssets?: Assets
): Promise<Assets> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const assets: Assets = existingAssets ? { ...existingAssets } : {};

      for (const assetMeta of metadata.assets) {
        const animations: { [key: string]: PixelData[] } = {};
        let mainData: PixelData = [];

        for (const rowMeta of assetMeta.rows) {
          const frames: PixelData[] = [];
          for (let frameIdx = 0; frameIdx < rowMeta.frameCount; frameIdx++) {
            const frameData = extractSprite(
              ctx,
              frameIdx * TILE_SIZE,
              rowMeta.rowIndex * TILE_SIZE,
              TILE_SIZE
            );
            frames.push(frameData);
          }

          if (rowMeta.animationType === 'STATIC') {
            mainData = frames[0];
          } else {
            animations[rowMeta.animationType] = frames;
            // Use first frame of first animation as main data
            if (mainData.length === 0) {
              mainData = frames[0];
            }
          }
        }

        assets[assetMeta.id] = {
          id: assetMeta.id,
          name: assetMeta.name,
          type: assetMeta.type,
          data: mainData,
          animationFps: assetMeta.animationFps,
          animations: Object.keys(animations).length > 0 ? animations : undefined,
        };
      }

      resolve(assets);
    };

    img.onerror = () => reject(new Error('Failed to load spritesheet image'));
    img.src = URL.createObjectURL(imageBlob);
  });
}

/**
 * Draws a single sprite to the canvas
 */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  spriteData: PixelData,
  dx: number,
  dy: number,
  palette: string[]
): void {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const colorIndex = spriteData[y]?.[x] ?? 0;
      if (colorIndex > 0) {
        // Use master palette for consistent colors across themes
        ctx.fillStyle = masterPalette[colorIndex] || palette[colorIndex] || '#FF00FF';
        ctx.fillRect(dx + x, dy + y, 1, 1);
      }
    }
  }
}

/**
 * Extracts pixel data from the canvas at the specified position
 */
function extractSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  size: number
): PixelData {
  const imageData = ctx.getImageData(sx, sy, size, size);
  const data: PixelData = [];

  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const a = imageData.data[idx + 3];

      if (a === 0) {
        row.push(0); // Transparent
      } else {
        // Find closest color in master palette
        const colorIndex = findClosestPaletteColor(r, g, b, masterPalette);
        row.push(colorIndex);
      }
    }
    data.push(row);
  }

  return data;
}

/**
 * Find the closest matching color in the palette
 */
function findClosestPaletteColor(r: number, g: number, b: number, palette: string[]): number {
  let bestIndex = 1;
  let bestDistance = Infinity;

  for (let i = 1; i < palette.length; i++) {
    const hex = palette[i];
    if (!hex || hex === '#00000000') continue;

    const pr = parseInt(hex.slice(1, 3), 16);
    const pg = parseInt(hex.slice(3, 5), 16);
    const pb = parseInt(hex.slice(5, 7), 16);

    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Convert data URL to Blob
 */
function dataURLToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(parts[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

// Metadata types
export interface SpritesheetMetadata {
  version: number;
  tileSize: number;
  assets: AssetMetadata[];
}

export interface AssetMetadata {
  id: string;
  name: string;
  type: string;
  animationFps?: number;
  rows: RowMetadata[];
}

export interface RowMetadata {
  animationType: string;
  frameCount: number;
  rowIndex: number;
}
