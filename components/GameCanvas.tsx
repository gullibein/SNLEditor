
import React, { useRef, useEffect, useCallback, useState, MouseEvent, useMemo } from 'react';
import {
    GAME_WIDTH,
    GAME_HEIGHT,
    TILE_SIZE,
    GRAVITY,
    MAX_FALL_SPEED,
    SPRING_BOUNCE_MULTIPLIER,
    LADDER_CLIMB_SPEED,
    LADDER_HORIZONTAL_SPEED,
} from '../constants';
import { THEMES } from '../palettes';
import type { GameMode, Assets, PlayerState, PixelData, PhysicsState, PlacedAsset, Asset, ColorTheme, AssetType, Level, EnemyState, PlayerAnimationState, EnemyAnimationState, PuddleState, BadManState, CrateState } from '../types';
import {
    initAudio, playJumpSound, playLandSound, playCollectSound, playDeathSound,
    playWinSound, playTeleportSound, playSpringSound, playDoorOpenSound, playPowerDownSound, playRetroClickSound
} from '../sounds';
import { drawText, getTextWidth } from '../font';
import { updatePuddle } from './puddleUtils';
import { updateBadMan } from './badManUtils'; // Import Bad Man Logic
import { BAD_MAN_SPEED, BAD_MAN_JUMP_FORCE } from '../constants';

interface GameCanvasProps {
    mode: GameMode;
    assets: Assets;
    playerAsset: Asset;
    physics: PhysicsState;
    palette: string[];
    level: Level;
    levels: Level[];
    onCommitChanges: (changes: { x: number, y: number, assetId: string | null, rotation?: number }[]) => void;
    selectedAssetId: string;
    errorMessage: string | null;
    onPlayerStartChange: (x: number, y: number) => void;
    onMoveAsset: (assetIdToMove: string, newX: number, newY: number) => void;
    theme: string;
    currentLevelIndex: number;
    onLevelComplete: () => void;
    isLastLevel: boolean;
}

const EASE_DURATION_FRAMES = 30;
const PAUSE_DURATION_FRAMES = 12;
const MID_PAUSE_DURATION_FRAMES = 7;
const PUDDLE_SPEED = 0.5;
const PUDDLE_TURN_FRAMES = 20; // Time to change direction
const PUDDLE_DROP_FRAMES = 30; // Time to hang before dropping
const CORNER_CORRECTION = 4; // Pixels to allow for corner sliding (half a tile)
const PUSH_INTENT_FRAMES = 10; // Frames player must hold toward crate before pushing starts (~167ms)

const easeInQuad = (t: number) => t * t;
const easeOutQuad = (t: number) => t * (2 - t);

const TARGET_FPS = 60;
const TIME_STEP = 1000 / TARGET_FPS;
const MAX_DELTA_TIME = 250;
const GAME_SPEED_MULTIPLIER = 0.75; // Slower game speed

// Color constants used in drawSprite retro mode
const WHITE = "#FFFFFF";
const LIGHT_GRAY = "#C0C0C0";
const BLACK = "#000000";


const useGameInput = () => {
    const keys = useRef({ left: false, right: false, up: false, down: false, space: false, backspace: false });
    useEffect(() => {
        const handleKey = (e: KeyboardEvent, isDown: boolean) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            switch (e.code) {
                case 'ArrowLeft': case 'KeyA': keys.current.left = isDown; break;
                case 'ArrowRight': case 'KeyD': keys.current.right = isDown; break;
                case 'ArrowUp': case 'KeyW': keys.current.up = isDown; break;
                case 'ArrowDown': case 'KeyS': keys.current.down = isDown; break;
                case 'Space': keys.current.space = isDown; if (isDown) e.preventDefault(); break;
                case 'Backspace': case 'Delete': keys.current.backspace = isDown; if (isDown) e.preventDefault(); break;
            }
        };
        const down = (e: KeyboardEvent) => handleKey(e, true);
        const up = (e: KeyboardEvent) => handleKey(e, false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, []);
    return keys.current;
};

const isAssetMovable = (asset: Asset | undefined): boolean => {
    if (!asset) return false;
    return asset.type !== 'PLATFORM' && asset.type !== 'LADDER';
};

const getSpriteForState = (asset: Asset, animationState: string, animationFrame: number): PixelData => {
    const anims = asset.animations;
    let animData: PixelData[] | undefined;
    if (anims) {
        animData = anims[animationState];
    }
    if (!animData || animData.length === 0) animData = [asset.data];
    const frameIndex = animationFrame % animData.length;
    return animData[frameIndex];
}

const getSourceCoordinates = (x: number, y: number, rotation: number, width: number, height: number) => {
    // Inverse mapping for rotation on 8x8 grid (0-7 index)
    const s = width - 1;
    switch (rotation) {
        case 90: return { x: y, y: s - x };
        case 180: return { x: s - x, y: s - y };
        case 270: return { x: s - y, y: x };
        default: return { x, y };
    }
}

const checkPixelCollision = (
    asset1: Asset,
    state1: { x: number; y: number; animationState: string; animationFrame: number; facingDirection: -1 | 1 },
    asset2: Asset,
    state2: { x: number; y: number; animationState?: string; animationFrame?: number; facingDirection?: -1 | 1, rotation?: number }
): boolean => {
    // 1. Fast AABB Check
    if (state1.x >= state2.x + TILE_SIZE || state1.x + TILE_SIZE <= state2.x ||
        state1.y >= state2.y + TILE_SIZE || state1.y + TILE_SIZE <= state2.y) {
        return false;
    }

    // 2. Pixel Perfect Check
    const sprite1 = getSpriteForState(asset1, state1.animationState, state1.animationFrame);
    const sprite2 = getSpriteForState(asset2, state2.animationState || 'IDLE', state2.animationFrame || 0);

    const xMin = Math.max(state1.x, state2.x);
    const xMax = Math.min(state1.x + TILE_SIZE, state2.x + TILE_SIZE);
    const yMin = Math.max(state1.y, state2.y);
    const yMax = Math.min(state1.y + TILE_SIZE, state2.y + TILE_SIZE);

    let overlapPixels = 0;

    for (let y = yMin; y < yMax; y++) {
        for (let x = xMin; x < xMax; x++) {
            // -- Player Pixel (Asset 1) --
            let localX1 = Math.floor(x - state1.x);
            let localY1 = Math.floor(y - state1.y);

            // Handle Horizontal Flip
            if (state1.facingDirection === -1) {
                localX1 = (TILE_SIZE - 1) - localX1;
            }

            if (localX1 < 0 || localX1 >= TILE_SIZE || localY1 < 0 || localY1 >= TILE_SIZE) continue;
            const p1 = sprite1[localY1][localX1];

            if (p1 === 0) continue; // Player pixel is transparent

            // -- Enemy/Hazard Pixel (Asset 2) --
            let localX2 = Math.floor(x - state2.x);
            let localY2 = Math.floor(y - state2.y);

            // Handle Rotation (Puddles)
            if (state2.rotation) {
                const rotated = getSourceCoordinates(localX2, localY2, state2.rotation, TILE_SIZE, TILE_SIZE);
                localX2 = rotated.x;
                localY2 = rotated.y;
            }

            // Handle Horizontal Flip (Enemies)
            if (state2.facingDirection === -1) {
                localX2 = (TILE_SIZE - 1) - localX2;
            }

            if (localX2 < 0 || localX2 >= TILE_SIZE || localY2 < 0 || localY2 >= TILE_SIZE) continue;
            const p2 = sprite2[localY2][localX2];

            if (p2 !== 0) {
                overlapPixels++;
                // Forgive 1 pixel of overlap (grazing)
                if (overlapPixels > 1) return true;
            }
        }
    }

    return false;
};

// --- Puddle AI: Graph-based Navigation ---


// --- Optimized Spatial Grid Types ---
const TILES_X = GAME_WIDTH / TILE_SIZE;
const TILES_Y = GAME_HEIGHT / TILE_SIZE;
type SpatialGrid = (PlacedAsset[] | undefined)[];

const getGridIndex = (gx: number, gy: number): number => {
    if (gx < 0 || gx >= TILES_X || gy < 0 || gy >= TILES_Y) return -1;
    return gy * TILES_X + gx;
};



const GameCanvas: React.FC<GameCanvasProps> = ({ mode, assets, playerAsset, physics, palette, level, levels, onCommitChanges, selectedAssetId, errorMessage, onPlayerStartChange, onMoveAsset, theme, currentLevelIndex, onLevelComplete, isLastLevel }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rotateIconRef = useRef<HTMLImageElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animationFrameId = useRef<number>();
    const gameLoopFrameCount = useRef(0);
    const prevMode = useRef(mode);
    const [localLevelData, setLocalLevelData] = useState<PlacedAsset[]>(level.levelData);

    const lastFrameTime = useRef<number>(0);
    const accumulator = useRef<number>(0);

    // Helper to get the correct preview sprite for assets
    // This ensures that for animated assets (Player, Slime, Puddle), we show the first frame of their main animation
    // instead of the static 'data' which might be outdated or default.
    const getPreviewSprite = useCallback((asset: Asset | undefined): PixelData => {
        if (!asset) return Array(TILE_SIZE).fill(0).map(() => Array(TILE_SIZE).fill(0));

        if (asset.type === 'PLAYER' && asset.animations?.IDLE?.[0]) {
            return asset.animations.IDLE[0];
        } else if ((asset.type === 'SLIME' || asset.type === 'PUDDLE') && asset.animations?.WALKING?.[0]) {
            return asset.animations.WALKING[0];
        }

        return asset.data;
    }, []);

    useEffect(() => { setLocalLevelData(level.levelData); }, [level.levelData]);

    // Preload the rotate icon image
    useEffect(() => {
        const img = new Image();
        img.src = '/R-icon.png';
        img.onload = () => {
            rotateIconRef.current = img;
        };
        img.onerror = () => {
            console.warn('Failed to load rotate icon image');
        };
    }, []);

    const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null);
    const [dragState, setDragState] = useState<{ asset: PlacedAsset, isPlayer: boolean, offsetX: number, offsetY: number } | null>(null);
    const [editSquarePos, setEditSquarePos] = useState(level.playerStartPos);

    const [levelDuringAction, setLevelDuringAction] = useState<PlacedAsset[] | null>(null);
    const affectedCoordsInAction = useRef<Set<string>>(new Set());

    const [puddleRotation, setPuddleRotation] = useState<number>(0); // 0=top, 90=right, 180=bottom, 270=left
    const editorActionState = useRef<'none' | 'drawing' | 'erasing' | 'movingAsset'>('none');
    const keyboardStrokeRef = useRef<{ x: number, y: number, assetId: string | null }[] | null>(null);
    const mouseDownInfo = useRef<{ time: number, x: number, y: number, asset: PlacedAsset | null } | null>(null);

    const introStartTimeRef = useRef<number>(mode === 'PLAY' ? Date.now() : 0);
    const inputGraceRef = useRef(0); // frames to ignore player input after intro ends
    const typewriterTickRef = useRef(0); // frame counter for typewriter pacing
    const [gameState, setGameState] = useState<'playing' | 'dead' | 'won' | 'paused' | 'level_intro'>(
        mode === 'PLAY' ? 'level_intro' : 'playing'
    );
    const [isFontLoaded, setIsFontLoaded] = useState(false);
    const pauseMenuSelectionRef = useRef<0 | 1>(0);
    const typewriterIndexRef = useRef(0);
    const typewriterCompleteRef = useRef(false);
    const prevModeForIntro = useRef<GameMode>(mode);
    const enemyStatesRef = useRef<EnemyState[]>([]);
    const puddleStatesRef = useRef<PuddleState[]>([]);
    const badManStatesRef = useRef<BadManState[]>([]);
    const crateStatesRef = useRef<CrateState[]>([]);
    const teleporterHistoryRef = useRef<{ id: string, exitId: string, entryTime: number }[]>([]);
    const prevInput = useRef({ left: false, right: false, up: false, down: false, space: false, backspace: false });

    const themeInfo: Partial<ColorTheme> = THEMES[theme] || {};

    const playerRef = useRef<PlayerState>({
        x: level.playerStartPos.x, y: level.playerStartPos.y, vx: 0, vy: 0, onGround: false, isClimbing: false,
        currentLadderId: null, targetX: null, targetY: null, teleportCooldown: 0, jumpCooldown: 0,
        ladderSwitchCooldown: 0, ladderGrabCooldown: 0, ladderSidewaysCooldown: 0, collisionDisabledCooldown: 0, isSwitchingLadders: false,
        isDetaching: false, isDismounting: false, justDismountedCooldown: 0, switchVerticalDirection: 0,
        width: TILE_SIZE, height: TILE_SIZE, dying: 0, isDead: false, isInvincible: false,
        hasWon: false, wasTouchingHazard: false, hasKey: false, isSpikeImmune: false, spikeImmuneCooldown: 0, lastTeleporterId: null,
        animationState: 'IDLE', animationFrame: 0, facingDirection: 1, coyoteTime: 0, jumpBuffer: 0,
        state: 'IDLE', remainderX: 0, remainderY: 0, ladderExitTimer: 0, ladderExitDirection: 0,
        transitionStartX: 0, transitionTargetX: null, transitionBypassPlatformY: null, fallStartY: 0,
    });

    const wasOnGroundRef = useRef(playerRef.current.onGround);
    const wasClimbingRef = useRef(playerRef.current.isClimbing);
    const pushIntentRef = useRef<{ dir: number; count: number }>({ dir: 0, count: 0 });
    const input = useGameInput();

    // --- SPRITE CACHING OPTIMIZATION ---
    // Cache for rendered sprites to avoid expensive fillRect ops every frame
    // WeakMap key: PixelData (object ref), Value: Map<ColorPaletteFallback | 'default', HTMLCanvasElement>
    // Since WeakMap can't take strings as composite keys effectively with primitives, we use a slightly different approach.
    // We recreate the cache when the palette changes.
    const spriteCacheRef = useRef<WeakMap<PixelData, HTMLCanvasElement>>(new WeakMap());

    // Clear cache when palette changes by creating a new WeakMap
    useEffect(() => {
        spriteCacheRef.current = new WeakMap();
    }, [palette]);


    // Track collected items immediately to prevent repeated sound plays and delayed visual removal
    const collectedItemsRef = useRef<Set<string>>(new Set());


    useEffect(() => {
        if (canvasRef.current) {
            canvasRef.current.style.cursor = 'crosshair';
        }
    }, []);

    useEffect(() => {
        document.fonts.load('2.5rem "Press Start 2P"').then(() => {
            setIsFontLoaded(true);
        }).catch(console.error);
    }, []);

    const currentLevelForMemo = mode === 'PLAY' ? localLevelData : level.levelData;

    // Collision mask type for platform collisions
    type CollisionMask = boolean[][];

    const { spatialGrid, memoizedTeleporters, platformPositions, collisionMaskCache } = useMemo(() => {
        // FLAT GRID ARRAY OPTIMIZATION
        const grid: SpatialGrid = new Array(TILES_X * TILES_Y);
        const teleporters: PlacedAsset[] = [];
        const platPositions = new Set<string>();
        const solidPlatformList: PlacedAsset[] = [];

        // First pass: build grid, collect platforms, teleporters
        for (const pAsset of currentLevelForMemo) {
            const gridX = Math.floor(pAsset.x / TILE_SIZE);
            const gridY = Math.floor(pAsset.y / TILE_SIZE);

            // Bounds check
            if (gridX >= 0 && gridX < TILES_X && gridY >= 0 && gridY < TILES_Y) {
                const idx = gridY * TILES_X + gridX;
                if (!grid[idx]) {
                    grid[idx] = [];
                }
                grid[idx]!.push(pAsset);
            }


            if (assets[pAsset.assetId]?.type === 'TELEPORTER') {
                teleporters.push(pAsset);
            }

            // Collect solid platforms for collision mask generation
            const assetType = assets[pAsset.assetId]?.type;
            if (assetType === 'PLATFORM' || assetType === 'DOOR') {
                platPositions.add(`${pAsset.x},${pAsset.y}`);
                solidPlatformList.push(pAsset);
            }
        }

        // Helper to check for neighbor platform
        const hasNeighbor = (x: number, y: number): boolean => platPositions.has(`${x},${y}`);

        // Generate collision mask for a platform based on neighbors
        const generateMask = (platformX: number, platformY: number): CollisionMask => {
            const mask: CollisionMask = Array.from({ length: TILE_SIZE }, () =>
                Array.from({ length: TILE_SIZE }, () => true)
            );

            const hasLeft = hasNeighbor(platformX - TILE_SIZE, platformY);
            const hasRight = hasNeighbor(platformX + TILE_SIZE, platformY);
            const hasTop = hasNeighbor(platformX, platformY - TILE_SIZE);
            const hasBottom = hasNeighbor(platformX, platformY + TILE_SIZE);

            // Round top-left corner if no top AND no left neighbors
            if (!hasTop && !hasLeft) {
                mask[0][0] = false; mask[0][1] = false; mask[1][0] = false;
            }
            // Round top-right corner
            if (!hasTop && !hasRight) {
                mask[0][7] = false; mask[0][6] = false; mask[1][7] = false;
            }
            // Round bottom-left corner
            if (!hasBottom && !hasLeft) {
                mask[7][0] = false; mask[7][1] = false; mask[6][0] = false;
            }
            // Round bottom-right corner
            if (!hasBottom && !hasRight) {
                mask[7][7] = false; mask[7][6] = false; mask[6][7] = false;
            }
            // Remove leftmost column if no left neighbor
            if (!hasLeft) {
                for (let y = 0; y < TILE_SIZE; y++) mask[y][0] = false;
            }
            // Remove rightmost column if no right neighbor
            if (!hasRight) {
                for (let y = 0; y < TILE_SIZE; y++) mask[y][7] = false;
            }
            return mask;
        };

        // Second pass: generate collision masks for all platforms
        const maskCache = new Map<string, CollisionMask>();
        for (const p of solidPlatformList) {
            const key = `${p.x},${p.y}`;
            maskCache.set(key, generateMask(p.x, p.y));
        }

        return { spatialGrid: grid, memoizedTeleporters: teleporters, platformPositions: platPositions, collisionMaskCache: maskCache };
    }, [currentLevelForMemo, assets]);

    const ladderCoords = useMemo(() => {
        return new Set(localLevelData.filter(p => assets[p.assetId]?.type === 'LADDER').map(l => `${l.x},${l.y}`));
    }, [localLevelData, assets]);

    const drawSprite = useCallback((ctx: CanvasRenderingContext2D, spriteData: PixelData, dx: number, dy: number, options: { opacity?: number, flipH?: boolean, rotate?: number, overrideColor?: string } = {}) => {
        const { opacity = 1, flipH = false, rotate = 0, overrideColor } = options;
        ctx.globalAlpha = opacity;

        const floorDx = Math.floor(dx);
        const floorDy = Math.floor(dy);

        ctx.save();
        ctx.translate(floorDx + TILE_SIZE / 2, floorDy + TILE_SIZE / 2);
        if (rotate !== 0) ctx.rotate((rotate * Math.PI) / 180);
        if (flipH) ctx.scale(-1, 1);
        ctx.translate(-(floorDx + TILE_SIZE / 2), -(floorDy + TILE_SIZE / 2));

        // OPTIMIZED RENDERING: Cache sprites to offscreen canvas
        // Only use cache if no strictly custom override color (unless 'retro' style which is standard enough)
        // For simplicity, we skip caching for arbitrary overrideColor strings that are not 'retro'
        const useCache = !overrideColor;

        if (useCache) {
            let cachedCanvas = spriteCacheRef.current.get(spriteData);
            if (!cachedCanvas) {
                // Generate cache
                cachedCanvas = document.createElement('canvas');
                cachedCanvas.width = TILE_SIZE;
                cachedCanvas.height = TILE_SIZE;
                const cCtx = cachedCanvas.getContext('2d')!;

                // Draw pixels to cached canvas
                for (let y = 0; y < TILE_SIZE; y++) {
                    for (let x = 0; x < TILE_SIZE; x++) {
                        const colorIndex = spriteData[y][x];
                        if (colorIndex > 0) {
                            cCtx.fillStyle = palette[colorIndex];
                            cCtx.fillRect(x, y, 1, 1);
                        }
                    }
                }
                spriteCacheRef.current.set(spriteData, cachedCanvas);
            }
            ctx.drawImage(cachedCanvas, floorDx, floorDy);
        } else {
            // Fallback for custom colors or uncached
            for (let y = 0; y < TILE_SIZE; y++) {
                for (let x = 0; x < TILE_SIZE; x++) {
                    const colorIndex = spriteData[y][x];
                    if (colorIndex > 0) {
                        if (overrideColor) {
                            ctx.fillStyle = overrideColor;
                        } else if (overrideColor === 'retro') {
                            if (colorIndex === 1) ctx.fillStyle = BLACK;
                            else if (colorIndex === 4) ctx.fillStyle = WHITE;
                            else if (colorIndex === 11) ctx.fillStyle = LIGHT_GRAY;
                            else ctx.fillStyle = palette[colorIndex];
                        } else {
                            ctx.fillStyle = palette[colorIndex];
                        }
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
            }
        }

        ctx.restore();
        ctx.globalAlpha = 1;
    }, [palette]);

    const commitAction = useCallback((changes: { x: number, y: number, assetId: string | null }[]) => {
        if (changes.length > 0) onCommitChanges(changes);
    }, [onCommitChanges]);


    const renderGame = useCallback(() => {
        const canvas = canvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d'); if (!ctx) return;

        // Level intro screen
        if (mode === 'PLAY' && gameState === 'level_intro') {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            // "LEVEL X" title
            const titleStr = 'LEVEL ' + (currentLevelIndex + 1);
            const tScale = 3;
            const tW = getTextWidth(titleStr, tScale);
            drawText(ctx, titleStr, Math.floor((GAME_WIDTH - tW) / 2), 18, '#FFFFFF', tScale);
            // Intro text with typewriter effect
            const rawIntro = level.introText || '';
            const introText = rawIntro.replace(/\r?\n/g, ' ').trim();
            if (introText) {
                const lScale = 1;
                const margin = 6;
                const maxLineWidth = GAME_WIDTH - margin * 2;
                const visibleChars = Math.min(typewriterIndexRef.current, introText.length);
                const visible = introText.substring(0, visibleChars);
                const words = visible.split(' ');
                const lines: string[] = [];
                let cur = '';
                for (const w of words) {
                    const candidate = cur ? cur + ' ' + w : w;
                    if (cur && getTextWidth(candidate, lScale) > maxLineWidth) {
                        lines.push(cur);
                        cur = w;
                    } else {
                        cur = candidate;
                    }
                }
                if (cur) lines.push(cur);
                const lH = 8;
                const startY = 18 + tScale * 5 + 12;
                lines.forEach((line, i) => {
                    const lW = getTextWidth(line, lScale);
                    drawText(ctx, line, Math.floor((GAME_WIDTH - lW) / 2), startY + i * lH, '#DDDDDD', lScale);
                });
                if (!typewriterCompleteRef.current) {
                    typewriterTickRef.current++;
                    if (typewriterTickRef.current % 4 === 0) typewriterIndexRef.current += 3;
                    if (typewriterIndexRef.current >= introText.length) {
                        typewriterCompleteRef.current = true;
                        typewriterIndexRef.current = introText.length;
                    }
                }
            } else {
                typewriterCompleteRef.current = true;
            }
            if (typewriterCompleteRef.current && Math.floor(Date.now() / 500) % 2 === 0) {
                const hint = 'PRESS ANY KEY';
                const hW = getTextWidth(hint);
                drawText(ctx, hint, Math.floor((GAME_WIDTH - hW) / 2), GAME_HEIGHT - 16, '#888888');
            }
            return;
        }

        const currentDisplayLevel = levelDuringAction ?? (mode === 'PLAY' ? localLevelData : level.levelData);
        const player = playerRef.current;

        ctx.fillStyle = palette[1] || '#000000';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        currentDisplayLevel.forEach(pAsset => {
            if (mode === 'EDIT' && dragState && dragState.asset.id === pAsset.id) return;
            if (mode === 'PLAY' && (assets[pAsset.assetId]?.type === 'SLIME' || assets[pAsset.assetId]?.type === 'PUDDLE' || assets[pAsset.assetId]?.type === 'BAD_MAN' || assets[pAsset.assetId]?.type === 'CRATE')) return;

            // Check for remaining gems (for Level Ladder visibility)
            const hasRemainingGems = currentDisplayLevel.some(p => assets[p.assetId]?.type === 'GEM' && !collectedItemsRef.current.has(p.id));
            if (mode === 'PLAY' && assets[pAsset.assetId]?.type === 'LEVEL_LADDER' && hasRemainingGems) return;

            // Skip rendering collected items immediately (before React state updates)
            if (mode === 'PLAY' && collectedItemsRef.current.has(pAsset.id)) return;
            const asset = assets[pAsset.assetId];
            if (asset) {
                // Use rotation for puddles if available
                const rotation = pAsset.rotation !== undefined ? pAsset.rotation : undefined;
                drawSprite(ctx, asset.data, pAsset.x, pAsset.y, rotation !== undefined ? { rotate: rotation } : undefined);
            }
        });

        // DEBUG: Visualize collision fields in bright red
        const DEBUG_COLLISION = true; // Set to false to disable
        if (DEBUG_COLLISION && mode === 'PLAY') {
            ctx.fillStyle = '#FF0000'; // Bright red
            ctx.globalAlpha = 0.5; // Semi-transparent

            // Get current platform colliders from the game logic
            const nearbyAssets = currentDisplayLevel;
            const solidPlatforms = nearbyAssets.filter(p => {
                const type = assets[p.assetId]?.type;
                return type === 'PLATFORM' || (type === 'DOOR' && !player.hasKey);
            });

            const platformPositions = new Set(solidPlatforms.map(p => `${p.x},${p.y}`));
            const hasNeighborPlatform = (x: number, y: number): boolean => {
                return platformPositions.has(`${x},${y}`);
            };

            const generateCollisionMask = (platformX: number, platformY: number): boolean[][] => {
                const mask: boolean[][] = Array.from({ length: TILE_SIZE }, () =>
                    Array.from({ length: TILE_SIZE }, () => true)
                );

                const hasLeft = hasNeighborPlatform(platformX - TILE_SIZE, platformY);
                const hasRight = hasNeighborPlatform(platformX + TILE_SIZE, platformY);
                const hasTop = hasNeighborPlatform(platformX, platformY - TILE_SIZE);
                const hasBottom = hasNeighborPlatform(platformX, platformY + TILE_SIZE);

                // Round corners
                if (!hasTop && !hasLeft) {
                    mask[0][0] = false; mask[0][1] = false; mask[1][0] = false;
                }
                if (!hasTop && !hasRight) {
                    mask[0][7] = false; mask[0][6] = false; mask[1][7] = false;
                }
                if (!hasBottom && !hasLeft) {
                    mask[7][0] = false; mask[7][1] = false; mask[6][0] = false;
                }
                if (!hasBottom && !hasRight) {
                    mask[7][7] = false; mask[7][6] = false; mask[6][7] = false;
                }

                // Remove 1 pixel from exposed vertical sides (for smooth gap sliding)
                if (!hasLeft) {
                    for (let y = 0; y < TILE_SIZE; y++) {
                        mask[y][0] = false;
                    }
                }
                if (!hasRight) {
                    for (let y = 0; y < TILE_SIZE; y++) {
                        mask[y][7] = false;
                    }
                }

                return mask;
            };

            /*
            // DEBUG: Draw collision masks
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            solidPlatforms.forEach(p => {
                const mask = generateCollisionMask(p.x, p.y);
                for (let y = 0; y < TILE_SIZE; y++) {
                    for (let x = 0; x < TILE_SIZE; x++) {
                        if (mask[y][x]) {
                            ctx.fillRect(p.x + x, p.y + y, 1, 1);
                        }
                    }
                }
            });
            ctx.globalAlpha = 1.0; // Reset alpha
            */
        }

        if (mode === 'PLAY') {
            enemyStatesRef.current.forEach(enemy => {
                const asset = assets[enemy.assetId];
                if (asset) {
                    const frameData = getSpriteForState(asset, enemy.animationState, enemy.animationFrame);
                    const facing = enemy.direction === -1;
                    drawSprite(ctx, frameData, enemy.x, enemy.y, { flipH: facing });
                }
            });

            puddleStatesRef.current.forEach(puddle => {
                const asset = assets[puddle.assetId];
                if (asset) {
                    const rotation = puddle.rotation || 0;
                    const animState = puddle.animationState || 'WALKING';
                    const frameData = getSpriteForState(asset, animState, puddle.animationFrame);
                    const facing = puddle.facingDirection === -1;

                    // Main Sprite
                    drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: rotation, flipH: facing });
                    /*
                    const animState = puddle.animationState || 'WALKING';
                    const frameData = getSpriteForState(asset, animState, puddle.animationFrame);
                    const facing = puddle.facingDirection === -1;
        
                    // Grid boundaries of the Attached Block
                    const gx = puddle.gridX;
                    const gy = puddle.gridY;
                    const tileLeft = gx * TILE_SIZE;
                    const tileRight = (gx + 1) * TILE_SIZE;
                    const tileTop = gy * TILE_SIZE;
                    const tileBottom = (gy + 1) * TILE_SIZE;
        
                    let drawnTail = false;
        
                    // Checks for "Underhang" (Coming from a previous side)
        
                    // --- SIDE: TOP ---
                    if (puddle.side === 'TOP') {
                        // Coming from LEFT (x < tileLeft)
                        if (puddle.x < tileLeft) {
                            const d = tileLeft - puddle.x; // Amount still on Left face
                            // Draw Main (Top Side, Clipped Left)
                            ctx.save();
                            ctx.beginPath(); ctx.rect(tileLeft, puddle.y, TILE_SIZE, TILE_SIZE); ctx.clip();
                            drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 0, flipH: facing });
                            ctx.restore();
        
                            // Draw Tail (Left Side, Rot 270)
                            // Tail is on Left Face. Moving Up.
                            // Tail Y range: [tileTop, tileTop + d]
                            ctx.save();
                            ctx.beginPath(); ctx.rect(tileLeft - TILE_SIZE, tileTop, TILE_SIZE, d); ctx.clip();
                            // Position logic: Head at 'tileLeft'. Tail length d.
                            // Sprite (Rot 270) 'y' corresponds to 'x' on Top.
                            // We want sprite bottom (right in source) to align with tileTop.
                            // drawSprite at (tileLeft - TILE, tileTop + d - TILE)
                            drawSprite(ctx, frameData, tileLeft - TILE_SIZE, tileTop - (TILE_SIZE - d), { rotate: 270, flipH: facing });
                            ctx.restore();
                            drawnTail = true;
                        }
                        // Coming from RIGHT (x + 16 > tileRight ? No, coming from Right means x starts > tileRight? No. 
                        // If coming from Right (CCW), x decreases. Starts at tileRight. x > tileRight.
                        else if (puddle.x > tileLeft) { // Wait, standard range is [tileLeft, tileRight-16].
                            // If x > tileRight - 16, it might be leaving to Right?
                            // But here we check UNDERHANG (Entry).
                            // Entry from Right means x > tileRight - 16?
                            // My puddleUtils sets x -= 16 (Backwards).
                            // If coming from Right (CCW), target is Top. Dir = Left (-1). x += 16.
                            // So x starts at tileRight (or tileRight-16 + 16 = tileRight).
                            // Then moves left.
                            // So x > tileRight - 16 (actually x > something).
                            // Let's assume standard tile width 16.
                            // If x > tileRight - TILE_SIZE: Normal if fully on tile?
                            // No. If x starts at tileRight.
                            if (puddle.x > tileRight - TILE_SIZE + 0.1) {
                                // Potentially coming from Right?
                                // Only if we assume Puddle width is TILE_SIZE.
                                const overhang = puddle.x - (tileRight - TILE_SIZE);
                                if (overhang > 0.1) {
                                    // This could optionally be "Leaving to Right".
                                    // But based on puddleUtils offset logic:
                                    // If we came from Right, x was set to tileRight.
                                    // So x IS > tileRight - 16.
        
                                    // Note: This overlaps with "Leaving" logic.
                                    // But since we strictly switched side in puddleUtils, we are conceptually Entering.
                                    // Draw Tail on Right Side.
        
                                    // Clip Main
                                    ctx.save();
                                    ctx.beginPath(); ctx.rect(tileLeft, puddle.y, tileRight - tileLeft, TILE_SIZE); ctx.clip();
                                    drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 0, flipH: facing });
                                    ctx.restore();
        
                                    // Draw Tail (Right Side, Rot 90)
                                    // Tail Y range: [tileTop, tileTop + overhang].
                                    ctx.save();
                                    ctx.beginPath(); ctx.rect(tileRight, tileTop, TILE_SIZE, overhang); ctx.clip();
                                    drawSprite(ctx, frameData, tileRight, tileTop - (TILE_SIZE - overhang), { rotate: 90, flipH: facing });
                                    ctx.restore();
                                    drawnTail = true;
                                }
                            }
                        }
                    }
        
                    // --- SIDE: RIGHT ---
                    else if (puddle.side === 'RIGHT') {
                        // Coming from TOP (y < tileTop)
                        if (puddle.y < tileTop) {
                            const d = tileTop - puddle.y;
                            // Clip Main
                            ctx.save();
                            ctx.beginPath(); ctx.rect(puddle.x, tileTop, TILE_SIZE, TILE_SIZE); ctx.clip();
                            drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 90, flipH: facing });
                            ctx.restore();
        
                            // Draw Tail (Top Side, Rot 0)
                            // Tail X range: [tileRight - d, tileRight]
                            ctx.save();
                            ctx.beginPath(); ctx.rect(tileRight - d, tileTop - TILE_SIZE, d, TILE_SIZE); ctx.clip();
                            drawSprite(ctx, frameData, tileRight - TILE_SIZE + (TILE_SIZE - d), tileTop - TILE_SIZE, { rotate: 0, flipH: facing });
                            ctx.restore();
                            drawnTail = true;
                        }
                        // Coming from BOTTOM (y > tileBottom - 16?)
                        // If coming from Bottom (moving Up), y += 16. y starts at tileBottom.
                        else if (puddle.y > tileTop) {
                            if (puddle.y > tileBottom - TILE_SIZE + 0.1) {
                                const overhang = puddle.y - (tileBottom - TILE_SIZE);
                                // Tail on Bottom Side (Rot 180)
                                ctx.save();
                                ctx.beginPath(); ctx.rect(puddle.x, tileTop, TILE_SIZE, tileBottom - tileTop); ctx.clip();
                                drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 90, flipH: facing });
                                ctx.restore();
        
                                ctx.save();
                                ctx.beginPath(); ctx.rect(tileRight - overhang, tileBottom, overhang, TILE_SIZE); ctx.clip();
                                // Rot 180.
                                drawSprite(ctx, frameData, tileRight - TILE_SIZE + (TILE_SIZE - overhang), tileBottom, { rotate: 180, flipH: facing });
                                ctx.restore();
                                drawnTail = true;
                            }
                        }
                    }
        
                    // --- SIDE: BOTTOM ---
                    else if (puddle.side === 'BOTTOM') {
                        // Coming from RIGHT (x > tileRight - 16?)
                        // If moving Left, x starts at tileRight.
                        if (puddle.x > tileLeft) {
                            if (puddle.x > tileRight - TILE_SIZE + 0.1) {
                                const overhang = puddle.x - (tileRight - TILE_SIZE);
                                // Tail on Right Side (Rot 90)
                                ctx.save();
                                ctx.beginPath(); ctx.rect(tileLeft, puddle.y, tileRight - tileLeft, TILE_SIZE); ctx.clip();
                                drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 180, flipH: facing });
                                ctx.restore();
        
                                ctx.save();
                                ctx.beginPath(); ctx.rect(tileRight, tileBottom - overhang, TILE_SIZE, overhang); ctx.clip();
                                // Rot 90
                                drawSprite(ctx, frameData, tileRight, tileBottom - TILE_SIZE + (TILE_SIZE - overhang), { rotate: 90, flipH: facing });
                                ctx.restore();
                                drawnTail = true;
                            }
                        }
                        // Coming from LEFT (x < tileLeft)
                        else if (puddle.x < tileLeft) {
                            const d = tileLeft - puddle.x;
                            ctx.save();
                            ctx.beginPath(); ctx.rect(tileLeft, puddle.y, TILE_SIZE, TILE_SIZE); ctx.clip();
                            drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 180, flipH: facing });
                            ctx.restore();
        
                            // Tail on Left Side (Rot 270)
                            ctx.save();
                            ctx.beginPath(); ctx.rect(tileLeft - TILE_SIZE, tileBottom - d, TILE_SIZE, d); ctx.clip();
                            drawSprite(ctx, frameData, tileLeft - TILE_SIZE, tileBottom - TILE_SIZE + (TILE_SIZE - d), { rotate: 270, flipH: facing });
                            ctx.restore();
                            drawnTail = true;
                        }
                    }
        
                    // --- SIDE: LEFT ---
                    else if (puddle.side === 'LEFT') {
                        // Coming from BOTTOM (y > tileBottom - 16?)
                        // If moving Up, y starts at tileBottom.
                        if (puddle.y > tileTop) {
                            if (puddle.y > tileBottom - TILE_SIZE + 0.1) {
                                const overhang = puddle.y - (tileBottom - TILE_SIZE);
                                // Tail on Bottom Side (Rot 180)
                                ctx.save();
                                ctx.beginPath(); ctx.rect(puddle.x, tileTop, TILE_SIZE, tileBottom - tileTop); ctx.clip();
                                drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 270, flipH: facing });
                                ctx.restore();
        
                                ctx.save(); // Clip on Bottom Face
                                ctx.beginPath(); ctx.rect(tileLeft, tileBottom, overhang, TILE_SIZE); ctx.clip();
                                // Rot 180
                                drawSprite(ctx, frameData, tileLeft - (TILE_SIZE - overhang), tileBottom, { rotate: 180, flipH: facing });
                                ctx.restore();
                                drawnTail = true;
                            }
                        }
                        // Coming from TOP (y < tileTop)
                        else if (puddle.y < tileTop) {
                            const d = tileTop - puddle.y;
                            ctx.save();
                            ctx.beginPath(); ctx.rect(puddle.x, tileTop, TILE_SIZE, TILE_SIZE); ctx.clip();
                            drawSprite(ctx, frameData, puddle.x, puddle.y, { rotate: 270, flipH: facing });
                            ctx.restore();
        
                            // Tail on Top Side (Rot 0)
                            ctx.save();
                            ctx.beginPath(); ctx.rect(tileLeft, tileTop - TILE_SIZE, d, TILE_SIZE); ctx.clip();
                            drawSprite(ctx, frameData, tileLeft - (TILE_SIZE - d), tileTop - TILE_SIZE, { rotate: 0, flipH: facing });
                            ctx.restore();
                            drawnTail = true;
                        }
                    }
        
                    */

                    // DEBUG: Visual Grid Box
                    // Draw a BLUE box around the grid tile the puddle thinks it is attached to
                    const DEBUG_PUDDLE = false;
                    if (DEBUG_PUDDLE) {
                        const bgx = puddle.gridX * TILE_SIZE;
                        const bgy = puddle.gridY * TILE_SIZE;
                        ctx.save();
                        ctx.strokeStyle = '#00FFFF'; // Cyan/Blue
                        ctx.lineWidth = 1;
                        ctx.strokeRect(bgx + 0.5, bgy + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
                        ctx.restore();
                    }
                }
            });

            badManStatesRef.current.forEach(badMan => {
                const asset = assets[badMan.assetId];
                if (asset) {
                    if (badMan.isVisible === false) return; // Respect visibility (blinking/dead)

                    // Stunned/Waking Rendering with Offset
                    const frameData = getSpriteForState(asset, badMan.animationState, badMan.animationFrame);
                    drawSprite(ctx, frameData, badMan.x, badMan.y, { flipH: badMan.facingDirection === -1 });
                }
            });

            crateStatesRef.current.forEach(crate => {
                const asset = assets[crate.assetId];
                if (!asset) return;
                if (crate.tipState === 'TIPPING') {
                    ctx.imageSmoothingEnabled = false;
                    const rad = crate.tipAngle * Math.PI / 180;
                    const relX = crate.x + 4 - crate.tipPivotX;
                    const relY = crate.y + 4 - crate.tipPivotY;
                    const d = crate.tipDirection;
                    const cos = Math.cos(rad), sin = Math.sin(rad);
                    const nx = relX * cos - d * relY * sin;
                    const ny = d * relX * sin + relY * cos;
                    const dx = crate.tipPivotX + nx - 4;
                    const dy = crate.tipPivotY + ny - 4;
                    drawSprite(ctx, asset.data, dx, dy, { rotate: d * crate.tipAngle });
                } else {
                    drawSprite(ctx, asset.data, crate.x, crate.y);
                }
            });

            let shouldDrawPlayer = !(player.isInvincible && Math.floor(Date.now() / 250) % 2 !== 0);
            if (shouldDrawPlayer && !player.isDead && !player.hasWon) {
                const isDying = player.animationState === 'DYING';
                const spriteToDraw = isDying
                    ? getSpriteForState(playerAsset, 'IDLE', 0)
                    : getSpriteForState(playerAsset, player.animationState, player.animationFrame);
                drawSprite(ctx, spriteToDraw, player.x, player.y, isDying
                    ? { rotate: 180, flipH: player.facingDirection === 1 }
                    : { flipH: player.facingDirection === -1 });
            } else if (player.isDead) {
                // Draw upside-down idle sprite when dead
                const spriteToDraw = getSpriteForState(playerAsset, 'IDLE', 0);
                drawSprite(ctx, spriteToDraw, player.x, player.y, { rotate: 180, flipH: player.facingDirection === 1 });
            }

            if (player.isSpikeImmune && Math.floor(Date.now() / 150) % 2 === 0) {
                const effectColor = palette[themeInfo.textColorIndex ?? 4] || '#FFFFFF';
                ctx.globalAlpha = 0.4; ctx.fillStyle = effectColor;
                ctx.fillRect(player.x, player.y, player.width, player.height);
                ctx.globalAlpha = 1.0;
            }
            if (player.hasKey && Math.floor(Date.now() / 300) % 2 === 0) {
                drawSprite(ctx, assets.key.data, GAME_WIDTH - TILE_SIZE - 4, 4);
            }
        } else if (mode === 'EDIT') {
            if (!dragState?.isPlayer) {
                // Use getPreviewSprite for the player start position marker
                const sprite = getPreviewSprite(playerAsset);
                drawSprite(ctx, sprite, level.playerStartPos.x, level.playerStartPos.y, { opacity: 0.75 });
            }

            // Check if mouse is hovering over a movable asset
            let hoveringOverMovableAsset = false;
            // ... (hover logic remains same) ...

            // Draw ghost preview only if not hovering over a movable asset
            if (mousePos && !dragState && editorActionState.current === 'none' && !hoveringOverMovableAsset) {
                const selectedAsset = assets[selectedAssetId];
                if (selectedAsset) {
                    const gridX = Math.floor(mousePos.x / TILE_SIZE) * TILE_SIZE;
                    const gridY = Math.floor(mousePos.y / TILE_SIZE) * TILE_SIZE;
                    const isPuddle = selectedAsset.type === 'PUDDLE';

                    // Use getPreviewSprite for the ghost preview
                    const sprite = getPreviewSprite(selectedAsset);

                    drawSprite(ctx, sprite, gridX, gridY, {
                        opacity: 0.5,
                        rotate: isPuddle ? puddleRotation : undefined
                    });
                }
            }

            // Draw Level
            currentDisplayLevel.forEach(p => {
                const asset = assets[p.assetId];
                if (asset) {
                    const isPuddle = asset.type === 'PUDDLE';
                    const rotation = isPuddle && p.rotation !== undefined ? p.rotation : undefined;
                    // Use getPreviewSprite to show correct animation frame
                    const sprite = getPreviewSprite(asset);
                    drawSprite(ctx, sprite, p.x, p.y, {
                        opacity: isPuddle ? 0.8 : 1, // Slight transparency for puddles in edit mode? OR keep standard. Puddles transparency was not standard.
                        // Actually, in the original code, puddles didn't have special opacity here.
                        rotate: rotation,
                        flipH: false // Default flip
                    });
                }
            });

            // Draw moving asset with rotation applied for puddles
            if (dragState && mousePos) {
                const asset = dragState.isPlayer ? playerAsset : assets[dragState.asset.assetId];
                const gridX = Math.floor(mousePos.x / TILE_SIZE) * TILE_SIZE;
                const gridY = Math.floor(mousePos.y / TILE_SIZE) * TILE_SIZE;
                const isPuddle = !dragState.isPlayer && assets[dragState.asset.assetId]?.type === 'PUDDLE';
                const rotation = isPuddle ? dragState.asset.rotation : undefined;

                // Use getPreviewSprite for the dragged asset
                const sprite = getPreviewSprite(asset);

                drawSprite(ctx, sprite, gridX, gridY, { opacity: 0.7, rotate: rotation });
            }

            // ... (existing code for selection box and teleporter IDs) ... 

            // RENDER PLACED ASSETS FOR EDIT MODE
            // Since we are not running the game loop, we need to manually draw the assets
            // Note: The background/overlay grids are handled by the separate layers, 
            // but for "Sprites" (Slimes, Puddles, etc) that might need dynamic preview, we should ensure they look right.
            // Wait - the current implementation draws everything from `currentDisplayLevel`.
            // Let's verify where `currentDisplayLevel` is drawn. 
            // It seems I missed the main draw loop for EDIT mode in this replacement block.
            // The main draw loop is actually SHARED between modes at the top of the function (lines 1136+).
            // I need to update THAT loop as well.

            // Fix: Redoing the replacement to target the correct areas. 
            // The previous replacement only targeted the EDIT specific block at the end of the effect.
            // I need to update the main render loop (lines 1136+) and the EDIT block (lines 1361+).
            ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 1;
            ctx.strokeRect(editSquarePos.x - 0.5, editSquarePos.y - 0.5, TILE_SIZE + 1, TILE_SIZE + 1);

            const teleporters = currentDisplayLevel.filter(p => assets[p.assetId]?.type === 'TELEPORTER');
            const seenPairIds = new Set<number>();
            teleporters.forEach(t => {
                if (t.teleporterPairId !== undefined && !seenPairIds.has(t.teleporterPairId)) {
                    const pair = teleporters.filter(other => other.teleporterPairId === t.teleporterPairId);
                    if (pair.length === 2) {
                        const pairIdStr = String(t.teleporterPairId);
                        const textColor = palette[themeInfo.textColorIndex ?? 4] ?? '#FFFFFF';
                        pair.forEach(member => {
                            const textWidth = getTextWidth(pairIdStr);
                            const x = member.x + (TILE_SIZE - textWidth) / 2;
                            let y = member.y - 6;
                            if (member.y < 6) {
                                y = member.y + 1;
                                ctx.save(); ctx.fillStyle = palette[1] || '#000000'; ctx.globalAlpha = 0.6;
                                ctx.fillRect(Math.floor(x) - 1, y, textWidth + 2, 6); ctx.restore();
                            }
                            drawText(ctx, pairIdStr, x, y, textColor);
                        });
                    }
                    seenPairIds.add(t.teleporterPairId);
                }
            });
        }

        // Pause menu overlay (drawn over frozen game)
        if (mode === 'PLAY' && gameState === 'paused') {
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            const menuW = 96; const menuH = 52;
            const menuX = Math.floor((GAME_WIDTH - menuW) / 2);
            const menuY = Math.floor((GAME_HEIGHT - menuH) / 2);
            ctx.fillStyle = '#000000';
            ctx.fillRect(menuX, menuY, menuW, menuH);
            ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1;
            ctx.strokeRect(menuX + 0.5, menuY + 0.5, menuW - 1, menuH - 1);
            ctx.strokeRect(menuX + 2.5, menuY + 2.5, menuW - 5, menuH - 5);
            const pTitle = 'PAUSED';
            const pScale = 2;
            const pW = getTextWidth(pTitle, pScale);
            drawText(ctx, pTitle, menuX + Math.floor((menuW - pW) / 2), menuY + 8, '#FFFFFF', pScale);
            const items = ['RESUME', 'RESTART'];
            const sel = pauseMenuSelectionRef.current;
            items.forEach((item, i) => {
                const iy = menuY + 27 + i * 12;
                const col = i === sel ? '#FFFF55' : '#888888';
                drawText(ctx, (i === sel ? '>' : ' ') + ' ' + item, menuX + 12, iy, col);
            });
        }

    }, [assets, playerAsset, drawSprite, palette, level.levelData, level.playerStartPos, level.introText, mode, mousePos, selectedAssetId, localLevelData, editSquarePos, dragState, levelDuringAction, themeInfo, getPreviewSprite, gameState, currentLevelIndex]);

    const resetPlayer = useCallback(() => {
        const player = playerRef.current;
        player.x = level.playerStartPos.x; player.y = level.playerStartPos.y;
        player.vx = 0; player.vy = 0; player.onGround = false; player.isClimbing = false;
        player.currentLadderId = null; player.targetX = null; player.targetY = null;
        player.teleportCooldown = 0; player.jumpCooldown = 0; player.ladderSwitchCooldown = 0;
        player.ladderGrabCooldown = 0; player.ladderSidewaysCooldown = 0; player.collisionDisabledCooldown = 0; player.isSwitchingLadders = false;
        player.isDetaching = false; player.isDismounting = false; player.justDismountedCooldown = 0;
        player.switchVerticalDirection = 0; player.dying = 0; player.isDead = false;
        player.isInvincible = false; player.hasWon = false; player.wasTouchingHazard = false;
        player.hasKey = false; player.isSpikeImmune = false; player.spikeImmuneCooldown = 0; player.lastTeleporterId = null;
        player.animationState = 'IDLE'; player.animationFrame = 0; player.facingDirection = 1;
        player.coyoteTime = 0; player.jumpBuffer = 0;
        player.state = 'IDLE'; player.remainderX = 0; player.remainderY = 0;
        player.ladderExitTimer = 0; player.ladderExitDirection = 0;
        player.fallStartY = player.y; // Initialize fall start to current Y to prevent spawn landing sound
        player.transitionStartX = 0; player.transitionTargetX = null; player.transitionBypassPlatformY = null;
        if (input) { input.left = false; input.right = false; input.up = false; input.down = false; }
        collectedItemsRef.current.clear(); // Clear collected items tracking
        setLocalLevelData(level.levelData.map(a => ({ ...a })));

        enemyStatesRef.current = level.levelData
            .filter(pAsset => assets[pAsset.assetId]?.type === 'SLIME')
            .map(pAsset => ({
                id: pAsset.id, assetId: pAsset.assetId, x: pAsset.x, y: pAsset.y, direction: 1,
                moveState: 'IDLE', moveProgress: 0, moveOriginX: pAsset.x, targetX: pAsset.x,
                cooldown: PAUSE_DURATION_FRAMES, animationState: 'WALKING', animationFrame: 0,
                cycleStartX: pAsset.x,
            }));

        puddleStatesRef.current = level.levelData
            .filter(pAsset => assets[pAsset.assetId]?.type === 'PUDDLE')
            .map(pAsset => {
                // Determine puddle starting side based on rotation
                let side: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'LADDER' = 'TOP';
                const rotation = pAsset.rotation ?? 0;
                if (rotation === 90) side = 'RIGHT';
                else if (rotation === 180) side = 'BOTTOM';
                else if (rotation === 270) side = 'LEFT';

                let gx = Math.floor(pAsset.x / TILE_SIZE);
                let gy = Math.floor(pAsset.y / TILE_SIZE);

                // Adjust grid coordinates to point to the SOLID block we are attached to
                if (side === 'TOP') gy += 1;
                else if (side === 'BOTTOM') gy -= 1;
                else if (side === 'RIGHT') gx -= 1;
                else if (side === 'LEFT') gx += 1;

                return {
                    id: pAsset.id, assetId: pAsset.assetId, x: pAsset.x, y: pAsset.y,
                    side,
                    state: 'WALKING', // Initialize with valid state
                    falling: false,
                    animationFrame: 0,
                    facingDirection: 1, // Use facingDirection instead of facing
                    rotation,
                    gridX: gx,
                    gridY: gy,
                    path: [],
                    pathIndex: 0,
                    timer: 0,
                    animationState: 'WALKING',

                    // Legacy/Optional initializers to satisfy type if needed
                    turnTimer: 0, dropTimer: 0, landingTimer: 0, stepsToNextPlan: 0
                };
            });

        badManStatesRef.current = level.levelData
            .filter(pAsset => assets[pAsset.assetId]?.type === 'BAD_MAN')
            .map(pAsset => ({
                id: pAsset.id,
                assetId: pAsset.assetId,
                x: pAsset.x,
                y: pAsset.y,
                vx: 0,
                vy: 0,
                state: 'IDLE',
                facingDirection: 1,
                path: null,
                pathIndex: 0,
                timer: 0,
                animationState: 'IDLE',
                animationFrame: 0,
                onGround: false,
                width: 8, // Standard tile size
                height: 8
            }));
        crateStatesRef.current = level.levelData
            .filter(pAsset => assets[pAsset.assetId]?.type === 'CRATE')
            .map(pAsset => ({
                id: pAsset.id, assetId: pAsset.assetId,
                x: pAsset.x, y: pAsset.y,
                vy: 0, remainderY: 0, onGround: false,
                lastTeleporterId: null,
                pushCooldown: 0,
                tipState: 'NONE', tipAngle: 0,
                tipPivotX: 0, tipPivotY: 0, tipDirection: 1,
            }));

        teleporterHistoryRef.current = []; // Reset history on level load
    }, [level.playerStartPos, level.levelData, input, assets]);

    useEffect(() => {
        const handleAnyKeyRestart = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (gameState === 'dead' || gameState === 'won') { resetPlayer(); setGameState('playing'); return; }
            if (gameState === 'level_intro') {
                // Ignore keypresses for 500ms after intro starts (player may be holding a key from previous level)
                if (Date.now() - introStartTimeRef.current < 500) return;
                if (!typewriterCompleteRef.current) {
                    typewriterCompleteRef.current = true;
                    typewriterIndexRef.current = Infinity;
                } else {
                    inputGraceRef.current = 10; // ignore input for 10 frames after intro ends
                    setGameState('playing');
                }
                return;
            }
        };
        window.addEventListener('keydown', handleAnyKeyRestart);
        return () => window.removeEventListener('keydown', handleAnyKeyRestart);
    }, [gameState, resetPlayer]);

    // Pause menu: ESC to pause/resume, arrow keys and enter to navigate
    useEffect(() => {
        const handlePauseKeys = (e: KeyboardEvent) => {
            if (mode !== 'PLAY') return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.code === 'Escape') {
                if (gameState === 'playing') {
                    pauseMenuSelectionRef.current = 0;
                    setGameState('paused');
                    e.preventDefault();
                } else if (gameState === 'paused') {
                    setGameState('playing');
                    e.preventDefault();
                }
                return;
            }
            if (gameState === 'paused') {
                if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
                    pauseMenuSelectionRef.current = pauseMenuSelectionRef.current === 0 ? 1 : 0;
                    e.preventDefault();
                } else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyX') {
                    if (pauseMenuSelectionRef.current === 0) {
                        setGameState('playing');
                    } else {
                        resetPlayer();
                        setGameState('playing');
                    }
                    e.preventDefault();
                }
            }
        };
        window.addEventListener('keydown', handlePauseKeys);
        return () => window.removeEventListener('keydown', handlePauseKeys);
    }, [mode, gameState, resetPlayer]);

    // When entering PLAY mode from EDIT, show level intro
    useEffect(() => {
        if (mode === 'PLAY' && prevModeForIntro.current !== 'PLAY') {
            typewriterIndexRef.current = 0;
            typewriterCompleteRef.current = false;
            typewriterTickRef.current = 0;
            introStartTimeRef.current = Date.now();
            setGameState('level_intro');
        }
        prevModeForIntro.current = mode;
    }, [mode]);

    // Ensure enemies and player state are initialized when level loads
    useEffect(() => {
        resetPlayer();
    }, [resetPlayer]);

    const updatePhysics = useCallback(() => {
        gameLoopFrameCount.current++;
        const player = playerRef.current;

        // Block all player input briefly after the intro screen ends
        if (inputGraceRef.current > 0) {
            inputGraceRef.current--;
            input.left = false; input.right = false; input.up = false; input.down = false; input.space = false;
        }

        let isCurrentlyTouchingHazard = false;

        if (player.dying > 0) {
            player.animationState = 'DYING';
            if (gameLoopFrameCount.current % 5 === 0) player.animationFrame++;
            player.dying--;
            if (player.dying === 0) { player.isDead = true; setGameState('dead'); }
            return;
        }
        if (gameState === 'dead' || gameState === 'won' || gameState === 'paused' || gameState === 'level_intro') return;
        if (player.teleportCooldown > 0) player.teleportCooldown--;
        if (player.jumpCooldown > 0) player.jumpCooldown--;
        if (player.ladderSwitchCooldown > 0) player.ladderSwitchCooldown--;
        if (player.ladderGrabCooldown > 0) player.ladderGrabCooldown--;
        if (player.ladderSidewaysCooldown > 0) player.ladderSidewaysCooldown--;
        if (player.collisionDisabledCooldown > 0) player.collisionDisabledCooldown--;
        if (player.justDismountedCooldown > 0) player.justDismountedCooldown--;

        // --- Crate helpers (used in crate physics, moveX, moveY, and slime-crate) ---
        const isSolidForCrate = (cx: number, cy: number, excludeId?: string): boolean => {
            const gx1 = Math.floor(cx / TILE_SIZE);
            const gy1 = Math.floor(cy / TILE_SIZE);
            const gx2 = Math.floor((cx + TILE_SIZE - 1) / TILE_SIZE);
            const gy2 = Math.floor((cy + TILE_SIZE - 1) / TILE_SIZE);
            for (let gx = gx1; gx <= gx2; gx++) {
                for (let gy = gy1; gy <= gy2; gy++) {
                    const idx = getGridIndex(gx, gy);
                    if (idx !== -1 && spatialGrid[idx]) {
                        const hasSolid = spatialGrid[idx]!.some(p => {
                            const t = assets[p.assetId]?.type;
                            return t === 'PLATFORM' || (t === 'DOOR' && !player.hasKey);
                        });
                        if (hasSolid) return true;
                    }
                }
            }
            return crateStatesRef.current.some(c =>
                c.id !== excludeId &&
                cx < c.x + TILE_SIZE && cx + TILE_SIZE > c.x &&
                cy < c.y + TILE_SIZE && cy + TILE_SIZE > c.y
            );
        };

        const handleCrateTeleport = (crate: CrateState) => {
            if (crate.lastTeleporterId) {
                const lastTp = memoizedTeleporters.find(p => p.id === crate.lastTeleporterId);
                if (lastTp) {
                    if (!(crate.x < lastTp.x + TILE_SIZE && crate.x + TILE_SIZE > lastTp.x &&
                          crate.y < lastTp.y + TILE_SIZE && crate.y + TILE_SIZE > lastTp.y)) {
                        crate.lastTeleporterId = null;
                    }
                } else {
                    crate.lastTeleporterId = null;
                }
            }
            const crateCX = crate.x + TILE_SIZE / 2;
            const crateCY = crate.y + TILE_SIZE / 2;
            const tp = memoizedTeleporters.find(p => {
                if (p.id === crate.lastTeleporterId) return false;
                return Math.abs(crateCX - (p.x + TILE_SIZE / 2)) <= 3 && Math.abs(crateCY - (p.y + TILE_SIZE / 2)) <= 3;
            });
            if (tp && tp.teleporterPairId !== undefined) {
                const dest = memoizedTeleporters.find(p => p.id !== tp.id && p.teleporterPairId === tp.teleporterPairId);
                if (dest) {
                    const destOccupied = crateStatesRef.current.some(c =>
                        c.id !== crate.id &&
                        dest.x < c.x + TILE_SIZE && dest.x + TILE_SIZE > c.x &&
                        dest.y < c.y + TILE_SIZE && dest.y + TILE_SIZE > c.y
                    );
                    if (!destOccupied) {
                        crate.x = dest.x; crate.y = dest.y;
                        crate.lastTeleporterId = dest.id;
                        playTeleportSound();
                    }
                }
            }
        };

        // Slime logic (Patrol) - uses forEach to avoid creating new array each frame
        enemyStatesRef.current.forEach(enemy => {
            const enemyAsset = assets[enemy.assetId];
            if (enemy.cooldown > 0) { enemy.cooldown--; enemy.animationState = 'WALKING'; return; }
            enemy.animationState = 'WALKING';

            // Position-based sprite switching: sprite 1 at 0 and 16 pixels, sprite 2 at 1+ pixels
            const distanceMoved = Math.abs(enemy.x - (enemy.cycleStartX || enemy.x));
            if (distanceMoved === 0 || distanceMoved >= 16) {
                enemy.animationFrame = 0; // sprite 1
            } else {
                enemy.animationFrame = 1; // sprite 2
            }
            // Helper: check for crate at a given tile column (same logic as wall check)
            const crateAtTileCol = (tileCol: number) => crateStatesRef.current.find(c =>
                c.x < (tileCol + 1) * TILE_SIZE && c.x + TILE_SIZE > tileCol * TILE_SIZE &&
                enemy.y < c.y + TILE_SIZE && enemy.y + TILE_SIZE > c.y
            );
            switch (enemy.moveState) {
                case 'IDLE': {
                    const checkDir = enemy.direction;
                    const headingEdgeX = enemy.x + (checkDir > 0 ? TILE_SIZE : -1);
                    const wallCheckGridX = Math.floor(headingEdgeX / TILE_SIZE);
                    const enemyGridY = Math.floor((enemy.y + TILE_SIZE / 2) / TILE_SIZE);
                    const groundGridY = Math.floor((enemy.y + TILE_SIZE) / TILE_SIZE);

                    const wIdx = getGridIndex(wallCheckGridX, enemyGridY);
                    const gIdx = getGridIndex(wallCheckGridX, groundGridY);

                    const wallAhead = wIdx !== -1 && spatialGrid[wIdx]?.some(p => assets[p.assetId]?.type === 'PLATFORM');
                    const groundAhead = gIdx !== -1 && spatialGrid[gIdx]?.some(p => { const asset = assets[p.assetId]; return asset && (asset.type === 'PLATFORM' || asset.type === 'LADDER'); });
                    const crateAhead = crateAtTileCol(wallCheckGridX);

                    if (crateAhead) {
                        const crateDestX = crateAhead.x + checkDir * TILE_SIZE;
                        if (!isSolidForCrate(crateDestX, crateAhead.y, crateAhead.id)) {
                            enemy.pushingCrateId = crateAhead.id;
                            enemy.moveState = 'ACCELERATING'; enemy.moveOriginX = enemy.x;
                            enemy.targetX = enemy.x + TILE_SIZE * checkDir; enemy.moveProgress = 0;
                            enemy.cycleStartX = enemy.x;
                        } else {
                            enemy.direction = (enemy.direction * -1) as (-1 | 1);
                            enemy.cooldown = PAUSE_DURATION_FRAMES;
                            enemy.cycleStartX = enemy.x;
                        }
                    } else if (wallAhead || !groundAhead) {
                        enemy.direction = (enemy.direction * -1) as (-1 | 1);
                        enemy.cooldown = PAUSE_DURATION_FRAMES;
                        enemy.cycleStartX = enemy.x;
                    } else {
                        enemy.moveState = 'ACCELERATING'; enemy.moveOriginX = enemy.x;
                        enemy.targetX = enemy.x + TILE_SIZE * checkDir; enemy.moveProgress = 0;
                        enemy.cycleStartX = enemy.x;
                    }
                    break;
                }
                case 'ACCELERATING': {
                    enemy.moveProgress += 1 / EASE_DURATION_FRAMES;
                    const easedProgress = easeInQuad(Math.min(1, enemy.moveProgress));
                    enemy.x = enemy.moveOriginX + (enemy.targetX - enemy.moveOriginX) * easedProgress;

                    // Sync pushed crate
                    if (enemy.pushingCrateId) {
                        const pc = crateStatesRef.current.find(c => c.id === enemy.pushingCrateId);
                        if (pc) {
                            const prevX = pc.x;
                            pc.x = enemy.x + TILE_SIZE * enemy.direction;
                            const deltaX = pc.x - prevX;
                            if (deltaX !== 0 &&
                                pc.x < player.x + player.width && pc.x + TILE_SIZE > player.x &&
                                pc.y < player.y + player.height && pc.y + TILE_SIZE > player.y) {
                                player.x += deltaX;
                            }
                            // Check for edge tipping
                            if (pc.tipState === 'NONE') {
                                const sign = enemy.direction;
                                const trailingCol = sign > 0 ? Math.floor(pc.x / TILE_SIZE) : Math.floor((pc.x + TILE_SIZE - 1) / TILE_SIZE);
                                const overhang = sign * (pc.x - trailingCol * TILE_SIZE);
                                if (overhang >= 5) {
                                    const leadingCol = trailingCol + sign;
                                    const belowGY = Math.floor((pc.y + TILE_SIZE) / TILE_SIZE);
                                    const groundAtCol = (col: number) => {
                                        const idx = getGridIndex(col, belowGY);
                                        if (idx !== -1 && spatialGrid[idx]?.some(p => { const t = assets[p.assetId]?.type; return t === 'PLATFORM' || (t === 'DOOR' && !player.hasKey); })) return true;
                                        return crateStatesRef.current.some(c => c.id !== pc.id && c.x >= col * TILE_SIZE && c.x < (col + 1) * TILE_SIZE && c.y === pc.y + TILE_SIZE);
                                    };
                                    if (groundAtCol(trailingCol) && !groundAtCol(leadingCol)) {
                                        pc.tipState = 'TIPPING'; pc.tipAngle = 45; pc.tipDirection = sign;
                                        pc.tipPivotX = (trailingCol + (sign > 0 ? 1 : 0)) * TILE_SIZE;
                                        pc.tipPivotY = pc.y + TILE_SIZE; pc.pushCooldown = 10;
                                        enemy.pushingCrateId = null;
                                        enemy.direction = (enemy.direction * -1) as (-1 | 1);
                                        enemy.moveState = 'IDLE'; enemy.cooldown = PAUSE_DURATION_FRAMES;
                                        enemy.cycleStartX = enemy.x;
                                    }
                                }
                            }
                        }
                    }

                    if (enemy.moveProgress >= 1) {
                        enemy.x = enemy.targetX;
                        if (enemy.pushingCrateId) {
                            // Push done: snap crate and turn around
                            const pc = crateStatesRef.current.find(c => c.id === enemy.pushingCrateId);
                            if (pc) pc.x = enemy.targetX + TILE_SIZE * enemy.direction;
                            enemy.pushingCrateId = null;
                            enemy.direction = (enemy.direction * -1) as (-1 | 1);
                            enemy.moveState = 'IDLE'; enemy.cooldown = PAUSE_DURATION_FRAMES;
                            enemy.cycleStartX = enemy.x;
                        } else {
                            // Check 2nd tile: wall, edge, OR crate
                            const checkDir = enemy.direction;
                            const headingEdgeX = enemy.x + (checkDir > 0 ? TILE_SIZE : -1);
                            const wallCheckGridX = Math.floor(headingEdgeX / TILE_SIZE);
                            const enemyGridY = Math.floor((enemy.y + TILE_SIZE / 2) / TILE_SIZE);
                            const groundGridY = Math.floor((enemy.y + TILE_SIZE) / TILE_SIZE);
                            const wIdx = getGridIndex(wallCheckGridX, enemyGridY);
                            const gIdx = getGridIndex(wallCheckGridX, groundGridY);
                            const wallAhead = wIdx !== -1 && spatialGrid[wIdx]?.some(p => assets[p.assetId]?.type === 'PLATFORM');
                            const groundAhead = gIdx !== -1 && spatialGrid[gIdx]?.some(p => { const a = assets[p.assetId]; return a && (a.type === 'PLATFORM' || a.type === 'LADDER'); });
                            const crateAt2nd = crateAtTileCol(wallCheckGridX);

                            if (crateAt2nd && !wallAhead && groundAhead) {
                                const crateDestX = crateAt2nd.x + checkDir * TILE_SIZE;
                                if (!isSolidForCrate(crateDestX, crateAt2nd.y, crateAt2nd.id)) {
                                    // Push crate on 2nd tile (DECELERATING phase)
                                    enemy.pushingCrateId = crateAt2nd.id;
                                    enemy.moveState = 'MID_PAUSE'; enemy.cooldown = MID_PAUSE_DURATION_FRAMES;
                                } else {
                                    enemy.direction = (enemy.direction * -1) as (-1 | 1);
                                    enemy.moveState = 'IDLE'; enemy.cooldown = PAUSE_DURATION_FRAMES;
                                    enemy.cycleStartX = enemy.x;
                                }
                            } else if (wallAhead || !groundAhead) {
                                enemy.direction = (enemy.direction * -1) as (-1 | 1);
                                enemy.moveState = 'IDLE'; enemy.cooldown = PAUSE_DURATION_FRAMES;
                                enemy.cycleStartX = enemy.x;
                            } else {
                                enemy.moveState = 'MID_PAUSE'; enemy.cooldown = MID_PAUSE_DURATION_FRAMES;
                            }
                        }
                    }
                    break;
                }
                case 'MID_PAUSE': {
                    enemy.moveState = 'DECELERATING'; enemy.moveOriginX = enemy.x;
                    enemy.targetX = enemy.x + TILE_SIZE * enemy.direction; enemy.moveProgress = 0;
                    // Don't update cycleStartX here - we're continuing the same cycle
                    break;
                }
                case 'DECELERATING': {
                    enemy.moveProgress += 1 / EASE_DURATION_FRAMES;
                    const easedProgress = easeOutQuad(Math.min(1, enemy.moveProgress));
                    enemy.x = enemy.moveOriginX + (enemy.targetX - enemy.moveOriginX) * easedProgress;

                    // Sync pushed crate during deceleration
                    if (enemy.pushingCrateId) {
                        const pc = crateStatesRef.current.find(c => c.id === enemy.pushingCrateId);
                        if (pc) {
                            const prevX = pc.x;
                            pc.x = enemy.x + TILE_SIZE * enemy.direction;
                            const deltaX = pc.x - prevX;
                            if (deltaX !== 0 &&
                                pc.x < player.x + player.width && pc.x + TILE_SIZE > player.x &&
                                pc.y < player.y + player.height && pc.y + TILE_SIZE > player.y) {
                                player.x += deltaX;
                            }
                            // Check for edge tipping
                            if (pc.tipState === 'NONE') {
                                const sign = enemy.direction;
                                const trailingCol = sign > 0 ? Math.floor(pc.x / TILE_SIZE) : Math.floor((pc.x + TILE_SIZE - 1) / TILE_SIZE);
                                const overhang = sign * (pc.x - trailingCol * TILE_SIZE);
                                if (overhang >= 5) {
                                    const leadingCol = trailingCol + sign;
                                    const belowGY = Math.floor((pc.y + TILE_SIZE) / TILE_SIZE);
                                    const groundAtCol = (col: number) => {
                                        const idx = getGridIndex(col, belowGY);
                                        if (idx !== -1 && spatialGrid[idx]?.some(p => { const t = assets[p.assetId]?.type; return t === 'PLATFORM' || (t === 'DOOR' && !player.hasKey); })) return true;
                                        return crateStatesRef.current.some(c => c.id !== pc.id && c.x >= col * TILE_SIZE && c.x < (col + 1) * TILE_SIZE && c.y === pc.y + TILE_SIZE);
                                    };
                                    if (groundAtCol(trailingCol) && !groundAtCol(leadingCol)) {
                                        pc.tipState = 'TIPPING'; pc.tipAngle = 45; pc.tipDirection = sign;
                                        pc.tipPivotX = (trailingCol + (sign > 0 ? 1 : 0)) * TILE_SIZE;
                                        pc.tipPivotY = pc.y + TILE_SIZE; pc.pushCooldown = 10;
                                        enemy.pushingCrateId = null;
                                        enemy.direction = (enemy.direction * -1) as (-1 | 1);
                                        enemy.moveState = 'IDLE'; enemy.cooldown = PAUSE_DURATION_FRAMES;
                                        enemy.cycleStartX = enemy.x;
                                    }
                                }
                            }
                        }
                    }

                    if (enemy.moveProgress >= 1) {
                        enemy.x = enemy.targetX;
                        if (enemy.pushingCrateId) {
                            const pc = crateStatesRef.current.find(c => c.id === enemy.pushingCrateId);
                            if (pc) pc.x = enemy.targetX + TILE_SIZE * enemy.direction;
                            enemy.pushingCrateId = null;
                            enemy.direction = (enemy.direction * -1) as (-1 | 1);
                            enemy.cycleStartX = enemy.x;
                        }
                        enemy.moveState = 'IDLE'; enemy.cooldown = PAUSE_DURATION_FRAMES;
                        enemy.cycleStartX = enemy.x; // Reset cycle start for next movement
                    }
                    break;
                }
            }
        });

        // Crate Physics: gravity, spring bounce, teleporter
        crateStatesRef.current.forEach(crate => {
            if (crate.pushCooldown > 0) crate.pushCooldown--;

            // Tipping: hold 45° for 15 frames (pushCooldown used as timer), then snap
            if (crate.tipState === 'TIPPING') {
                if (crate.pushCooldown <= 0) {
                    crate.x = crate.tipDirection > 0 ? crate.tipPivotX : crate.tipPivotX - TILE_SIZE;
                    crate.y += 4;
                    crate.tipState = 'NONE';
                    crate.vy = 0;
                }
                return; // skip gravity while tipping
            }

            crate.vy = Math.min(crate.vy + GRAVITY, MAX_FALL_SPEED);
            crate.onGround = false;
            crate.remainderY += crate.vy;
            let move = Math.round(crate.remainderY);
            let movedDown = false;
            // Check if player is standing on this crate before it moves
            const playerOnCrateTop =
                player.x + player.width > crate.x && player.x < crate.x + TILE_SIZE &&
                player.y + player.height >= crate.y && player.y + player.height <= crate.y + 1;
            const prevCrateY = crate.y;
            if (move !== 0) {
                crate.remainderY -= move;
                const sign = Math.sign(move);
                while (move !== 0) {
                    const nextY = crate.y + sign;
                    if (!isSolidForCrate(crate.x, nextY, crate.id)) {
                        crate.y += sign;
                        move -= sign;
                        if (sign > 0) {
                            movedDown = true;
                            // Check for spring overlap after each downward step
                            // Spring solid portion starts 3px from tile top (rows 3-7)
                            const cgx1 = Math.floor(crate.x / TILE_SIZE);
                            const cgx2 = Math.floor((crate.x + TILE_SIZE - 1) / TILE_SIZE);
                            const cgy2 = Math.floor((crate.y + TILE_SIZE - 1) / TILE_SIZE);
                            let springBounced = false;
                            for (let gx = cgx1; gx <= cgx2 && !springBounced; gx++) {
                                const idx = getGridIndex(gx, cgy2);
                                if (idx !== -1 && spatialGrid[idx]) {
                                    for (const p of spatialGrid[idx]!) {
                                        if (assets[p.assetId]?.type === 'SPRING') {
                                            if (crate.y + TILE_SIZE > p.y + 3) {
                                                crate.y = p.y + 3 - TILE_SIZE;
                                                crate.vy = physics.jumpForce * SPRING_BOUNCE_MULTIPLIER;
                                                crate.onGround = false;
                                                move = 0;
                                                springBounced = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            if (springBounced) break;
                        }
                    } else {
                        crate.vy = 0;
                        crate.remainderY = 0;
                        if (sign > 0) crate.onGround = true;
                        break;
                    }
                }
            }
            handleCrateTeleport(crate);

            // Carry player upward with crate (preserves bounce feel at peak; descent handled by hitCrateTop)
            if (playerOnCrateTop && crate.y < prevCrateY) {
                player.y += crate.y - prevCrateY;
            }

            // Case B crush: crate falling onto player who is standing on solid ground or spring
            // Uses player.onGround (previous frame) — isPlayerSolid is not yet defined here
            if (movedDown && !playerOnCrateTop && crate.tipState !== 'TIPPING' &&
                crate.x < player.x + player.width && crate.x + TILE_SIZE > player.x &&
                crate.y < player.y + player.height && crate.y + TILE_SIZE > player.y) {

                // Helper: check if a horizontal nudge position overlaps a platform tile
                const nudgeBlocked = (nx: number): boolean => {
                    const gx1 = Math.floor(nx / TILE_SIZE);
                    const gx2 = Math.floor((nx + player.width - 1) / TILE_SIZE);
                    const gy1 = Math.floor(player.y / TILE_SIZE);
                    const gy2 = Math.floor((player.y + player.height - 1) / TILE_SIZE);
                    for (let gx = gx1; gx <= gx2; gx++) {
                        for (let gy = gy1; gy <= gy2; gy++) {
                            const idx = getGridIndex(gx, gy);
                            if (idx !== -1 && spatialGrid[idx]?.some(p => assets[p.assetId]?.type === 'PLATFORM')) return true;
                        }
                    }
                    return false;
                };

                // Safe nudge: pick the unblocked side; prefer the side the player is already on
                const doNudge = () => {
                    const nudgeLeft = crate.x - player.width;
                    const nudgeRight = crate.x + TILE_SIZE;
                    const leftOk = !nudgeBlocked(nudgeLeft);
                    const rightOk = !nudgeBlocked(nudgeRight);
                    const preferLeft = player.x + player.width / 2 < crate.x + TILE_SIZE / 2;
                    if (leftOk && (preferLeft || !rightOk)) player.x = nudgeLeft;
                    else if (rightOk) player.x = nudgeRight;
                };

                const overlapX = Math.min(crate.x + TILE_SIZE, player.x + player.width) - Math.max(crate.x, player.x);
                const caught = Math.max(0, Math.min((crate.y + TILE_SIZE) - player.y, player.height));
                if (overlapX <= 3) {
                    // Glancing horizontal blow — nudge sideways
                    doNudge();
                } else if (caught > 3) {
                    // Check if player is on a spring (springs aren't solid so player.onGround may be false)
                    // Player bounced to sp.y, so feetY == sp.y; include full spring tile range
                    const feetY = player.y + player.height;
                    const pgx1 = Math.floor(player.x / TILE_SIZE);
                    const pgx2 = Math.floor((player.x + player.width - 1) / TILE_SIZE);
                    const pgy = Math.floor(feetY / TILE_SIZE);
                    let playerOnSpring = false;
                    for (let gx = pgx1; gx <= pgx2 && !playerOnSpring; gx++) {
                        const idx = getGridIndex(gx, pgy);
                        if (idx !== -1 && spatialGrid[idx]) {
                            for (const sp of spatialGrid[idx]!) {
                                if (assets[sp.assetId]?.type === 'SPRING' && sp.y <= feetY && sp.y + TILE_SIZE >= feetY) {
                                    playerOnSpring = true; break;
                                }
                            }
                        }
                    }
                    // Large horizontal overlap and deep vertical crush
                    if ((player.onGround || playerOnSpring) && !player.isInvincible && !player.isSpikeImmune && player.dying <= 0 && !player.isDead) {
                        player.dying = 30; player.vy = -2; playDeathSound();
                    } else if (!player.onGround && !playerOnSpring) {
                        // Not grounded — nudge sideways so player can escape
                        doNudge();
                    }
                }
                // caught <= 3 with large horizontal overlap: no action yet, let crate descend further
            }
        });

        // Puddle Logic (Crawler with Graph AI)
        puddleStatesRef.current.forEach(puddle => {
            const asset = assets[puddle.assetId];
            if (asset && gameLoopFrameCount.current % (Math.round(60 / (asset.animationFps || 5))) === 0) puddle.animationFrame++;

            // Run AI & Physics
            updatePuddle(puddle, { x: player.x, y: player.y, w: player.width, h: player.height }, spatialGrid, assets, puddleStatesRef.current);

            // Map AI state to Animation State
            if (puddle.state === 'WALKING' && puddle.isTurningCorner && puddle.cornerType) {
                if (puddle.cornerType === 'CONVEX') puddle.animationState = 'CORNER_CONVEX';
                else if (puddle.cornerType === 'CONCAVE') puddle.animationState = 'CORNER_CONCAVE';
            } else {
                puddle.animationState = puddle.state; // WALKING, CLIMBING, FALLING, LANDING
            }
        });

        // Bad Man Logic
        const teleporterPairs = new Map<string, PlacedAsset>();
        // Build map: Pair ID -> Partner Asset (Optimization: do this once or use memoized list if simple)
        // Actually, updateBadMan needs Map<teleporterId, PartnerAsset>.
        // memoizedTeleporters has all.
        memoizedTeleporters.forEach(t => {
            if (t.teleporterPairId !== undefined) {
                const partner = memoizedTeleporters.find(other => other.id !== t.id && other.teleporterPairId === t.teleporterPairId);
                if (partner) teleporterPairs.set(t.id, partner);
            }
        });

        badManStatesRef.current.forEach(badMan => {
            const asset = assets[badMan.assetId];
            if (asset) {
                const fps = asset.animationFps || 10;
                if (gameLoopFrameCount.current % (Math.round(60 / fps)) === 0) badMan.animationFrame++;
            }

            updateBadMan(
                badMan,
                { x: player.x, y: player.y },
                teleporterHistoryRef.current,
                spatialGrid,
                assets,
                teleporterPairs
            );
        });

        // Bad Man Collision
        // Bad Man Collision
        badManStatesRef.current.forEach(badMan => {
            const badManAsset = assets[badMan.assetId];
            if (!badManAsset) return;

            const isColliding = checkPixelCollision(
                playerAsset,
                { x: player.x, y: player.y, animationState: player.animationState, animationFrame: player.animationFrame, facingDirection: player.facingDirection },
                badManAsset,
                { x: badMan.x, y: badMan.y, animationState: badMan.animationState, animationFrame: badMan.animationFrame, facingDirection: badMan.facingDirection }
            );

            if (isColliding) {
                // If already stunned, bad man is harmless (pass through)
                if (badMan.stunTimer && badMan.stunTimer > 0) return;

                const playerBottom = player.y + player.height;
                const badManCenterY = badMan.y + badMan.height / 2;

                // Stomp Condition: Falling and feet are above user's midpoint (or top portion)
                if (player.vy > 0 && playerBottom < badManCenterY + 4) {
                    // Stomp!
                    badMan.stunTimer = 60; // 1 second at 60fps
                    player.vy = -3.5; // Bounce
                    playJumpSound();
                } else {
                    // Touch Damage
                    isCurrentlyTouchingHazard = true;
                    if (!player.isSpikeImmune && !player.isInvincible && player.dying <= 0 && !player.isDead) {
                        player.dying = 30; player.vy = -2; playDeathSound();
                    }
                }
            }
        });

        if (player.isDismounting) {
            const targetX = player.targetX as number, targetY = player.targetY as number;
            const speed = LADDER_CLIMB_SPEED, dx = targetX - player.x, dy = targetY - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < speed) {
                player.x = targetX; player.y = targetY; player.isDismounting = false;
                player.targetX = null; player.targetY = null; player.onGround = true;
                player.currentLadderId = null; player.ladderGrabCooldown = 15;
                player.justDismountedCooldown = 5;
            } else { player.x += (dx / distance) * speed; player.y += (dy / distance) * speed; }
            return;
        }

        // --- NEW PHYSICS ENGINE START ---
        // 1. Scene Analysis (Optimized Spatial Query)
        const playerGridX = Math.floor((player.x + player.width / 2) / TILE_SIZE);
        const playerGridY = Math.floor((player.y + player.height / 2) / TILE_SIZE);
        const nearbyAssets: PlacedAsset[] = [];
        // Increase search radius slightly slightly for reliability to 2
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const idx = getGridIndex(playerGridX + dx, playerGridY + dy);
                if (idx !== -1 && spatialGrid[idx]) {
                    nearbyAssets.push(...spatialGrid[idx]!);
                }
            }
        }

        // Build lists of solid platforms and ladders from nearby assets (avoid creating temporary arrays)
        interface PlatformCollider {
            x: number;
            y: number;
            mask: CollisionMask;
        }
        const platformColliders: PlatformCollider[] = [];
        const ladders: PlacedAsset[] = [];

        for (const p of nearbyAssets) {
            const type = assets[p.assetId]?.type;
            if (type === 'PLATFORM' || (type === 'DOOR' && !player.hasKey)) {
                // Use cached collision mask instead of generating one
                const maskKey = `${p.x},${p.y}`;
                const cachedMask = collisionMaskCache.get(maskKey);
                if (cachedMask) {
                    platformColliders.push({ x: p.x, y: p.y, mask: cachedMask });
                }
            } else if (type === 'LADDER') {
                ladders.push(p);
            } else if (type === 'LEVEL_LADDER') {
                // Only treat as ladder if no gems remain
                // Note: localLevelData is filtered by collectedAssetIds in gameLoop, so we can check it directly
                // But updatePhysics uses memoizedSpatialGrid? nearbyAssets comes from spatialGrid.
                // Let's use localLevelData for gem count check as it's cleaner.
                const hasRemainingGems = localLevelData.some(p => assets[p.assetId]?.type === 'GEM');
                if (!hasRemainingGems) {
                    ladders.push(p);
                }
            }
        }

        // SIMPLE BYPASS: More lenient range to prevent falling out during grab
        const pressingDownNearLadder = (player.state === 'IDLE' || player.state === 'RUN') &&
            input.down &&
            ladders.some(l => {
                const feetY = player.y + player.height;
                const playerLeft = player.x;
                const playerRight = player.x + player.width;
                const overlapLeft = Math.max(playerLeft, l.x);
                const overlapRight = Math.min(playerRight, l.x + TILE_SIZE);
                const overlapWidth = overlapRight - overlapLeft;
                // Allow wider vertical range (up to 6 pixels below) to prevent falling out during grab
                return overlapWidth >= 2 && feetY >= l.y && feetY <= l.y + 6;
            });

        const inClimbTransition = player.state === 'CLIMB' && player.ladderSidewaysCooldown > 0;
        const bypassCollision = pressingDownNearLadder || inClimbTransition;

        const isPlayerSolid = (x: number, y: number, ignoreMask = false): boolean => {
            // Bypass ALL collision when near ladder pressing down OR during climb transition
            if (bypassCollision) {
                return false;
            }

            const px = x, py = y, w = player.width, h = player.height;

            for (const collider of platformColliders) {
                // First do AABB check
                if (px >= collider.x + TILE_SIZE || px + w <= collider.x ||
                    py >= collider.y + TILE_SIZE || py + h <= collider.y) {
                    continue; // No overlap
                }

                if (ignoreMask) return true; // Treat as solid rectangle if ignoring mask

                // Pixel-perfect check using collision mask
                const xMin = Math.max(px, collider.x);
                const xMax = Math.min(px + w, collider.x + TILE_SIZE);
                const yMin = Math.max(py, collider.y);
                const yMax = Math.min(py + h, collider.y + TILE_SIZE);

                for (let checkY = yMin; checkY < yMax; checkY++) {
                    for (let checkX = xMin; checkX < xMax; checkX++) {
                        const maskX = Math.floor(checkX - collider.x);
                        const maskY = Math.floor(checkY - collider.y);

                        if (maskX >= 0 && maskX < TILE_SIZE && maskY >= 0 && maskY < TILE_SIZE) {
                            if (collider.mask[maskY][maskX]) {
                                return true; // Collision detected
                            }
                        }
                    }
                }
            }

            return false;
        };

        const nearbyInteractiveAssets = nearbyAssets.filter(p => {
            const asset = assets[p.assetId];
            if (!asset) return false;
            const interactiveTypes: AssetType[] = ['SPIKE', 'SPRING', 'GEM', 'KEY', 'PILL', 'DOOR', 'CHEST', 'TELEPORTER'];
            return interactiveTypes.includes(asset.type);
        });

        // ------------------------------------------------------------------
        // NEW: Calculate Grounded State BEFORE Physics Helpers
        // ------------------------------------------------------------------

        // Check if standing on top of a ladder (treat ladder tops as solid ground)
        const feetY = player.y + player.height;

        let isOnLadderTop = ladders.some(l => {
            // Check horizontal overlap
            if (!(player.x + player.width > l.x && player.x < l.x + TILE_SIZE)) return false;

            // Check feet are at the top of this ladder
            if (!(feetY >= l.y && feetY <= l.y + 2)) return false;

            // Logic for Solid Ladder Top:
            // 1. Always solid if it's a Top Ladder (no ladder above)
            const hasLadderAbove = ladders.some(above =>
                above.x === l.x && above.y === l.y - TILE_SIZE
            );

            if (!hasLadderAbove) return true;

            // 2. Middle Ladders are solid ONLY if we are currently "Walking" (IDLE/RUN)
            // AND we are NOT pressing down (User request: "unless the user presses the down key")
            const isWalking = player.state === 'IDLE' || player.state === 'RUN';
            if (isWalking && !input.down) {
                return true;
            }

            return false;
        });

        // Bypass ladder top collision when bypassing all collision
        if (bypassCollision) {
            isOnLadderTop = false;
        }

        // Current Grounded State (at start of physics frame)
        // Used by moveY to determine if we should "stick" to middle ladders
        const isOnCrateTop = crateStatesRef.current.some(c =>
            player.x + player.width > c.x && player.x < c.x + TILE_SIZE &&
            player.y + player.height >= c.y && player.y + player.height <= c.y + 1
        );
        // Which specific crate (if any) the player is standing on at the start of this frame.
        // Used to exclude it from horizontal push detection (prevents treating the crate below as a side obstacle).
        const groundedCrateId = isOnCrateTop ? (crateStatesRef.current.find(c =>
            player.x + player.width > c.x && player.x < c.x + TILE_SIZE &&
            player.y + player.height >= c.y && player.y + player.height <= c.y + 1
        )?.id ?? null) : null;
        let isGrounded = isPlayerSolid(player.x, player.y + 1) || isOnLadderTop || isOnCrateTop;

        // Pushing is only allowed when standing on solid ground OR on a TOP ladder top (not middle, not crate)
        const isOnTopLadderOnly = ladders.some(l => {
            if (!(player.x + player.width > l.x && player.x < l.x + TILE_SIZE)) return false;
            if (!(feetY >= l.y && feetY <= l.y + 2)) return false;
            const hasLadderAbove = ladders.some(above => above.x === l.x && above.y === l.y - TILE_SIZE);
            return !hasLadderAbove;
        });
        const canPushCrate = isPlayerSolid(player.x, player.y + 1) || isOnTopLadderOnly;

        // 2. Physics Helpers
        let isActuallyPushingCrate = false;
        let pushedCrateId: string | null = null;
        const moveX = (amount: number) => {
            // Detect adjacent crate: manage push-intent timer, speed reduction, and animation
            if (amount !== 0) {
                const pushSign = Math.sign(amount);
                const checkX = player.x + pushSign;
                const adjacentCrate = crateStatesRef.current.find(c => {
                    if (c.id === groundedCrateId) return false; // don't push the crate we're standing on
                    return checkX < c.x + TILE_SIZE && checkX + player.width > c.x &&
                        player.y < c.y + TILE_SIZE && player.y + player.height >= c.y &&
                        c.y <= player.y + 3; // only push if crate top is within 3px of player top
                });
                if (adjacentCrate && canPushCrate) {
                    // Track how long player has held direction toward this crate
                    if (pushSign !== pushIntentRef.current.dir) {
                        pushIntentRef.current = { dir: pushSign, count: 1 };
                    } else {
                        pushIntentRef.current.count++;
                    }
                    amount *= 0.7;
                    pushedCrateId = adjacentCrate.id; // prevent snap-backward even on 0-px frames
                    isActuallyPushingCrate = true; // show PUSHING animation immediately
                } else {
                    pushIntentRef.current = { dir: 0, count: 0 };
                }
            } else {
                pushIntentRef.current = { dir: 0, count: 0 };
            }
            player.remainderX += amount;
            let move = Math.round(player.remainderX);
            if (move !== 0) {
                player.remainderX -= move;
                const sign = Math.sign(move);
                while (move !== 0) {
                    const nextX = player.x + sign;
                    // Crate push: check if a crate is in the way and try to push it
                    const pushCrate = crateStatesRef.current.find(c => {
                        if (c.id === groundedCrateId) return false; // don't push the crate we're standing on
                        return nextX < c.x + TILE_SIZE && nextX + player.width > c.x &&
                            player.y < c.y + TILE_SIZE && player.y + player.height >= c.y &&
                            c.y <= player.y + 3; // only push if crate top is within 3px of player top
                    });
                    if (pushCrate) {
                        // Block while tipping, on snap-pause, player not grounded, or intent timer not reached
                        if (pushCrate.tipState === 'TIPPING' || (pushCrate.pushCooldown > 0 && pushCrate.tipState !== 'TIPPING') || !canPushCrate || pushIntentRef.current.count < PUSH_INTENT_FRAMES) {
                            // Corner correction for immovable crate
                            let crateCorrected = false;
                            if (Math.abs(amount) > 0.01) {
                                const overlapTop = (player.y + player.height) - pushCrate.y;
                                const overlapBottom = (pushCrate.y + TILE_SIZE) - player.y;
                                const snapLimit = isGrounded ? CORNER_CORRECTION : 2;
                                // Don't snap at all if standing on a crate and the adjacent crate is moving —
                                // upward snap yanks player off their platform; downward snap pushes them into it
                                const allowCornerSnap = !isOnCrateTop || pushCrate.vy === 0;
                                if (allowCornerSnap && overlapTop > 0 && overlapTop <= snapLimit && !isPlayerSolid(nextX, pushCrate.y - player.height)) {
                                    player.y = pushCrate.y - player.height;
                                    player.x += sign; move -= sign; crateCorrected = true;
                                } else if (allowCornerSnap && overlapBottom > 0 && overlapBottom <= CORNER_CORRECTION && !isPlayerSolid(nextX, pushCrate.y + TILE_SIZE)) {
                                    player.y = pushCrate.y + TILE_SIZE;
                                    player.x += sign; move -= sign; crateCorrected = true;
                                }
                            }
                            if (!crateCorrected) { player.vx = 0; player.remainderX = 0; break; }
                            continue;
                        }
                        const crateDestX = pushCrate.x + sign;
                        const slimeBlocksCrate = enemyStatesRef.current.some(e =>
                            crateDestX < e.x + TILE_SIZE && crateDestX + TILE_SIZE > e.x &&
                            pushCrate.y < e.y + TILE_SIZE && pushCrate.y + TILE_SIZE > e.y
                        );
                        if (!isSolidForCrate(crateDestX, pushCrate.y, pushCrate.id) && !slimeBlocksCrate) {
                            pushCrate.x = crateDestX;
                            handleCrateTeleport(pushCrate);
                            // 3-frame snap pause at tile boundary
                            if (pushCrate.x % TILE_SIZE === 0 && pushCrate.tipState !== 'TIPPING') {
                                pushCrate.pushCooldown = 3;
                            }
                            isActuallyPushingCrate = true;
                            pushedCrateId = pushCrate.id;

                            // Edge tipping: 5px overhang, only when not already tipping
                            if (pushCrate.tipState !== 'TIPPING') {
                                const trailingCol = sign > 0
                                    ? Math.floor(pushCrate.x / TILE_SIZE)
                                    : Math.floor((pushCrate.x + TILE_SIZE - 1) / TILE_SIZE);
                                const overhang = sign * (pushCrate.x - trailingCol * TILE_SIZE);
                                if (overhang === 5) {
                                    const leadingCol = trailingCol + sign;
                                    const belowGY = Math.floor((pushCrate.y + TILE_SIZE) / TILE_SIZE);
                                    const groundAtCol = (col: number) => {
                                        const idx = getGridIndex(col, belowGY);
                                        if (idx !== -1 && spatialGrid[idx]?.some(p => {
                                            const t = assets[p.assetId]?.type;
                                            return t === 'PLATFORM' || (t === 'DOOR' && !player.hasKey);
                                        })) return true;
                                        return crateStatesRef.current.some(c =>
                                            c.id !== pushCrate.id &&
                                            c.x >= col * TILE_SIZE && c.x < (col + 1) * TILE_SIZE &&
                                            c.y === pushCrate.y + TILE_SIZE
                                        );
                                    };
                                    if (groundAtCol(trailingCol) && !groundAtCol(leadingCol)) {
                                        pushCrate.tipState = 'TIPPING';
                                        pushCrate.tipAngle = 45;
                                        pushCrate.tipDirection = sign as (-1 | 1);
                                        pushCrate.tipPivotX = (trailingCol + (sign > 0 ? 1 : 0)) * TILE_SIZE;
                                        pushCrate.tipPivotY = pushCrate.y + TILE_SIZE;
                                        pushCrate.pushCooldown = 10;
                                    }
                                }
                            }

                            player.x += sign;
                            move -= sign;
                        } else {
                            // Corner correction for crate that can't be pushed
                            let crateCorrected = false;
                            if (Math.abs(amount) > 0.01) {
                                const overlapTop = (player.y + player.height) - pushCrate.y;
                                const overlapBottom = (pushCrate.y + TILE_SIZE) - player.y;
                                if (overlapTop > 0 && overlapTop <= CORNER_CORRECTION && !isPlayerSolid(nextX, pushCrate.y - player.height)) {
                                    player.y = pushCrate.y - player.height;
                                    player.x += sign; move -= sign; crateCorrected = true;
                                } else if (overlapBottom > 0 && overlapBottom <= CORNER_CORRECTION && !isPlayerSolid(nextX, pushCrate.y + TILE_SIZE)) {
                                    player.y = pushCrate.y + TILE_SIZE;
                                    player.x += sign; move -= sign; crateCorrected = true;
                                }
                            }
                            if (!crateCorrected) { player.vx = 0; player.remainderX = 0; break; }
                        }
                        continue;
                    }
                    if (!isPlayerSolid(nextX, player.y)) {
                        player.x += sign;
                        move -= sign;
                    } else {
                        // During collision bypass, ignore ALL collision response
                        if (bypassCollision) {
                            player.x += sign;
                            move -= sign;
                            continue;
                        }

                        // Collision - Corner Correction (inline loop to avoid filter allocation)
                        let corrected = false;
                        if (Math.abs(amount) > 0.01) {
                            for (const wall of platformColliders) {
                                // Check if this platform is being hit
                                if (!(nextX < wall.x + TILE_SIZE && nextX + player.width > wall.x &&
                                    player.y < wall.y + TILE_SIZE && player.y + player.height > wall.y)) continue;

                                const overlapTop = (player.y + player.height) - wall.y;
                                const overlapBottom = (wall.y + TILE_SIZE) - player.y;

                                // Slide Up (Floor Corner)
                                if (overlapTop > 0 && overlapTop <= CORNER_CORRECTION && !isPlayerSolid(nextX, wall.y - player.height)) {
                                    player.y = wall.y - player.height;
                                    player.x += sign;
                                    move -= sign;
                                    corrected = true;
                                    break;
                                }
                                // Slide Down (Ceiling Corner)
                                else if (overlapBottom > 0 && overlapBottom <= CORNER_CORRECTION && !isPlayerSolid(nextX, wall.y + TILE_SIZE)) {
                                    player.y = wall.y + TILE_SIZE;
                                    player.x += sign;
                                    move -= sign;
                                    corrected = true;
                                    break;
                                }
                            }
                        }

                        if (!corrected) {
                            player.vx = 0;
                            player.remainderX = 0;
                            break;
                        }
                    }
                }
            }
        };

        const moveY = (amount: number) => {
            player.remainderY += amount;
            let move = Math.round(player.remainderY);
            if (move !== 0) {
                player.remainderY -= move;
                const sign = Math.sign(move);
                while (move !== 0) {
                    const nextY = player.y + sign;

                    // NEW: One-way collision with Ladder Tops (jump-through platform behavior)
                    // Only collide if moving DOWN, NOT pressing DOWN, and crossing the ladder top boundary
                    let hitLadderTop = false;
                    if (sign > 0 && !input.down && !bypassCollision) {
                        const feetY = player.y + player.height;
                        const nextFeetY = nextY + player.height;

                        hitLadderTop = ladders.some(l => {
                            // 1. Must check horizontal overlap
                            if (player.x + player.width <= l.x || player.x >= l.x + TILE_SIZE) return false;

                            // 2. Ladder Logic:
                            // Optimization: Check for ladder above in 'ladders' list
                            const hasLadderAbove = ladders.some(above =>
                                above.x === l.x && above.y === l.y - TILE_SIZE
                            );

                            // If it is a MIDDLE ladder (has ladder above), 
                            // we ONLY collide if we were grounded at the start of the frame (Walking onto it)
                            if (hasLadderAbove && !isGrounded) return false;

                            // 3. Must be crossing the boundary from above (or exactly at)
                            // feetY <= l.y means we are currently ON or ABOVE the line
                            // nextFeetY > l.y means we are attempting to cross BELOW the line
                            return feetY <= l.y && nextFeetY > l.y;
                        });
                    }

                    const hitCrateTop = sign > 0 && !bypassCollision && crateStatesRef.current.some(c =>
                        player.x + player.width > c.x && player.x < c.x + TILE_SIZE &&
                        player.y + player.height <= c.y && nextY + player.height > c.y
                    );
                    // Prevent player from jumping up through the bottom of a crate
                    const hitCrateBottom = sign < 0 && !bypassCollision && crateStatesRef.current.some(c =>
                        player.x + player.width > c.x && player.x < c.x + TILE_SIZE &&
                        player.y >= c.y + TILE_SIZE && nextY < c.y + TILE_SIZE
                    );
                    if (!isPlayerSolid(player.x, nextY) && !hitLadderTop && !hitCrateTop && !hitCrateBottom) {
                        player.y += sign;
                        move -= sign;
                    } else {
                        // During collision bypass, ignore ALL collision response
                        if (bypassCollision) {
                            player.y += sign;
                            move -= sign;
                            continue;
                        }

                        // Collision
                        // Ceiling Correction (X Nudge) - inline loop to avoid filter allocation
                        let corrected = false;
                        if (sign < 0) { // Moving Up hitting ceiling
                            for (const wall of platformColliders) {
                                // Check if this platform is being hit
                                if (!(player.x < wall.x + TILE_SIZE && player.x + player.width > wall.x &&
                                    nextY < wall.y + TILE_SIZE && nextY + player.height > wall.y)) continue;

                                const overlapLeft = (player.x + player.width) - wall.x;
                                const overlapRight = (wall.x + TILE_SIZE) - player.x;

                                if (overlapLeft <= CORNER_CORRECTION && !isPlayerSolid(wall.x - player.width, nextY)) {
                                    player.x = wall.x - player.width;
                                    player.y += sign;
                                    move -= sign;
                                    corrected = true;
                                    break;
                                } else if (overlapRight <= CORNER_CORRECTION && !isPlayerSolid(wall.x + TILE_SIZE, nextY)) {
                                    player.x = wall.x + TILE_SIZE;
                                    player.y += sign;
                                    move -= sign;
                                    corrected = true;
                                    break;
                                }
                            }
                            // Also try crate bottom corners
                            if (!corrected) {
                                for (const c of crateStatesRef.current) {
                                    if (!(player.x < c.x + TILE_SIZE && player.x + player.width > c.x &&
                                        nextY < c.y + TILE_SIZE && nextY + player.height > c.y)) continue;
                                    const overlapLeft = (player.x + player.width) - c.x;
                                    const overlapRight = (c.x + TILE_SIZE) - player.x;
                                    if (overlapLeft <= CORNER_CORRECTION && !isPlayerSolid(c.x - player.width, nextY)) {
                                        player.x = c.x - player.width;
                                        player.y += sign; move -= sign; corrected = true; break;
                                    } else if (overlapRight <= CORNER_CORRECTION && !isPlayerSolid(c.x + TILE_SIZE, nextY)) {
                                        player.x = c.x + TILE_SIZE;
                                        player.y += sign; move -= sign; corrected = true; break;
                                    }
                                }
                            }
                        } else {
                            player.vy = 0;
                            player.remainderY = 0;
                        }

                        if (!corrected) {
                            player.vy = 0;
                            player.remainderY = 0;
                            break;
                        }
                    }
                }
            }
        };

        // 3. State Machine Logic

        // NOTE: isGrounded and isOnLadderTop are now calculated ABOVE the Physics Helpers
        // to support correct "Walk onto Ladder" physics.

        // Check ladder overlap - include when player's feet are at the top of a ladder (for climbing down)
        const ladderOverlap = ladders.find(l =>
            player.x + player.width / 2 >= l.x && player.x + player.width / 2 <= l.x + TILE_SIZE &&
            (
                // Normal overlap (center inside ladder)
                (player.y + player.height / 2 >= l.y && player.y + player.height / 2 <= l.y + TILE_SIZE) ||
                // Standing on top of ladder (feet at ladder top)
                (feetY >= l.y && feetY <= l.y + 2)
            )
        );

        // Check for ladder grab when pressing down - requires at least 2 pixels of horizontal overlap
        const canGrabLadderDown = (ladder: PlacedAsset): boolean => {
            const playerLeft = player.x;
            const playerRight = player.x + player.width;
            const ladderLeft = ladder.x;
            const ladderRight = ladder.x + TILE_SIZE;

            // Calculate horizontal overlap
            const overlapLeft = Math.max(playerLeft, ladderLeft);
            const overlapRight = Math.min(playerRight, ladderRight);
            const overlapWidth = overlapRight - overlapLeft;

            // Check if at least 2 pixels overlap horizontally
            if (overlapWidth < 2) return false;

            // Check vertical overlap (feet at or above ladder top) - wider tolerance to prevent falling out
            return feetY >= ladder.y && feetY <= ladder.y + 6;
        };

        if (player.jumpCooldown > 0) player.jumpCooldown--;

        switch (player.state) {
            case 'IDLE':
            case 'RUN':
                // CHECK LADDER GRAB FIRST (before grounded check that would cause FALL)
                // Pressing DOWN: Check for 2+ pixel overlap with ladder
                if (input.down) {
                    const downLadder = ladders.find(l => canGrabLadderDown(l));
                    if (downLadder) {
                        player.state = 'CLIMB';
                        player.isClimbing = true;
                        player.ladderSidewaysCooldown = 8;
                        player.transitionStartX = player.x;
                        player.transitionTargetX = downLadder.x; // Lock target to prevent teleportation
                        break;
                    }
                }

                // Now check if grounded (after ladder grab attempt)
                if (!isGrounded) {
                    player.state = 'FALL';
                    player.coyoteTime = 8;
                    player.fallStartY = player.y; // Track fall start for landing sound
                    break; // Must break here or the code below will reset state to IDLE
                } else {
                    player.coyoteTime = 8;
                }

                if (physics.canJump && input.space && !prevInput.current.space) {
                    player.vy = physics.jumpForce;
                    player.state = 'JUMP';
                    player.fallStartY = player.y; // Track start for landing sound
                    playJumpSound();
                    player.coyoteTime = 0;
                    player.onGround = false;
                }

                // Pressing UP: Use normal ladder overlap (center-based)
                if (input.up && ladderOverlap) {
                    // Check if at or above the top of this ladder
                    const ladderTopY = ladderOverlap.y - player.height;
                    const isAtOrAboveLadderTop = player.y <= ladderTopY + 2;

                    if (isAtOrAboveLadderTop) {
                        // Check if there's a ladder above
                        const hasLadderAbove = ladders.some(l =>
                            l.x === ladderOverlap.x && l.y === ladderOverlap.y - TILE_SIZE
                        );

                        // Only allow climbing up if there's a ladder above
                        if (hasLadderAbove) {
                            player.state = 'CLIMB';
                            player.isClimbing = true;
                            player.ladderSidewaysCooldown = 8;

                            // Store start and target positions for smooth horizontal centering
                            player.transitionStartX = player.x;
                            player.transitionTargetX = ladderOverlap.x;
                            break;
                        }
                    } else {
                        // Not at top, allow climbing up
                        player.state = 'CLIMB';
                        player.isClimbing = true;
                        player.ladderSidewaysCooldown = 8;

                        // Store start and target positions for smooth horizontal centering
                        player.transitionStartX = player.x;
                        player.transitionTargetX = ladderOverlap.x;
                        break;
                    }
                }

                // Skip edge sliding when pressing down to mount a ladder (prevents jiggle)
                if (!pressingDownNearLadder) {
                    // Check for edge sliding (50% overhang)
                    let slideDirection = 0;
                    const playerCenterX = player.x + player.width / 2;
                    const playerBottom = player.y + player.height;

                    // Find edge bounds from supporting platforms (avoid filter/map allocations)
                    let leftMostEdge = Infinity;
                    let rightMostEdge = -Infinity;
                    let hasSupport = false;

                    // Check platforms
                    for (const p of platformColliders) {
                        const onTopOfPlatform = playerBottom >= p.y - 1 && playerBottom <= p.y + 1;
                        if (!onTopOfPlatform) continue;
                        if (!(player.x < p.x + TILE_SIZE && player.x + player.width > p.x)) continue;
                        hasSupport = true;
                        if (p.x < leftMostEdge) leftMostEdge = p.x;
                        if (p.x + TILE_SIZE > rightMostEdge) rightMostEdge = p.x + TILE_SIZE;
                    }

                    // Check ladder tops
                    for (const l of ladders) {
                        const onLadderTop = playerBottom >= l.y - 1 && playerBottom <= l.y + 1;
                        if (!onLadderTop) continue;
                        // Check if this is a top ladder (no ladder above)
                        let hasLadderAbove = false;
                        for (const above of ladders) {
                            if (above.x === l.x && above.y === l.y - TILE_SIZE) {
                                hasLadderAbove = true;
                                break;
                            }
                        }
                        if (hasLadderAbove) {
                            // If pressing down, we interpret this as "wanting to climb/fall",
                            // so we DON'T treat it as support (Edge Sliding shouldn't apply).
                            // But if NOT pressing down, we treat it as solid support (matching collision logic),
                            // so we consider it valid support for Edge Sliding checks.
                            if (input.down) continue;
                        }
                        if (!(player.x < l.x + TILE_SIZE && player.x + player.width > l.x)) continue;
                        hasSupport = true;
                        if (l.x < leftMostEdge) leftMostEdge = l.x;
                        if (l.x + TILE_SIZE > rightMostEdge) rightMostEdge = l.x + TILE_SIZE;
                    }

                    // Check crate tops (so adjacent ladders don't trigger erroneous edge-slide)
                    for (const c of crateStatesRef.current) {
                        const onCrateTop = playerBottom >= c.y - 1 && playerBottom <= c.y + 1;
                        if (!onCrateTop) continue;
                        if (!(player.x < c.x + TILE_SIZE && player.x + player.width > c.x)) continue;
                        hasSupport = true;
                        if (c.x < leftMostEdge) leftMostEdge = c.x;
                        if (c.x + TILE_SIZE > rightMostEdge) rightMostEdge = c.x + TILE_SIZE;
                    }

                    // Check if player center is beyond platform edges
                    if (hasSupport) {
                        // Check if 50% or more is hanging off left edge
                        if (playerCenterX < leftMostEdge) {
                            slideDirection = -1;
                        }
                        // Check if 50% or more is hanging off right edge
                        else if (playerCenterX > rightMostEdge) {
                            slideDirection = 1;
                        }
                    }

                    const dir = (input.left ? -1 : 0) + (input.right ? 1 : 0);

                    // Apply edge sliding if detected and not actively moving against it
                    if (slideDirection !== 0 && dir === 0) {
                        // Only slide if NO input is pressed (passive slip)
                        player.vx = slideDirection * physics.playerSpeed * 0.3; // Slower slide speed
                        player.state = 'RUN';
                        player.facingDirection = slideDirection as 1 | -1;
                    } else if (dir !== 0) {
                        // Active movement (running off edge OR running back) - full control
                        player.state = 'RUN';
                        player.vx += dir * physics.playerSpeed * 0.2;
                        if (Math.abs(player.vx) > physics.playerSpeed) player.vx = dir * physics.playerSpeed;
                        player.facingDirection = dir as 1 | -1;
                    } else {
                        // Idle (no slide detected, no input)
                        player.state = 'IDLE';
                        player.vx *= (1 - physics.friction);
                        if (Math.abs(player.vx) < 0.05) player.vx = 0;
                    }
                } else {  // Close if (!pressingDownNearLadder)
                    // When pressing down near ladder, keep player stable (no edge sliding)
                    player.state = 'IDLE';
                    player.vx = 0;
                }

                moveX(player.vx);
                moveY(player.vy);
                break;

            case 'JUMP':
            case 'FALL':
                if (player.coyoteTime > 0) player.coyoteTime--;
                if (isGrounded && player.vy >= 0) {
                    player.state = 'IDLE';
                    player.vy = 0;
                    // Only play landing sound if fell more than 3 pixels
                    const fallDistance = player.y - player.fallStartY;
                    if (fallDistance > 3) {
                        playLandSound();
                    }
                }

                if (physics.canJump && input.space && !prevInput.current.space && player.coyoteTime > 0) {
                    player.vy = physics.jumpForce;
                    player.state = 'JUMP';
                    player.coyoteTime = 0;
                    playJumpSound();
                }

                if (ladderOverlap && (input.up || input.down) && player.justDismountedCooldown <= 0) {
                    player.state = 'CLIMB';
                    player.isClimbing = true;
                    player.ladderSidewaysCooldown = 8;

                    // Store target X to prevent teleportation
                    player.transitionTargetX = ladderOverlap.x;

                    // Check if off-center - start smooth transition
                    const distanceFromCenter = Math.abs(player.x - ladderOverlap.x);
                    if (distanceFromCenter > 0.5) {
                        player.isTransitioningToLadder = true;
                        player.transitionProgress = 0;
                        player.transitionStartX = player.x;
                        player.transitionStartY = player.y;
                        player.transitionDirection = input.down ? 'down' : 'up';
                    } else {
                        player.x = ladderOverlap.x;
                        // IMPORTANT: Update StartX to match current position to prevent stale interpolation
                        player.transitionStartX = ladderOverlap.x;
                        player.vx = 0; player.vy = 0;
                    }
                }

                if (Math.abs(player.x - (prevInput.current as any).lastX) > 10) {
                    // Hacky way to detect large jumps. Needs prevX storage which we don't nicely have here. 
                    // Ignoring for now, relying on ENTER log.
                }

                player.vy += physics.gravity;
                if (player.vy > MAX_FALL_SPEED) player.vy = MAX_FALL_SPEED;

                const airDir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
                if (airDir !== 0) {
                    // If within coyote time, use ground acceleration (0.2) to prevent edge slowdown
                    // Otherwise use air acceleration (0.1)
                    const accel = player.coyoteTime > 0 ? 0.2 : 0.1;
                    player.vx += airDir * physics.playerSpeed * accel;
                    if (Math.abs(player.vx) > physics.playerSpeed) player.vx = airDir * physics.playerSpeed;
                    player.facingDirection = airDir as 1 | -1;
                } else {
                    player.vx *= 0.95;
                }

                moveX(player.vx);
                moveY(player.vy);
                break;

            case 'CLIMB':
                // Find the current ladder the player is on (PRIORITIZE Max Overlap)
                let currentLadder = ladders.reduce((best, current) => {
                    const getOverlap = (l: PlacedAsset) => {
                        const overlapLeft = Math.max(player.x, l.x);
                        const overlapRight = Math.min(player.x + player.width, l.x + TILE_SIZE);
                        const width = Math.max(0, overlapRight - overlapLeft);
                        const overlapTop = Math.max(player.y, l.y);
                        const overlapBottom = Math.min(player.y + player.height, l.y + TILE_SIZE);
                        const height = Math.max(0, overlapBottom - overlapTop);
                        return width * height;
                    };

                    if (!best) return current;

                    const bestOverlap = getOverlap(best);
                    const currentOverlap = getOverlap(current);

                    if (currentOverlap > bestOverlap) return current;
                    if (currentOverlap < bestOverlap) return best;

                    // Tie-breaker: Prefer current ladder if we're already on it (hysteresis) or facing direction?
                    // Actually, just prefer the one closest to center X if overlaps are equal (rare)
                    const bestDist = Math.abs((best.x + TILE_SIZE / 2) - (player.x + player.width / 2));
                    const currentDist = Math.abs((current.x + TILE_SIZE / 2) - (player.x + player.width / 2));
                    return currentDist < bestDist ? current : best;
                }, null as PlacedAsset | null);

                // SANITY CHECK: Ensure we actually have horizontal overlap with the chosen ladder.
                // This prevents snapping to a "ghost" ladder found in the spatial grid that is actually far away
                // (e.g. if I am at x=72 but the reduce picked a ladder at x=3 because it was in the list and nothing else overlapped).
                if (currentLadder) {
                    const overlapLeft = Math.max(player.x, currentLadder.x);
                    const overlapRight = Math.min(player.x + player.width, currentLadder.x + TILE_SIZE);
                    const overlapWidth = Math.max(0, overlapRight - overlapLeft);
                    // If we physically don't touch it horizontally, invalid.
                    // If we physically don't touch it horizontally, invalid.
                    const centerDist = Math.abs((player.x + 4) - (currentLadder.x + 4));
                    // Strict check: Must be within 6px of center (assuming 8px tiles)
                    // If TILE_SIZE is 8, overlap means center diff < 8.
                    // If TILE_SIZE is 16, center diff < 16.
                    if (overlapWidth <= 0.1 || (centerDist > TILE_SIZE + 2)) {
                        currentLadder = null;
                        // Also clear any pending transition if we lose the ladder
                        player.transitionTargetX = null;
                        player.ladderSidewaysCooldown = 0;
                    }
                }

                // Extra Safety: If ladderSidewaysCooldown is active but currentLadder is null, kill it.
                if (!currentLadder && player.ladderSidewaysCooldown > 0) {
                    player.ladderSidewaysCooldown = 0;
                    player.transitionTargetX = null;
                }

                // Check for Level Ladder Win Condition
                if (currentLadder && assets[currentLadder.assetId]?.type === 'LEVEL_LADDER') {
                    // If player is climbing Level Ladder and reaches the top of the screen
                    if (player.y < 0) {
                        playWinSound();
                        if (isLastLevel) { player.hasWon = true; setGameState('won'); } else { onLevelComplete(); }
                        break;
                    }
                }

                // Check if there's a ladder above the current one
                const hasLadderAbove = currentLadder && ladders.some(l =>
                    l.x === currentLadder.x && l.y === currentLadder.y - TILE_SIZE
                );

                // Handle smooth HORIZONTAL centering during ladder grab cooldown
                if (player.ladderSidewaysCooldown > 0 && player.transitionStartX !== undefined) {
                    // Check if currentLadder became invalid during transition
                    if (!currentLadder && player.ladderSidewaysCooldown > 0) {
                        // Zombie transition! Cancel immediately.

                        player.ladderSidewaysCooldown = 0;
                        player.transitionTargetX = null;
                        player.vx = 0;
                        // Let the Zombie Check below handle the state exit
                    }

                    if (currentLadder) {

                        const TRANSITION_DURATION = 8; // frames for smooth horizontal centering
                        const progress = TRANSITION_DURATION - player.ladderSidewaysCooldown;

                        if (progress < TRANSITION_DURATION) {
                            // Smoothly interpolate ONLY horizontal position
                            const t = progress / TRANSITION_DURATION;
                            const easeT = t * t * (3 - 2 * t); // Smoothstep easing

                            // Use locked target X to prevent teleportation when moving between ladder tiles
                            const targetX = player.transitionTargetX;
                            if (targetX !== null && targetX !== undefined) {
                                player.x = player.transitionStartX! + (targetX - player.transitionStartX!) * easeT;
                                player.vx = 0;
                            }

                            // Vertical movement continues normally based on input
                            // Don't break - allow normal vertical climbing logic below
                        } else {
                            // Transition complete - check if this was a ladder exit transition
                            const hasLadderAbove = ladders.some(l =>
                                l.x === currentLadder.x && l.y === currentLadder.y - TILE_SIZE
                            );
                            const targetY = currentLadder.y - player.height;
                            const isOffLadder = Math.abs(player.x - currentLadder.x) > 2; // Moved away from ladder X
                            const hasBypass = player.transitionBypassPlatformY !== null;

                            if (!hasLadderAbove && hasBypass && isOffLadder) {
                                // This was an exit transition - complete it and preserve momentum
                                player.x = player.transitionTargetX;
                                player.y = targetY; // Snap to platform top
                                // Push player up if stuck in collision
                                while (isPlayerSolid(player.x, player.y) && player.y > targetY - 4) {
                                    player.y--;
                                }
                                // Calculate exit direction and apply horizontal momentum
                                const exitDirection = Math.sign(player.transitionTargetX - player.transitionStartX);
                                player.vy = 0;
                                player.vx = exitDirection * physics.playerSpeed; // Continue moving horizontally
                                player.state = 'RUN';
                                player.isClimbing = false;
                                player.facingDirection = exitDirection as 1 | -1;
                                player.ladderExitTimer = 0;
                                player.ladderExitDirection = 0;
                                player.justDismountedCooldown = 8;
                                player.transitionBypassPlatformY = null;
                                break;
                            }
                        }
                        // Continue to vertical movement handling (don't break)
                    }
                }

                // Handle jump off ladder
                if (input.space && !prevInput.current.space) {
                    player.state = 'JUMP';
                    player.vy = physics.jumpForce;
                    player.vx = 0;
                    player.isClimbing = false;
                    player.ladderExitTimer = 0;
                    player.ladderExitDirection = 0;
                    player.transitionBypassPlatformY = null;
                    playJumpSound();
                    break;
                }

                if (player.x !== (prevInput.current as any).lastPhysicsX) {
                    const diff = player.x - ((prevInput.current as any).lastPhysicsX || player.x);
                    if (Math.abs(diff) > 16) {
                        const wasTeleport = player.lastTeleporterId !== null && Math.abs(diff) > 32;

                        console.error(`[PHYSICS_DEBUG] TELEPORT DETECTED! Frame:${gameLoopFrameCount.current}
                         OldX: ${(prevInput.current as any).lastPhysicsX?.toFixed(2)} -> NewX: ${player.x.toFixed(2)} (Diff: ${diff.toFixed(2)})
                         State: ${player.state} IsClimbing: ${player.isClimbing}
                         LadderID: ${currentLadder?.id} LadderX: ${currentLadder?.x}
                         TransitionTargetX: ${player.transitionTargetX} StartX: ${player.transitionStartX}
                         LadderCooldown: ${player.ladderSidewaysCooldown}
                         Input: Left=${input.left} Right=${input.right} Up=${input.up} Down=${input.down}
                         REVERTING: ${!wasTeleport}
                         `);

                        if (!wasTeleport && (prevInput.current as any).lastPhysicsX !== undefined) {
                            player.x = (prevInput.current as any).lastPhysicsX;
                            player.vx = 0;
                        }
                    }
                }
                (prevInput.current as any).lastPhysicsX = player.x;

                // --- SAFETY: Zombie Climb Check ---
                // If we are climbing but have no valid ladder (e.g. rejected by overlap check),
                // we must NOT continue in CLIMB state.
                if (!currentLadder && player.ladderSidewaysCooldown <= 0) {

                    player.state = 'FALL';
                    player.isClimbing = false;
                    player.vy = 0;
                    player.vx = 0;
                    break; // Exit switch
                }

                // Check if we're in an exit transition - if so, continue climbing regardless of input
                const inExitTransition = player.ladderSidewaysCooldown > 0 && player.transitionBypassPlatformY !== null;


                if (inExitTransition) {
                    // During exit transition, check if we've reached the top or lost the ladder
                    if (!currentLadder) {
                        // Lost the ladder completely - exit to idle/fall
                        player.state = isGrounded ? 'IDLE' : 'FALL';
                        player.isClimbing = false;
                        player.vy = isGrounded ? 0 : 0;
                        player.vx = 0;
                        player.fallStartY = player.y;
                        player.ladderExitTimer = 0;
                        player.ladderExitDirection = 0;
                        player.ladderSidewaysCooldown = 0;
                        player.transitionBypassPlatformY = null;
                        break;
                    }

                    // Check if we've reached the top of the ladder
                    if (!hasLadderAbove) {
                        const targetY = currentLadder.y - player.height;
                        // Stop climbing if we've reached or passed the top
                        if (player.y <= targetY) {
                            player.y = targetY;
                            // Push player up if stuck in collision
                            while (isPlayerSolid(player.x, player.y) && player.y > targetY - 4) {
                                player.y--;
                            }
                            player.vy = 0;
                            player.state = 'IDLE';
                            player.isClimbing = false;
                            player.ladderExitTimer = 0;
                            player.ladderExitDirection = 0;
                            player.justDismountedCooldown = 8;
                            player.transitionBypassPlatformY = null;
                            break;
                        }
                    }

                    // Safe to continue climbing during transition
                    player.vy = -LADDER_CLIMB_SPEED;
                    // Apply movement during transition
                    moveY(player.vy);
                    moveX(player.vx);
                    // Skip other ladder logic during exit transition
                    break;
                }

                // Normal ladder logic (only runs when NOT in exit transition)
                if (input.up) {
                    // Normal ladder climbing when NOT in exit transition
                    if (!currentLadder) {
                        // Lost the ladder (moved too far sideways), fall off
                        player.state = 'FALL';
                        player.isClimbing = false;
                        player.vy = 0;
                        player.fallStartY = player.y;
                        player.ladderExitTimer = 0;
                        player.ladderExitDirection = 0;
                        player.transitionBypassPlatformY = null;
                        break;
                    }

                    // Check if at top of ladder BEFORE moving
                    if (!hasLadderAbove) {
                        const targetY = currentLadder.y - player.height;

                        // Check if pressing horizontal direction to exit onto platform
                        const horizontalInput = (input.left ? -1 : 0) + (input.right ? 1 : 0);
                        const isNearTop = player.y <= targetY + LADDER_CLIMB_SPEED;

                        if (horizontalInput !== 0 && isNearTop) {
                            // Player wants to exit to the side - check for platform
                            const exitX = currentLadder.x + horizontalInput * TILE_SIZE;
                            const platformAtExit = platformColliders.find(p =>
                                p.x === exitX && p.y === currentLadder.y
                            );

                            if (platformAtExit && player.ladderSidewaysCooldown === 0) {
                                // Start smooth exit transition to platform
                                // DON'T snap Y yet - let player continue climbing smoothly
                                player.transitionStartX = player.x;
                                player.transitionTargetX = exitX;
                                player.ladderSidewaysCooldown = 8;
                                player.transitionBypassPlatformY = currentLadder.y; // Bypass platform collision during exit
                                player.vy = -LADDER_CLIMB_SPEED; // Continue climbing up
                                // Stay in CLIMB state to use horizontal interpolation
                            } else if (!platformAtExit) {
                                // No platform there, just exit normally upward
                                player.y = targetY;
                                while (isPlayerSolid(player.x, player.y) && player.y > targetY - 4) {
                                    player.y--;
                                }
                                player.vy = 0;
                                player.vx = 0;
                                player.state = 'IDLE';
                                player.isClimbing = false;
                                player.ladderExitTimer = 0;
                                player.ladderExitDirection = 0;
                                player.justDismountedCooldown = 8;
                                player.transitionBypassPlatformY = null;
                                break;
                            }
                        } else if (player.y <= targetY && player.ladderSidewaysCooldown === 0) {
                            // Already at or above the top - mount on top (no horizontal input)
                            player.y = targetY;
                            // Push player up if stuck in collision
                            while (isPlayerSolid(player.x, player.y) && player.y > targetY - 4) {
                                player.y--;
                            }
                            player.vy = 0;
                            player.vx = 0;
                                player.state = 'IDLE';
                            player.isClimbing = false;
                            player.ladderExitTimer = 0;
                            player.ladderExitDirection = 0;
                            player.justDismountedCooldown = 8;
                            player.transitionBypassPlatformY = null;
                            break;
                        } else {
                            // Not at top yet, but check if next movement would overshoot
                            // Allow moving up even during transition (cooldown > 0)

                            const nextY = player.y - LADDER_CLIMB_SPEED;
                            if (nextY <= targetY) {
                                // Would overshoot, so just snap to top
                                player.y = targetY;
                                // Push player up if stuck in collision
                                while (isPlayerSolid(player.x, player.y) && player.y > targetY - 4) {
                                    player.y--;
                                }
                                player.vy = 0;
                                player.vx = 0;
                                player.state = 'IDLE';
                                player.isClimbing = false;
                                player.ladderExitTimer = 0;
                                player.ladderExitDirection = 0;
                                player.justDismountedCooldown = 8;
                                player.transitionBypassPlatformY = null;
                                break;
                            } else {
                                // Safe to move up
                                player.vy = -LADDER_CLIMB_SPEED;
                            }
                        }
                    } else {
                        // Has ladder above, safe to move up
                        player.vy = -LADDER_CLIMB_SPEED;
                    }
                } else if (input.down) {
                    // Don't exit to platform if during ladder grab cooldown (mounting from platform edge)
                    if (isGrounded && !ladderOverlap && player.ladderSidewaysCooldown === 0) {
                        // Push player up if stuck in collision when exiting down to platform
                        while (isPlayerSolid(player.x, player.y)) {
                            player.y--;
                        }
                        player.vy = 0;
                        player.vx = 0;
                        player.state = 'IDLE';
                        player.isClimbing = false;
                        player.ladderExitTimer = 0;
                        player.ladderExitDirection = 0;
                        player.transitionBypassPlatformY = null;
                        break;
                    } else {
                        player.vy = LADDER_CLIMB_SPEED;
                    }
                } else {
                    player.vy = 0;
                }

                // Handle horizontal movement on ladder
                if ((input.left || input.right) && player.ladderSidewaysCooldown <= 0) {
                    const sideDir = input.left ? -1 : 1;
                    // Allow horizontal movement only after cooldown
                    player.vx = sideDir * LADDER_HORIZONTAL_SPEED;
                    player.facingDirection = sideDir as 1 | -1;
                } else {
                    // Don't center player during vertical climbing - only center during initial grab (handled by ladderSidewaysCooldown > 0)
                    player.vx = 0;
                }

                // Clear bypass when cooldown expires
                if (player.ladderSidewaysCooldown === 0 && player.transitionBypassPlatformY !== null) {
                    player.transitionBypassPlatformY = null;
                }

                // Apply movement
                moveY(player.vy);
                moveX(player.vx);

                // After movement, check for adjacent ladder switching or falling off
                if (currentLadder && (input.left || input.right)) {
                    const sideDir = input.left ? -1 : 1;
                    const playerCenter = player.x + player.width / 2;
                    const ladderCenter = currentLadder.x + TILE_SIZE / 2;
                    const distanceFromCenter = Math.abs(playerCenter - ladderCenter);
                    // Determine if we have moved past the edge of the current ladder
                    // (User req: "switch ladders when more than half of the players sprite passes over")
                    const crossedMidpoint = (sideDir === -1 && playerCenter < currentLadder.x) ||
                        (sideDir === 1 && playerCenter > currentLadder.x + TILE_SIZE);

                    // Check for adjacent ladder in the direction we're moving regardless of crossing
                    // We need to know if it exists to allow movement
                    const nextLadderX = currentLadder.x + sideDir * TILE_SIZE;
                    const adjacentLadder = ladders.find(l =>
                        Math.abs(l.x - nextLadderX) < 4 &&
                        Math.abs(l.y - player.y) < TILE_SIZE
                    );

                    if (adjacentLadder) {
                        // User Req: "switch ladders when more than half of the players sprite passes over"
                        if (crossedMidpoint) {
                            // Snap to the adjacent ladder
                            player.x = adjacentLadder.x;
                            player.vx = 0;
                        }
                    } else {
                        // No adjacent ladder, check if we should fall off
                        // Fall off when 50% of sprite is outside the ladder edge
                        if (distanceFromCenter > TILE_SIZE / 2) {
                            player.state = 'FALL';
                            player.isClimbing = false;
                            player.vx = sideDir * LADDER_HORIZONTAL_SPEED; // Less momentum when falling off ladder
                            player.vy = 0;
                            player.fallStartY = player.y;
                            player.ladderExitTimer = 0;
                            player.ladderExitDirection = 0;
                            break;
                        }
                    }
                }

                // Check if still on ladder (for falling off bottom or exiting to platform)
                // BUT: Skip this check during ladder grab cooldown to allow mounting from edge
                if (player.ladderSidewaysCooldown === 0) {
                    const stillOnLadder = ladders.some(l =>
                        player.x + player.width / 2 >= l.x && player.x + player.width / 2 <= l.x + TILE_SIZE &&
                        player.y + player.height > l.y && player.y < l.y + TILE_SIZE
                    );
                    if (!stillOnLadder) {
                        // Left the ladder - check if grounded or falling
                        if (isGrounded) {
                            // Landed on platform below ladder
                            // Push player up if stuck in collision
                            while (isPlayerSolid(player.x, player.y)) {
                                player.y--;
                            }
                            player.state = 'IDLE';
                            player.isClimbing = false;
                            player.vx = 0;
                            player.vy = 0;
                            player.ladderExitTimer = 0;
                            player.ladderExitDirection = 0;
                        } else if (player.vy > 0) {
                            // Falling off ladder
                            player.state = 'FALL';
                            player.isClimbing = false;
                            player.fallStartY = player.y;
                            player.ladderExitTimer = 0;
                            player.ladderExitDirection = 0;
                        }
                    }
                }

                break;
        }



        player.onGround = (player.state === 'IDLE' || player.state === 'RUN');
        player.isClimbing = (player.state === 'CLIMB');

        // Case A crush: player on crate carried into a solid ceiling
        if (player.dying <= 0 && !player.isDead && !player.isClimbing) {
            for (const c of crateStatesRef.current) {
                if (c.tipState === 'TIPPING') continue;
                const onTop = player.x + player.width > c.x && player.x < c.x + TILE_SIZE &&
                              player.y + player.height >= c.y && player.y + player.height <= c.y + 1;
                if (!onTop) continue;
                if (isPlayerSolid(player.x, player.y)) {
                    // ceilBottom is the bottom face of the ceiling tile the player's head is inside
                    // space = gap between crate top and ceiling bottom (c.y > ceilBottom since crate is below ceiling)
                    const ceilBottom = (Math.floor(player.y / TILE_SIZE) + 1) * TILE_SIZE;
                    const space = c.y - ceilBottom;
                    const caught = Math.max(0, player.height - space);
                    if (caught > 3 && !player.isInvincible && !player.isSpikeImmune) {
                        player.dying = 30; player.vy = -2; playDeathSound();
                    } else if (caught > 0) {
                        player.x = player.x + player.width / 2 < c.x + TILE_SIZE / 2
                            ? c.x - player.width : c.x + TILE_SIZE;
                    }
                }
            }
        }

        // Post-physics crate penetration correction: catch cases where fast crate movement caused fall-through
        if (player.dying <= 0 && !player.isClimbing) {
            for (const c of crateStatesRef.current) {
                if (c.tipState === 'TIPPING') continue;
                if (!(player.x + player.width > c.x && player.x < c.x + TILE_SIZE)) continue;
                const feetY = player.y + player.height;
                if (player.vy >= 0 && c.vy < 0 && player.y < c.y && feetY > c.y && feetY < c.y + TILE_SIZE) {
                    // Crate rose into player (spring bounce) faster than per-pixel hitCrateTop could catch
                    player.y = c.y - player.height;
                    player.vy = 0;
                    player.remainderY = 0;
                } else if (player.vy < 0 && feetY > c.y + TILE_SIZE && player.y < c.y + TILE_SIZE) {
                    // Jumping from below (e.g. spring launch): head entered or passed crate bottom — push back down
                    player.y = c.y + TILE_SIZE;
                    player.vy = 0;
                    player.remainderY = 0;
                }
            }
        }

        isCurrentlyTouchingHazard = false;
        const collectedAssetIds = new Set<string>();

        // Re-using nearbyInteractiveAssets defined earlier
        for (const p of nearbyInteractiveAssets) {
            // Skip items already collected (tracked immediately in ref to prevent sound stutter)
            if (collectedItemsRef.current.has(p.id)) continue;

            const asset = assets[p.assetId]; if (!asset) continue;
            // Simple AABB first
            if (player.x < p.x + TILE_SIZE && player.x + player.width > p.x && player.y < p.y + TILE_SIZE && player.y + player.height > p.y) {
                switch (asset.type) {
                    case 'SPIKE': {
                        // Allow 1 pixel of horizontal overlap from left or right side
                        const playerRight = player.x + player.width;
                        const playerCenterX = player.x + player.width / 2;
                        const spikeRight = p.x + TILE_SIZE;
                        const spikeCenterX = p.x + TILE_SIZE / 2;

                        // Check horizontal overlap
                        const overlapLeft = playerRight - p.x; // Player is to the left of spike, overlapping
                        const overlapRight = spikeRight - player.x; // Player is to the right of spike, overlapping

                        // If horizontal overlap is <= 1 pixel and player is not vertically aligned with spike center, allow it
                        const isSideOverlap = (overlapLeft >= 0 && overlapLeft <= 1 && playerCenterX < spikeCenterX) ||
                                           (overlapRight >= 0 && overlapRight <= 1 && playerCenterX > spikeCenterX);

                        if (!isSideOverlap && checkPixelCollision(
                            playerAsset,
                            { x: player.x, y: player.y, animationState: player.animationState, animationFrame: player.animationFrame, facingDirection: player.facingDirection },
                            asset,
                            { x: p.x, y: p.y }
                        )) {
                            isCurrentlyTouchingHazard = true;
                            if (!player.isSpikeImmune && !player.isInvincible && player.dying <= 0 && !player.isDead && player.vy >= 0) { player.dying = 30; player.vy = -2; playDeathSound(); }
                        }
                        break;
                    }
                    case 'SPRING': {
                        // Check pixel-perfect collision first
                        if (checkPixelCollision(
                            playerAsset,
                            { x: player.x, y: player.y, animationState: player.animationState, animationFrame: player.animationFrame, facingDirection: player.facingDirection },
                            asset,
                            { x: p.x, y: p.y }
                        )) {
                            const playerCenterX = player.x + player.width / 2;
                            const springCenterX = p.x + TILE_SIZE / 2;
                            const springBottom = p.y + TILE_SIZE;

                            // Check if player is approaching from below (jumping upward)
                            const approachingFromBelow = player.vy < 0;

                            if (approachingFromBelow) {
                                // When approaching from below, only activate if at least 5 pixels have passed through the bottom
                                // Player top at springBottom - 5 means 5 pixels have penetrated
                                const penetrationThreshold = 5;
                                const hasEnoughPenetration = player.y < (springBottom - penetrationThreshold);

                                if (!hasEnoughPenetration) {
                                    // Not enough penetration, don't activate spring
                                    break;
                                }
                            }

                            // Spring pixels are in rows 3-7 (p.y+3 to p.y+7)
                            // Top 3 rows are rows 3, 4, 5 (p.y+3 to p.y+5)
                            // Check if collision is happening in top portion by checking player's top position
                            const springTopPixelsEnd = p.y + 6; // End of row 5 (top 3 rows)

                            // If player is falling and their top is still above or at the top portion,
                            // they hit the top portion first (even if feet have penetrated deeper)
                            const isInTopPortion = player.vy >= 0 && player.y < springTopPixelsEnd;

                            if (isInTopPortion) {
                                // Top portion: bounce regardless of centering (pixel collision already confirmed)
                                player.y = p.y - player.height;
                                player.vy = physics.jumpForce * SPRING_BOUNCE_MULTIPLIER;
                                player.state = 'JUMP';
                                playSpringSound();
                            } else {
                                // Lower portion: only bounce if centered (pixel collision already confirmed)
                                if (Math.abs(playerCenterX - springCenterX) <= TILE_SIZE / 4) {
                                    player.y = p.y - player.height;
                                    player.vy = physics.jumpForce * SPRING_BOUNCE_MULTIPLIER;
                                    player.state = 'JUMP';
                                    playSpringSound();
                                }
                            }
                        }
                        break;
                    }
                    case 'GEM':
                        collectedItemsRef.current.add(p.id); // Track immediately
                        collectedAssetIds.add(p.id);
                        playCollectSound();
                        break;
                    case 'KEY':
                        player.hasKey = true;
                        collectedItemsRef.current.add(p.id);
                        collectedAssetIds.add(p.id);
                        playCollectSound();
                        break;
                    case 'PILL':
                        player.isSpikeImmune = true;
                        collectedItemsRef.current.add(p.id);
                        collectedAssetIds.add(p.id);
                        playCollectSound();
                        break;
                    case 'DOOR':
                        if (player.hasKey) {
                            collectedItemsRef.current.add(p.id);
                            collectedAssetIds.add(p.id);
                            player.hasKey = false;
                            playDoorOpenSound();
                        }
                        break;
                    case 'CHEST': if (!player.hasWon) { playWinSound(); if (isLastLevel) { player.hasWon = true; setGameState('won'); } else { onLevelComplete(); } } break;
                }
            }
        }

        // Legacy Physics Logic Removed

        const checkEnemyCollision = (ex: number, ey: number, assetId: string, options: { rotation?: number, facingDirection?: -1 | 1 } = {}) => {
            const enemyAsset = assets[assetId];
            if (enemyAsset) {
                if (checkPixelCollision(
                    playerAsset,
                    { x: player.x, y: player.y, animationState: player.animationState, animationFrame: player.animationFrame, facingDirection: player.facingDirection },
                    enemyAsset,
                    { x: ex, y: ey, rotation: options.rotation, facingDirection: options.facingDirection }
                )) {
                    isCurrentlyTouchingHazard = true;
                    if (!player.isSpikeImmune && !player.isInvincible && player.dying <= 0 && !player.isDead) { player.dying = 30; player.vy = -2; playDeathSound(); }
                }
            }
        }

        // --- Bad Man Interaction Logic ---
        badManStatesRef.current.forEach(badMan => {
            const badManAsset = assets[badMan.assetId];
            if (!badManAsset) return;

            // Check Collision
            if (checkPixelCollision(
                playerAsset,
                { x: player.x, y: player.y, animationState: player.animationState, animationFrame: player.animationFrame, facingDirection: player.facingDirection },
                badManAsset,
                { x: badMan.x, y: badMan.y, facingDirection: badMan.facingDirection }
            )) {
                const playerCenterX = player.x + player.width / 2;
                const badManCenterX = badMan.x + badMan.width / 2;
                const playerBottom = player.y + player.height;
                const badManCenterY = badMan.y + badMan.height / 2;
                const isFalling = player.vy > 0;

                // Stun Logic
                if (badMan.stunTimer > 0) {
                    // ALREADY STUNNED - INTERACTION

                    // Helper: Determine Side of Impact relative to Bad Man Center
                    // If Player Center < Bad Man Center -> Left Side Hit
                    const isLeftSideHit = playerCenterX < badManCenterX;
                    const pushDirection = isLeftSideHit ? 1 : -1; // Push OPPOSITE way (if hit left, push right)

                    // Determine if jump on top (approaching from above)
                    // Falling and feet are above badMan center
                    if (isFalling && playerBottom <= badManCenterY + 4) {
                        // --- SPLAT JUMP (Top Hit) ---
                        player.vy = -3.5;
                        player.y = badMan.y - player.height; // Snap to top
                        playJumpSound();

                        // Trigger Slide based on IMPACT SIDE (not player direction)
                        badMan.slideTimer = 8; // User req: 8 pixels
                        badMan.slideDirection = pushDirection;

                    } else {
                        // --- KICK (Side Hit) ---
                        // Trigger Slide
                        badMan.slideTimer = 8; // User req: 8 pixels
                        badMan.slideDirection = pushDirection;

                        // Bad Man Bounce (Pop up)
                        badMan.vy = -1;

                        // Player Bounce Back (Reaction Force)
                        // If pushed Right (1), Player bounces Left (-1)
                        player.x -= (2 * pushDirection);
                    }

                } else {
                    // NOT STUNNED - HAZARD OR STUN TRIGGER
                    // Stun Trigger: Falling AND Hitting Upper Half
                    const isUpperHalf = playerBottom < badManCenterY + 4; // Tolerance

                    if (isFalling && isUpperHalf) {
                        // TRIGGER STUN
                        badMan.stunTimer = 240; // Reduced to 4s (User req)
                        player.vy = -3.5;
                        player.y = badMan.y - player.height;
                        playJumpSound();
                    } else {
                        // KILL PLAYER
                        isCurrentlyTouchingHazard = true;
                        if (!player.isSpikeImmune && !player.isInvincible && player.dying <= 0 && !player.isDead) {
                            player.dying = 30; player.vy = -2; playDeathSound();
                        }
                    }
                }
            }
        });

        for (const enemy of enemyStatesRef.current) {
            // Custom collision logic for walking enemies to support bouncing
            const enemyAsset = assets[enemy.assetId];
            if (enemyAsset) {
                const isColliding = checkPixelCollision(
                    playerAsset,
                    { x: player.x, y: player.y, animationState: player.animationState, animationFrame: player.animationFrame, facingDirection: player.facingDirection },
                    enemyAsset,
                    { x: enemy.x, y: enemy.y, facingDirection: enemy.direction }
                );

                if (isColliding) {
                    // Check if player is landing on TOP of the enemy (Bounce Mechanic)
                    const playerCenterY = player.y + player.height / 2;
                    const enemyCenterY = enemy.y + TILE_SIZE / 2;
                    const isMovingDown = player.vy > 0;
                    const isComingFromAbove = playerCenterY <= enemyCenterY;

                    if (isMovingDown && isComingFromAbove) {
                        // Bounce off the top of the slime
                        player.vy = -3.5;
                        player.y = enemy.y - player.height;
                        playJumpSound();
                    } else {
                        // Side collision - determine who is moving
                        const playerCenterX = player.x + player.width / 2;
                        const enemyCenterX = enemy.x + TILE_SIZE / 2;

                        // Player is running into slime if player is actively moving horizontally toward slime
                        const playerIsMovingRight = player.vx > 0;
                        const playerIsMovingLeft = player.vx < 0;
                        const playerIsMoving = playerIsMovingRight || playerIsMovingLeft;

                        // Player is moving toward slime from left
                        const playerApproachingFromLeft = playerIsMovingRight && player.x < enemy.x;
                        // Player is moving toward slime from right
                        const playerApproachingFromRight = playerIsMovingLeft && player.x > enemy.x;

                        // Enemy is moving (ACCELERATING or DECELERATING)
                        const enemyIsMoving = enemy.moveState === 'ACCELERATING' || enemy.moveState === 'DECELERATING';

                        if (playerIsMoving && (playerApproachingFromLeft || playerApproachingFromRight) && !enemyIsMoving) {
                            // Player running into stationary slime - bounce 1 pixel back
                            if (playerApproachingFromLeft) {
                                player.x = enemy.x - player.width - 1;
                            } else {
                                player.x = enemy.x + TILE_SIZE + 1;
                            }
                            player.vx = 0; // Stop horizontal momentum
                        } else if (enemyIsMoving) {
                            // Slime moving into player - push player along with slime smoothly
                            // Determine which side player is on relative to slime
                            const playerOnLeft = playerCenterX < enemyCenterX;

                            // Check if player would be pushed into a wall
                            const wallCheckX = playerOnLeft ? player.x - 1 : player.x + player.width + 1;
                            const wallGridX = Math.floor(wallCheckX / TILE_SIZE);
                            const playerGridY = Math.floor(playerCenterY / TILE_SIZE);
                            const wallIdx = getGridIndex(wallGridX, playerGridY);
                            const wallAhead = wallIdx !== -1 && spatialGrid[wallIdx]?.some(p => assets[p.assetId]?.type === 'PLATFORM');

                            if (wallAhead && playerCenterY > enemyCenterY - TILE_SIZE / 2) {
                                // Slime pushing player into wall - nudge player upwards until on top of slime
                                const targetY = enemy.y - player.height;
                                if (player.y > targetY) {
                                    player.y = targetY;
                                    player.vy = 0;
                                }
                            } else if (playerOnLeft) {
                                // Player is on left side of slime - push along with slime
                                player.x = enemy.x - player.width;
                            } else {
                                // Player is on right side of slime - push along with slime
                                player.x = enemy.x + TILE_SIZE;
                            }
                            player.vx = 0; // Stop player's own horizontal movement
                        } else {
                            // Neither is actively moving - just separate them
                            if (playerCenterX < enemyCenterX) {
                                player.x = enemy.x - player.width;
                            } else {
                                player.x = enemy.x + TILE_SIZE;
                            }
                            player.vx = 0;
                        }
                    }
                }
            }
        }

        for (const puddle of puddleStatesRef.current) {
            let rotation = 0;
            switch (puddle.side) {
                case 'RIGHT': rotation = 90; break;
                case 'BOTTOM': rotation = 180; break;
                case 'LEFT': rotation = 270; break;
            }
            // Don't rotate if on ladder or falling/climbing/dripping/landing animation state
            if (puddle.side === 'LADDER' || puddle.animationState === 'CLIMBING' || puddle.animationState === 'FALLING' || puddle.animationState === 'DRIPPING' || puddle.animationState === 'LANDING') rotation = 0;

            checkEnemyCollision(puddle.x, puddle.y, puddle.assetId, { rotation });
        }

        // Handle spike immunity cooldown
        if (player.isSpikeImmune) {
            if (player.wasTouchingHazard && !isCurrentlyTouchingHazard) {
                // Player just stopped touching hazard - start cooldown period (15 frames)
                player.spikeImmuneCooldown = 15;
            }

            // Decrement cooldown if active
            if (player.spikeImmuneCooldown > 0) {
                player.spikeImmuneCooldown--;
                // Remove immunity when cooldown expires
                if (player.spikeImmuneCooldown === 0) {
                    player.isSpikeImmune = false;
                    playPowerDownSound();
                }
            }

            // Reset cooldown if touching hazard again (to prevent premature wear-off)
            if (isCurrentlyTouchingHazard) {
                player.spikeImmuneCooldown = 0;
            }
        }
        player.wasTouchingHazard = isCurrentlyTouchingHazard;

        if (player.lastTeleporterId) {
            const lastTeleporter = memoizedTeleporters.find(p => p.id === player.lastTeleporterId);
            if (lastTeleporter) {
                if (!(player.x < lastTeleporter.x + TILE_SIZE && player.x + player.width > lastTeleporter.x && player.y < lastTeleporter.y + TILE_SIZE && player.y + player.height > lastTeleporter.y)) {
                    player.lastTeleporterId = null;
                }
            } else { player.lastTeleporterId = null; }
        }

        const playerCenterX = player.x + player.width / 2;
        const playerCenterY = player.y + player.height / 2;
        const overlappingTeleporter = nearbyInteractiveAssets.find(p => {
            if (assets[p.assetId]?.type !== 'TELEPORTER') return false;
            const teleporterCenterX = p.x + TILE_SIZE / 2;
            const teleporterCenterY = p.y + TILE_SIZE / 2;
            return Math.abs(playerCenterX - teleporterCenterX) <= 3 && Math.abs(playerCenterY - teleporterCenterY) <= 3;
        });

        if (overlappingTeleporter && overlappingTeleporter.teleporterPairId !== undefined && overlappingTeleporter.id !== player.lastTeleporterId) {
            const dest = memoizedTeleporters.find(p => p.id !== overlappingTeleporter.id && p.teleporterPairId === overlappingTeleporter.teleporterPairId);
            if (dest) {
                // Block teleport if destination is occupied by a crate
                const destBlockedByCrate = crateStatesRef.current.some(c =>
                    dest.x < c.x + TILE_SIZE && dest.x + TILE_SIZE > c.x &&
                    dest.y < c.y + TILE_SIZE && dest.y + TILE_SIZE > c.y
                );
                if (!destBlockedByCrate) {
                    // Track Teleport History
                    teleporterHistoryRef.current.push({
                        id: overlappingTeleporter.id,
                        exitId: dest.id,
                        entryTime: Date.now()
                    });

                    player.x = dest.x; player.y = dest.y; player.vx = 0; player.vy = 0;
                    player.lastTeleporterId = dest.id; playTeleportSound();
                }
            }
        }

        if (collectedAssetIds.size > 0) setLocalLevelData(prev => prev.filter(p => !collectedAssetIds.has(p.id)));
        if (player.y > GAME_HEIGHT) {
            if (player.dying <= 0 && !player.isDead) {
                player.dying = 30; player.vy = -2; playDeathSound();
            }
        }
        if (player.x < 0) { player.x = 0; player.vx = 0; }
        if (player.x + player.width > GAME_WIDTH) { player.x = GAME_WIDTH - player.width; player.vx = 0; }

        // Snap crates to nearest tile when not being pushed this frame (player or slime)
        const slimePushedCrateIds = new Set(enemyStatesRef.current.filter(e => e.pushingCrateId).map(e => e.pushingCrateId!));
        crateStatesRef.current.forEach(crate => {
            if (crate.id !== pushedCrateId && !slimePushedCrateIds.has(crate.id) && crate.onGround && crate.tipState === 'NONE' && crate.x % TILE_SIZE !== 0) {
                const prevX = crate.x;
                const snapTarget = Math.round(crate.x / TILE_SIZE) * TILE_SIZE;
                const diff = snapTarget - prevX;
                // Move at most 2px per frame toward target so the slide is smooth
                const step = diff > 0 ? Math.min(diff, 2) : Math.max(diff, -2);
                crate.x += step;
                // If player was touching crate, keep them in contact (handles both forward and backward slides)
                if (player.y < crate.y + TILE_SIZE && player.y + player.height > crate.y) {
                    if (Math.abs((player.x + player.width) - prevX) <= 1) {
                        player.x = crate.x - player.width; // player was on left side
                    } else if (Math.abs(player.x - (prevX + TILE_SIZE)) <= 1) {
                        player.x = crate.x + TILE_SIZE;    // player was on right side
                    }
                }
            }
        });

        const oldState = player.animationState;
        let newState: PlayerAnimationState = 'IDLE';
        if (isActuallyPushingCrate) newState = 'PUSHING';
        else if (player.isClimbing) newState = 'CLIMBING';
        else if (!player.onGround) newState = 'JUMPING';
        else if (Math.abs(player.vx) > 0.1) newState = 'WALKING';
        if (newState !== oldState) { player.animationState = newState; player.animationFrame = 0; }
        const anims = playerAsset.animations;
        const playerFps = playerAsset.animationFps || 10;
        const playerFrameSkip = playerFps > 0 ? Math.round(60 / playerFps) : 0;
        if (player.animationState === 'PUSHING' && anims?.PUSHING && anims.PUSHING.length > 1) {
            if (playerFrameSkip > 0 && gameLoopFrameCount.current % (playerFrameSkip * 2) === 0) player.animationFrame++;
        } else if (playerFrameSkip > 0 && gameLoopFrameCount.current % playerFrameSkip === 0) {
            let shouldAdvance = false;
            switch (player.animationState) {
                case 'WALKING': if (anims?.WALKING && anims.WALKING.length > 1) shouldAdvance = true; break;
                case 'CLIMBING': if (anims?.CLIMBING && anims.CLIMBING.length > 1 && Math.abs(player.vy) > 0.1) shouldAdvance = true; break;
                case 'JUMPING': if (anims?.JUMPING && anims.JUMPING.length > 1) shouldAdvance = true; break;
            }
            if (shouldAdvance) player.animationFrame++;
        }

        if (!wasOnGroundRef.current && player.onGround && !wasClimbingRef.current && player.justDismountedCooldown <= 0) {
            // Only play landing sound if fell more than 3 pixels
            const fallDistance = player.y - player.fallStartY;
            if (fallDistance > 3) {
                playLandSound();
            }
        }
        wasOnGroundRef.current = player.onGround; wasClimbingRef.current = player.isClimbing;
        prevInput.current = { ...input }; // Update input history for next frame
    }, [assets, playerAsset, physics, input, resetPlayer, spatialGrid, memoizedTeleporters, setLocalLevelData, onLevelComplete, isLastLevel, gameState, ladderCoords, localLevelData]);

    const gameLoop = useCallback((timestamp: number) => {
        if (mode !== 'PLAY') return;

        if (lastFrameTime.current === 0) lastFrameTime.current = timestamp;
        let deltaTime = timestamp - lastFrameTime.current;
        lastFrameTime.current = timestamp;
        if (deltaTime > MAX_DELTA_TIME) deltaTime = MAX_DELTA_TIME;

        accumulator.current += deltaTime * physics.gameSpeed; // Apply global speed reduction

        const maxUpdates = 10;
        let updates = 0;
        while (accumulator.current >= TIME_STEP && updates < maxUpdates) {
            updatePhysics();
            accumulator.current -= TIME_STEP;
            updates++;
        }
        if (accumulator.current > TIME_STEP * 2) accumulator.current = 0;

        renderGame();
        animationFrameId.current = requestAnimationFrame(gameLoop);
    }, [mode, updatePhysics, renderGame]);

    useEffect(() => {
        initAudio();
        if (mode === 'PLAY') {
            if (prevMode.current === 'EDIT') { resetPlayer(); lastFrameTime.current = 0; accumulator.current = 0; }
            animationFrameId.current = requestAnimationFrame(gameLoop);
        } else { renderGame(); }
        prevMode.current = mode;
        return () => { if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); };
    }, [mode, gameLoop, resetPlayer, renderGame, level]);

    const handleEditorKeyboardInput = useCallback(() => {
        if (mode !== 'EDIT' || (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) return;
        let dx = 0, dy = 0;
        if (input.left) dx = -TILE_SIZE; if (input.right) dx = TILE_SIZE;
        if (input.up) dy = -TILE_SIZE; if (input.down) dy = TILE_SIZE;
        if (dx !== 0 || dy !== 0) {
            setEditSquarePos(prev => {
                const newX = Math.max(0, Math.min(GAME_WIDTH - TILE_SIZE, prev.x + dx));
                const newY = Math.max(0, Math.min(GAME_HEIGHT - TILE_SIZE, prev.y + dy));
                if (input.space || input.backspace) {
                    if (!keyboardStrokeRef.current) keyboardStrokeRef.current = [];
                    const assetId = input.space ? selectedAssetId : null;
                    if (assetId !== 'player') { keyboardStrokeRef.current.push({ x: newX, y: newY, assetId }); }
                }
                return { x: newX, y: newY };
            });
        }
        if (!input.space && !input.backspace) {
            if (keyboardStrokeRef.current) { commitAction(keyboardStrokeRef.current); keyboardStrokeRef.current = null; }
        }
        renderGame();
    }, [mode, input, selectedAssetId, commitAction, renderGame]);

    const isSolidTile = useCallback((x: number, y: number) => {
        return level.levelData.some(p => {
            if (p.x !== x || p.y !== y) return false;
            const type = assets[p.assetId]?.type;
            return type === 'PLATFORM' || type === 'DOOR';
        });
    }, [level.levelData, assets]);

    const canPlaceAsset = useCallback((x: number, y: number, assetId: string) => {
        // Allow placing assets anywhere - overwriting is now permitted
        return true;
    }, []);

    useEffect(() => {
        const handleSingleKeyPress = (e: KeyboardEvent) => {
            if (mode !== 'EDIT' || e.repeat || (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) return;
            if (e.code === 'Space') {
                if (!keyboardStrokeRef.current) {
                    if (selectedAssetId === 'player') {
                        if (!isSolidTile(editSquarePos.x, editSquarePos.y)) {
                            onPlayerStartChange(editSquarePos.x, editSquarePos.y);
                        }
                    }
                    else {
                        // Check if placement is valid (empty tile or ladder tile)
                        if (canPlaceAsset(editSquarePos.x, editSquarePos.y, selectedAssetId)) {
                            // Include rotation for puddles
                            const isPuddle = selectedAssetId && assets[selectedAssetId]?.type === 'PUDDLE';
                            commitAction([{
                                x: editSquarePos.x,
                                y: editSquarePos.y,
                                assetId: selectedAssetId,
                                rotation: isPuddle ? puddleRotation : undefined
                            }]);
                        }
                    }
                }
            } else if (e.code === 'Backspace' || e.code === 'Delete') {
                if (!keyboardStrokeRef.current) commitAction([{ x: editSquarePos.x, y: editSquarePos.y, assetId: null }]);
            } else if (e.key.toLowerCase() === 'r') {
                // Cycle puddle rotation: 0 -> 90 -> 180 -> 270 -> 0
                setPuddleRotation(prev => (prev + 90) % 360);
            }
        };
        window.addEventListener('keydown', handleSingleKeyPress);
        return () => window.removeEventListener('keydown', handleSingleKeyPress);
    }, [mode, selectedAssetId, editSquarePos, onPlayerStartChange, commitAction, isSolidTile, canPlaceAsset, assets, puddleRotation]);









    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const crtEffectDiv = canvas.parentElement as HTMLDivElement | null;
        if (!crtEffectDiv) return;
        canvas.style.cursor = 'crosshair';
        const observer = new ResizeObserver(() => {
            if (!container) return;
            const { width, height } = container.getBoundingClientRect();
            const scale = Math.min(width / GAME_WIDTH, height / GAME_HEIGHT);
            crtEffectDiv.style.width = `${GAME_WIDTH * scale}px`;
            crtEffectDiv.style.height = `${GAME_HEIGHT * scale}px`;
        });
        observer.observe(container);
        return () => { if (container) observer.unobserve(container); };
    }, []);

    const getMouseCoords = useCallback((e: MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
        const canvas = canvasRef.current; if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
        const coords = getMouseCoords(e); if (!coords) return;
        if (mode !== 'EDIT') return;
        const canvas = canvasRef.current; if (!canvas) return;

        setMousePos(coords);
        const gridX = Math.floor(coords.x / TILE_SIZE) * TILE_SIZE, gridY = Math.floor(coords.y / TILE_SIZE) * TILE_SIZE;
        setEditSquarePos({ x: gridX, y: gridY });

        // Check if we should enter drag mode for a movable asset
        if (mouseDownInfo.current && !dragState) {
            const dx = coords.x - mouseDownInfo.current.x;
            const dy = coords.y - mouseDownInfo.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const elapsed = Date.now() - mouseDownInfo.current.time;

            // Enter drag mode if mouse moved > 3 pixels OR held for > 150ms
            if (distance > 3 || elapsed > 150) {
                const asset = mouseDownInfo.current.asset;
                if (asset) {
                    editorActionState.current = 'movingAsset';
                    setDragState({
                        asset: asset,
                        isPlayer: false,
                        offsetX: mouseDownInfo.current.x - asset.x,
                        offsetY: mouseDownInfo.current.y - asset.y
                    });
                }
                mouseDownInfo.current = null;
            }
        }

        if (!dragState) {
            const isOverPlayer = gridX === level.playerStartPos.x && gridY === level.playerStartPos.y;
            const assetAtMouse = level.levelData.find(p => p.x === gridX && p.y === gridY);
            const baseAsset = assetAtMouse ? assets[assetAtMouse.assetId] : undefined;
            const isMovable = isAssetMovable(baseAsset);
            canvas.style.cursor = (isMovable || isOverPlayer) ? 'pointer' : 'crosshair';
        }
        if (editorActionState.current === 'drawing' || editorActionState.current === 'erasing') {
            const coordKey = `${gridX},${gridY}`;
            if (affectedCoordsInAction.current.has(coordKey)) return;
            affectedCoordsInAction.current.add(coordKey);
            setLevelDuringAction(current => {
                if (!current) return null; const newLevel = [...current];
                const idx = newLevel.findIndex(p => p.x === gridX && p.y === gridY);
                if (editorActionState.current === 'drawing') {
                    if (selectedAssetId === 'player') return newLevel;
                    // Check if placement is valid (empty tile or ladder tile)
                    if (!canPlaceAsset(gridX, gridY, selectedAssetId)) return newLevel;
                    const isPuddle = assets[selectedAssetId]?.type === 'PUDDLE';
                    const newAsset: PlacedAsset = {
                        id: `${selectedAssetId}-${gridX}-${gridY}-${Math.random()}`,
                        assetId: selectedAssetId,
                        x: gridX,
                        y: gridY,
                        ...(isPuddle && { rotation: puddleRotation })
                    };
                    // Overwrite: remove all assets at this position and place new one
                    const filtered = newLevel.filter(p => p.x !== gridX || p.y !== gridY);
                    filtered.push(newAsset);
                    return filtered;
                } else if (idx !== -1) newLevel.splice(idx, 1);
                return newLevel;
            });
        }
        renderGame();
    }, [mode, getMouseCoords, selectedAssetId, renderGame, dragState, level.playerStartPos, level.levelData, assets, canPlaceAsset, puddleRotation]);

    const handleMouseDown = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
        const coords = getMouseCoords(e); if (!coords) return;

        if (mode !== 'EDIT') return;

        const gridX = Math.floor(coords.x / TILE_SIZE) * TILE_SIZE;
        const gridY = Math.floor(coords.y / TILE_SIZE) * TILE_SIZE;
        setEditSquarePos({ x: gridX, y: gridY });
        if (gridX === level.playerStartPos.x && gridY === level.playerStartPos.y && e.button === 0) {
            setDragState({ asset: { id: 'player', assetId: 'player', x: gridX, y: gridY }, isPlayer: true, offsetX: coords.x - gridX, offsetY: coords.y - gridY });
            return;
        }
        const assetToDrag = level.levelData.find(p => p.x === gridX && p.y === gridY);
        const baseAsset = assetToDrag ? assets[assetToDrag.assetId] : undefined;

        // Handle movable assets with click-and-hold detection
        // Single click = overwrite with selected asset
        // Click and hold (or drag) = grab and move the asset
        if (e.button === 0 && assetToDrag && isAssetMovable(baseAsset)) {
            // Record mouse down info for click-and-hold detection
            mouseDownInfo.current = {
                time: Date.now(),
                x: coords.x,
                y: coords.y,
                asset: assetToDrag
            };
            // Don't immediately enter drag mode - wait for mouse move or delay
            return;
        }

        setLevelDuringAction([...level.levelData]);
        affectedCoordsInAction.current.clear();
        const coordKey = `${gridX},${gridY}`;
        affectedCoordsInAction.current.add(coordKey);
        const action = (isErasing: boolean) => {
            editorActionState.current = isErasing ? 'erasing' : 'drawing';
            if (isErasing) { setLevelDuringAction(current => current ? current.filter(p => p.x !== gridX || p.y !== gridY) : null); }
            else {
                if (selectedAssetId === 'player') {
                    if (!isSolidTile(gridX, gridY)) {
                        onPlayerStartChange(gridX, gridY);
                    }
                    setLevelDuringAction(null);
                }
                else {
                    // Check if placement is valid (empty tile or ladder tile)
                    if (canPlaceAsset(gridX, gridY, selectedAssetId)) {
                        const isPuddle = assets[selectedAssetId]?.type === 'PUDDLE';
                        const newAsset: PlacedAsset = {
                            id: `${selectedAssetId}-${gridX}-${gridY}-${Math.random()}`,
                            assetId: selectedAssetId,
                            x: gridX,
                            y: gridY,
                            ...(isPuddle && { rotation: puddleRotation })
                        };
                        setLevelDuringAction(current => {
                            if (!current) return null;
                            // Remove all assets at this position (allow full overwriting)
                            const filtered = current.filter(p => p.x !== gridX || p.y !== gridY);
                            return [...filtered, newAsset];
                        });
                    }
                }
            }
        };
        action(e.button === 2);
        renderGame();
    }, [mode, getMouseCoords, level.playerStartPos, level.levelData, assets, selectedAssetId, onPlayerStartChange, renderGame, isSolidTile, canPlaceAsset, onCommitChanges]);

    const handleMouseUp = useCallback(() => {
        if (mode !== 'EDIT') return;

        // Handle single-click on movable asset (click without drag)
        if (mouseDownInfo.current && !dragState) {
            const asset = mouseDownInfo.current.asset;
            if (asset) {
                const clickedAssetType = assets[asset.assetId]?.type;
                const selectedAssetType = assets[selectedAssetId]?.type;

                // Special behavior for puddles: if clicking on a puddle with puddle selected, rotate it
                if (clickedAssetType === 'PUDDLE' && selectedAssetType === 'PUDDLE') {
                    const newRotation = ((asset.rotation ?? 0) + 90) % 360;
                    playRetroClickSound();
                    commitAction([{
                        x: asset.x,
                        y: asset.y,
                        assetId: asset.assetId,
                        rotation: newRotation
                    }]);
                } else {
                    // Single click detected - overwrite with selected asset
                    const isPuddle = selectedAssetType === 'PUDDLE';
                    commitAction([{
                        x: asset.x,
                        y: asset.y,
                        assetId: selectedAssetId,
                        ...(isPuddle && { rotation: puddleRotation })
                    }]);
                }
            }
            mouseDownInfo.current = null;
            renderGame();
            return;
        }

        if (dragState) {
            const newX = editSquarePos.x;
            const newY = editSquarePos.y;
            const clampedX = Math.max(0, Math.min(GAME_WIDTH - TILE_SIZE, newX));
            const clampedY = Math.max(0, Math.min(GAME_HEIGHT - TILE_SIZE, newY));
            if (dragState.isPlayer) {
                if (!isSolidTile(clampedX, clampedY)) {
                    onPlayerStartChange(clampedX, clampedY);
                }
            }
            else {
                // Validate that the drag destination is empty or only has a ladder
                if (canPlaceAsset(clampedX, clampedY, dragState.asset.assetId)) {
                    onMoveAsset(dragState.asset.id, clampedX, clampedY);
                }
                // Otherwise, the asset stays in its original position
            }
            setDragState(null);
            editorActionState.current = 'none';
            renderGame();
            return;
        }
        if (levelDuringAction) {
            const changes: { x: number, y: number, assetId: string | null, rotation?: number }[] = [];
            const originalMap = new Map<string, { id: string, rotation?: number }>(localLevelData.map(p => [`${p.x},${p.y}`, { id: p.assetId, rotation: p.rotation }]));
            const newMap = new Map<string, { id: string, rotation?: number }>(levelDuringAction.map(p => [`${p.x},${p.y}`, { id: p.assetId, rotation: p.rotation }]));

            affectedCoordsInAction.current.forEach(key => {
                const [x, y] = key.split(',').map(Number);
                const originalData = originalMap.get(key);
                const newData = newMap.get(key);
                if (originalData?.id !== newData?.id || originalData?.rotation !== newData?.rotation) {
                    changes.push({
                        x, y,
                        assetId: newData?.id || null,
                        ...(newData?.rotation !== undefined && { rotation: newData.rotation })
                    });
                }
            });
            commitAction(changes);
            setLevelDuringAction(null);
            affectedCoordsInAction.current.clear();
        }
        editorActionState.current = 'none';
    }, [mode, dragState, levelDuringAction, localLevelData, commitAction, onPlayerStartChange, onMoveAsset, renderGame, editSquarePos, isSolidTile, canPlaceAsset, selectedAssetId, assets, puddleRotation]);

    return (
        <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-gray-900 select-none">
            <div className={themeInfo.screenEffect || ""} style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}>
                <canvas
                    ref={canvasRef}
                    width={GAME_WIDTH}
                    height={GAME_HEIGHT}
                    onMouseMove={handleMouseMove}
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onContextMenu={(e) => e.preventDefault()}
                    className="block w-full h-full"
                />
                {mode === 'PLAY' && ((gameState === 'dead' || gameState === 'won') || !isFontLoaded) && (
                    <div className={`game-overlay ${isFontLoaded ? 'font-loaded' : 'font-loading'}`} style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                        {gameState === 'dead' && (
                            <>
                                <div className="game-overlay-title" style={{ color: palette[4] }}>GAME OVER</div>
                                <div className="game-overlay-subtitle" style={{ color: palette[11] }}>PRESS ANY KEY</div>
                            </>
                        )}
                        {gameState === 'won' && (
                            <>
                                <div className="game-overlay-title" style={{ color: palette[14] }}>YOU WIN!</div>
                                <div className="game-overlay-subtitle" style={{ color: palette[11] }}>PRESS ANY KEY</div>
                            </>
                        )}
                    </div>
                )}
                {errorMessage && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded shadow-lg text-xs font-sans z-50">
                        {errorMessage}
                    </div>
                )}
            </div>
        </div>
    );
};

export default GameCanvas;
