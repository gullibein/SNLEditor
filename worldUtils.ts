import type { Level, PhysicsState, Assets, AssetType, PlacedAsset, Asset } from './types';
import { THEMES } from './palettes';

// Asset symbol mapping
export const ASSET_SYMBOLS: Record<AssetType, string> = {
  PLAYER: '@',
  PLATFORM: '#',
  SPIKE: '^',
  SPRING: 'v',
  LADDER: 'H',
  TELEPORTER: 'O',
  GEM: '*',
  CHEST: 'C',
  KEY: 'k',
  DOOR: 'D',
  PILL: 'p',
  SLIME: 's',
  PUDDLE: 'w',
  LEVEL_LADDER: 'L',
  BAD_MAN: 'M',
  CRATE: 'B',
};

// Reverse mapping for parsing
const SYMBOL_TO_TYPE: Record<string, AssetType> = Object.entries(ASSET_SYMBOLS).reduce((acc, [type, symbol]) => {
  acc[symbol] = type as AssetType;
  return acc;
}, {} as Record<string, AssetType>);

const TILE_SIZE = 8;
const GAME_WIDTH = 272;
const GAME_HEIGHT = 160;
const LEVEL_WIDTH_TILES = GAME_WIDTH / TILE_SIZE; // 34
const LEVEL_HEIGHT_TILES = GAME_HEIGHT / TILE_SIZE; // 20

interface LevelMetadata {
  playerStart: { x: number; y: number };
  teleporterPairs: Record<number, Array<{ x: number; y: number }>>;
  assetMapping: Record<string, string>;
}

/**
 * Generate a text file representation of the world
 */
export const generateWorldTextFile = (
  levels: Level[],
  physics: PhysicsState,
  theme: string,
  palette: string[],
  assets: Assets
): string => {
  const lines: string[] = [];

  // Physics section
  lines.push('[PHYSICS]');
  lines.push(`playerSpeed=${physics.playerSpeed}`);
  lines.push(`jumpForce=${physics.jumpForce}`);
  lines.push(`friction=${physics.friction}`);
  lines.push(`canJump=${physics.canJump}`);
  lines.push(`gravity=${physics.gravity}`);
  lines.push(`gameSpeed=${physics.gameSpeed}`);
  lines.push('');

  // Theme section
  lines.push('[THEME]');
  lines.push(`name=${theme}`);
  lines.push(`palette=${palette.join(',')}`);
  const themeData = THEMES[theme];
  if (themeData?.screenEffect) {
    lines.push(`screenEffect=${themeData.screenEffect}`);
  }
  lines.push('');

  // Per-level sections
  levels.forEach((level) => {
    lines.push(`[LEVEL:${level.name}]`);

    // Player start position
    lines.push(`playerStart=${level.playerStartPos.x},${level.playerStartPos.y}`);

    // Teleporter pairs - store position -> pairId mapping
    const teleporterPairIds: string[] = [];
    level.levelData.forEach((asset) => {
      const assetDef = assets[asset.assetId];
      if (assetDef?.type === 'TELEPORTER' && asset.teleporterPairId !== undefined) {
        teleporterPairIds.push(`${asset.x},${asset.y}:${asset.teleporterPairId}`);
      }
    });

    if (teleporterPairIds.length > 0) {
      lines.push(`teleporterPairIds=${teleporterPairIds.join('|')}`);
    }

    // Asset mapping (asset ID to asset name)
    const assetMapping = new Map<string, Set<string>>();
    level.levelData.forEach((asset) => {
      if (!assetMapping.has(asset.assetId)) {
        assetMapping.set(asset.assetId, new Set());
      }
      const assetDef = assets[asset.assetId];
      if (assetDef) {
        assetMapping.get(asset.assetId)!.add(assetDef.type);
      }
    });

    if (assetMapping.size > 0) {
      const mappingStr = Array.from(assetMapping.entries())
        .map(([assetId, types]) => `${assetId}:${Array.from(types).join('/')}`)
        .join(',');
      lines.push(`assetMapping=${mappingStr}`);
    }

    // specificAssetIds - store position -> assetId mapping for cases where multiple assets map to the same symbol
    const specificAssetIds: string[] = [];
    level.levelData.forEach((asset) => {
      const assetDef = assets[asset.assetId];
      if (!assetDef) return;

      // Check if this asset ID matches the default one found by type
      // If it doesn't match, or if we want to be explicit, we save it.
      // To be safe and support multiple assets of same type, we save it if it's not the "first" match
      // effectively we just save overrides.
      const defaultId = findAssetIdByType(assets, assetDef.type);
      if (defaultId !== asset.assetId) {
        specificAssetIds.push(`${asset.x},${asset.y}:${asset.assetId}`);
      }
    });

    if (specificAssetIds.length > 0) {
      lines.push(`specificAssetIds=${specificAssetIds.join('|')}`);
    }

    // Create background and overlay grids
    const background: string[][] = [];
    const overlay: string[][] = [];

    for (let y = 0; y < LEVEL_HEIGHT_TILES; y++) {
      const bgRow: string[] = [];
      const ovRow: string[] = [];
      for (let x = 0; x < LEVEL_WIDTH_TILES; x++) {
        bgRow.push('.');
        ovRow.push('.');
      }
      background.push(bgRow);
      overlay.push(ovRow);
    }

    // Place assets on grids
    level.levelData.forEach((asset) => {
      const gridX = Math.floor(asset.x / TILE_SIZE);
      const gridY = Math.floor(asset.y / TILE_SIZE);

      if (gridX < 0 || gridX >= LEVEL_WIDTH_TILES || gridY < 0 || gridY >= LEVEL_HEIGHT_TILES) return;

      const assetDef = assets[asset.assetId];
      if (!assetDef) return;

      const symbol = ASSET_SYMBOLS[assetDef.type];

      // Background layer: platforms and ladders
      if (assetDef.type === 'PLATFORM' || assetDef.type === 'LADDER') {
        background[gridY][gridX] = symbol;
      } else {
        // Overlay layer: everything else
        overlay[gridY][gridX] = symbol;
      }
    });

    // Output grids
    lines.push('background=');
    background.forEach((row) => lines.push(row.join('')));
    lines.push('overlay=');
    overlay.forEach((row) => lines.push(row.join('')));
    lines.push('');
  });

  return lines.join('\n');
};

/**
 * Parse a world text file back to levels, physics, and theme
 */
export const parseWorldTextFile = (
  text: string,
  assets: Assets
): { levels: Level[]; physics: PhysicsState; theme: string; palette: string[] } | null => {
  try {
    const lines = text.split('\n');
    console.log('parseWorldTextFile: Total lines:', lines.length);
    console.log('First 5 lines:', lines.slice(0, 5));
    let i = 0;

    const physics: Partial<PhysicsState> = {};
    let theme = 'vga';
    let palette = THEMES['vga'].palette;
    const levels: Level[] = [];

    // Parse sections
    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.startsWith('[')) {
        console.log(`Found section at line ${i}: ${line}`);
      }
      i++;

      if (line === '[PHYSICS]') {
        while (i < lines.length && lines[i].trim() && !lines[i].startsWith('[')) {
          const [key, value] = lines[i].trim().split('=');
          if (key === 'playerSpeed') physics.playerSpeed = parseFloat(value);
          else if (key === 'jumpForce') physics.jumpForce = parseFloat(value);
          else if (key === 'friction') physics.friction = parseFloat(value);
          else if (key === 'canJump') physics.canJump = value === 'true';
          else if (key === 'gravity') physics.gravity = parseFloat(value);
          else if (key === 'gameSpeed') physics.gameSpeed = parseFloat(value);
          i++;
        }
      } else if (line === '[THEME]') {
        while (i < lines.length && lines[i].trim() && !lines[i].startsWith('[')) {
          const [key, ...valueParts] = lines[i].trim().split('=');
          const value = valueParts.join('=');
          if (key === 'name') theme = value;
          else if (key === 'palette') palette = value.split(',');
          i++;
        }
      } else if (line.startsWith('[LEVEL:')) {
        const levelName = line.slice(7, -1); // Extract name between [LEVEL: and ]
        const levelData: PlacedAsset[] = [];
        let playerStartPos = { x: 0, y: 0 };
        const teleporterMap = new Map<string, Array<{ x: number; y: number }>>();
        const teleporterPairIdMap = new Map<string, number>(); // position (x,y) -> pairId
        const assetNameMap = new Map<string, AssetType>();

        const specificAssetIdMap = new Map<string, string>(); // position (x,y) -> assetId

        // Parse level metadata
        while (i < lines.length && lines[i].trim() && !lines[i].startsWith('background=')) {
          const [key, ...valueParts] = lines[i].trim().split('=');
          const value = valueParts.join('=');

          if (key === 'playerStart') {
            const [x, y] = value.split(',').map(Number);
            playerStartPos = { x, y };
          } else if (key === 'teleporterPairIds') {
            // x,y:pairId|x,y:pairId|...
            if (value && value.trim()) {
              const entries = value.split('|');
              entries.forEach((entry) => {
                if (entry && entry.trim()) {
                  const [coords, pairIdStr] = entry.split(':');
                  if (coords && pairIdStr) {
                    teleporterPairIdMap.set(coords, parseInt(pairIdStr));
                  }
                }
              });
            }
          } else if (key === 'specificAssetIds') {
            if (value && value.trim()) {
              const entries = value.split('|');
              entries.forEach((entry) => {
                if (entry && entry.trim()) {
                  const [coords, assetId] = entry.split(':');
                  if (coords && assetId) {
                    specificAssetIdMap.set(coords, assetId);
                  }
                }
              });
            }
          } else if (key === 'assetMapping') {
            if (value && value.trim()) {
              const entries = value.split(',');
              entries.forEach((entry) => {
                if (entry && entry.trim()) {
                  const [assetId, types] = entry.split(':');
                  if (assetId && types) {
                    const typeList = types.split('/');
                    // Store the first type or most common
                    if (typeList.length > 0) {
                      const type = typeList[0] as AssetType;
                      assetNameMap.set(assetId, type);
                    }
                  }
                }
              });
            }
          }
          i++;
        }

        // Parse background grid
        const background: string[][] = [];
        i++; // Skip 'background='
        while (i < lines.length && lines[i].trim() && !lines[i].startsWith('overlay=')) {
          background.push(lines[i].trim().split(''));
          i++;
        }

        // Parse overlay grid
        const overlay: string[][] = [];
        i++; // Skip 'overlay='
        while (i < lines.length && lines[i].trim() && !lines[i].startsWith('[')) {
          overlay.push(lines[i].trim().split(''));
          i++;
        }

        // Reconstruct level data from grids
        background.forEach((row, y) => {
          row.forEach((symbol, x) => {
            if (symbol !== '.') {
              const assetType = SYMBOL_TO_TYPE[symbol];
              if (assetType) {
                // Check for specific asset override
                const coordsKey = `${x * TILE_SIZE},${y * TILE_SIZE}`;
                let assetId = specificAssetIdMap.get(coordsKey);

                if (!assetId) {
                  assetId = findAssetIdByType(assets, assetType);
                }

                if (assetId) {
                  levelData.push({
                    id: `${assetId}-${x}-${y}-${Math.random()}`,
                    assetId,
                    x: x * TILE_SIZE,
                    y: y * TILE_SIZE,
                  });
                }
              }
            }
          });
        });

        // Process overlay
        console.log('Teleporter pair ID map:', teleporterPairIdMap);

        overlay.forEach((row, y) => {
          row.forEach((symbol, x) => {
            if (symbol !== '.') {
              const assetType = SYMBOL_TO_TYPE[symbol];
              if (assetType) {
                // Check for specific asset override
                const coordsKey = `${x * TILE_SIZE},${y * TILE_SIZE}`;
                let assetId = specificAssetIdMap.get(coordsKey);

                if (!assetId) {
                  assetId = findAssetIdByType(assets, assetType);
                }

                if (assetId) {
                  const placedAsset: PlacedAsset = {
                    id: `${assetId}-${x}-${y}-${Math.random()}`,
                    assetId,
                    x: x * TILE_SIZE,
                    y: y * TILE_SIZE,
                  };

                  // Assign teleporter pair ID if applicable
                  if (assetType === 'TELEPORTER') {
                    // Try new format first (direct position mapping)
                    const coordsKey = `${placedAsset.x},${placedAsset.y}`;
                    const pairId = teleporterPairIdMap.get(coordsKey);
                    if (pairId !== undefined) {
                      console.log(`Teleporter at (${placedAsset.x}, ${placedAsset.y}) assigned pair ID: ${pairId}`);
                      placedAsset.teleporterPairId = pairId;
                    } else {
                      // Fallback to old format matching for backwards compatibility
                      const pairEntry = Array.from(teleporterMap.entries()).find(([_, positions]) =>
                        positions.some((p) => p.x === placedAsset.x && p.y === placedAsset.y)
                      );
                      if (pairEntry) {
                        const fallbackPairId = parseInt(pairEntry[0].replace('tp', ''));
                        console.log(`Teleporter at (${placedAsset.x}, ${placedAsset.y}) assigned pair ID (fallback): ${fallbackPairId}`);
                        placedAsset.teleporterPairId = fallbackPairId;
                      }
                    }
                  }

                  levelData.push(placedAsset);
                }
              }
            }
          });
        });

        levels.push({
          id: `level-${Date.now()}-${Math.random()}`,
          name: levelName,
          levelData,
          playerStartPos,
        });
      }
    }

    // Ensure all physics values are present with defaults
    const finalPhysics: PhysicsState = {
      playerSpeed: physics.playerSpeed ?? 1.5,
      jumpForce: physics.jumpForce ?? -2.0,
      friction: physics.friction ?? 0.35,
      canJump: physics.canJump ?? true,
      gravity: physics.gravity ?? 0.25,
      gameSpeed: physics.gameSpeed ?? 0.75,
    };

    return { levels, physics: finalPhysics, theme, palette };
  } catch (error) {
    console.error('Error parsing world text file:', error);
    return null;
  }
};

/**
 * Find an asset ID by its type
 */
const findAssetIdByType = (assets: Assets, type: AssetType): string | null => {
  for (const [id, asset] of Object.entries(assets)) {
    if (asset.type === type) {
      return id;
    }
  }
  return null;
};

/**
 * Export world data as JSON (for metadata storage in InstantDB)
 */
export const exportWorldMetadata = (
  worldName: string,
  levels: Level[],
  physics: PhysicsState,
  theme: string,
  palette: string[]
) => {
  return JSON.stringify({
    name: worldName,
    levelCount: levels.length,
    physics: { gravity: physics.gravity, gameSpeed: physics.gameSpeed },
    theme,
    createdAt: Date.now(),
  });
};
