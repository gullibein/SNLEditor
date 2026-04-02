import { Assets, PlacedAsset, BadManState } from '../types';
import { TILE_SIZE, GAME_WIDTH, GAME_HEIGHT, BAD_MAN_SPEED, BAD_MAN_JUMP_FORCE, GRAVITY, PLAYER_SPEED } from '../constants';

// --- Types ---

export interface BadManPathNode {
    gx: number;
    gy: number;
    action: 'WALK' | 'JUMP' | 'CLIMB' | 'FALL' | 'TELEPORT' | 'USE_SPRING';
    parent?: BadManPathNode;
    g?: number;
    h?: number;
    f?: number;
    vx?: number;
    vy?: number;
    teleporterId?: string; // If action is TELEPORT
}

type SpatialGrid = (PlacedAsset[] | undefined)[];
const TILES_X = GAME_WIDTH / TILE_SIZE;
const TILES_Y = GAME_HEIGHT / TILE_SIZE;

const getGridIndex = (gx: number, gy: number): number => {
    if (gx < 0 || gx >= TILES_X || gy < 0 || gy >= TILES_Y) return -1;
    return gy * TILES_X + gx;
};

// --- Helpers ---

// --- Helpers ---

const isSolid = (gx: number, gy: number, spatialGrid: SpatialGrid, assets: Assets): boolean => {
    const idx = getGridIndex(gx, gy);
    if (idx === -1) return false;
    const cell = spatialGrid[idx];
    if (!cell) return false;

    let hasSolid = false;
    let hasLadder = false;

    for (const p of cell) {
        const a = assets[p.assetId];
        if (!a) continue;
        if (a.type === 'PLATFORM' || a.type === 'DOOR') hasSolid = true;

        // Spike is solid for pathfinding (unless we jump over it)
        if (a.type === 'SPIKE') hasSolid = true;

        if (a.type === 'LADDER') hasLadder = true;
    }

    if (hasLadder) return false;
    return hasSolid;
};

const hasLadder = (gx: number, gy: number, spatialGrid: SpatialGrid, assets: Assets): boolean => {
    const idx = getGridIndex(gx, gy);
    if (idx === -1) return false;
    return spatialGrid[idx]?.some(p => {
        const a = assets[p.assetId];
        return a && a.type === 'LADDER';
    }) ?? false;
};

const getSpring = (gx: number, gy: number, spatialGrid: SpatialGrid, assets: Assets): PlacedAsset | undefined => {
    const idx = getGridIndex(gx, gy);
    if (idx === -1) return undefined;
    return spatialGrid[idx]?.find(p => {
        const a = assets[p.assetId];
        return a && a.type === 'SPRING';
    });
}

const hasSpike = (gx: number, gy: number, spatialGrid: SpatialGrid, assets: Assets): boolean => {
    const idx = getGridIndex(gx, gy);
    if (idx === -1) return false;
    return spatialGrid[idx]?.some(p => assets[p.assetId]?.type === 'SPIKE') ?? false;
};

// Bresenham's Line of Sight
export const checkLineOfSight = (
    x1: number, y1: number,
    x2: number, y2: number,
    spatialGrid: SpatialGrid,
    assets: Assets
): boolean => {
    let x = Math.floor(x1 / TILE_SIZE);
    let y = Math.floor(y1 / TILE_SIZE);
    const xEnd = Math.floor(x2 / TILE_SIZE);
    const yEnd = Math.floor(y2 / TILE_SIZE);

    const dx = Math.abs(xEnd - x);
    const dy = Math.abs(yEnd - y);
    const sx = (x < xEnd) ? 1 : -1;
    const sy = (y < yEnd) ? 1 : -1;
    let err = dx - dy;

    while (true) {
        // Check current tile for LOS blocking
        // Platform, Door, or Ladder Top are SOLID for LOS.
        const idx = getGridIndex(x, y);
        if (idx !== -1 && spatialGrid[idx]) {
            for (const p of spatialGrid[idx]!) {
                const a = assets[p.assetId];
                if (!a) continue;
                if (a.type === 'PLATFORM' || a.type === 'DOOR') return false;
                // Ladder Top Check: If ladder here, and NO ladder above.
                if (a.type === 'LADDER') {
                    const aboveIdx = getGridIndex(x, y - 1);
                    const hasLadderAbove = spatialGrid[aboveIdx]?.some(ap => assets[ap.assetId]?.type === 'LADDER');
                    if (!hasLadderAbove) return false; // Top ladder blocks LOS? User said "TOP ladder square".
                }
            }
        }

        if (x === xEnd && y === yEnd) break;

        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
    }
    return true;
};

// --- Navigation Logic ---

const getNeighbors = (node: BadManPathNode, spatialGrid: SpatialGrid, assets: Assets): BadManPathNode[] => {
    const { gx, gy } = node;
    const neighbors: BadManPathNode[] = [];

    const isWalkable = (x: number, y: number) => !isSolid(x, y, spatialGrid, assets);
    const hasFloor = (x: number, y: number) => isSolid(x, y + 1, spatialGrid, assets) || hasLadder(x, y + 1, spatialGrid, assets);
    const onLadder = hasLadder(gx, gy, spatialGrid, assets);

    // 1. Walk Left/Right
    [-1, 1].forEach(dx => {
        const nx = gx + dx;
        const ny = gy;

        // Basic Walk Check
        if (isWalkable(nx, ny)) {
            // Can walk if floor exists OR we are on a ladder
            if (hasFloor(nx, ny) || hasLadder(nx, ny, spatialGrid, assets) || onLadder) {
                neighbors.push({ gx: nx, gy: ny, action: 'WALK' });
            }
            // Fall off edge?
            else if (!hasFloor(nx, ny)) {
                // FALL neighbor
                neighbors.push({ gx: nx, gy: ny, action: 'FALL' });
            }
        }
        else if (hasSpike(nx, ny, spatialGrid, assets)) {
            // Hit a spike! Check collision/jump.
            // If we encounter a spike at (nx, ny).
            // Can we jump over it?
            // Calculate gap width.
            let gapWidth = 0;
            let tempX = nx;
            while (hasSpike(tempX, ny, spatialGrid, assets)) {
                gapWidth++;
                tempX += dx;
                if (gapWidth > 10) break; // Too wide
            }

            // Check landing spot (tempX)
            if (!hasSpike(tempX, ny, spatialGrid, assets) && isWalkable(tempX, ny) && hasFloor(tempX, ny)) {
                // Gap is crossable?
                // Simple max jump check: Player can jump ~4 tiles?
                // Let's assume max jump is 4 tiles wide.
                if (gapWidth <= 4) {
                    // Add Special Jump Action
                    // Target is the solid ground AFTER the spikes
                    neighbors.push({ gx: tempX, gy: ny, action: 'JUMP_OVER_SPIKE' as any });
                }
            }
        }
    });

    // 2. Climb Up/Down
    if (onLadder || hasLadder(gx, gy + 1, spatialGrid, assets)) {
        // Can climb UP if ladder above or current is ladder
        if (hasLadder(gx, gy - 1, spatialGrid, assets) || onLadder) {
            // Ensure we don't climb INTO a solid/spike
            if (isWalkable(gx, gy - 1)) neighbors.push({ gx, gy: gy - 1, action: 'CLIMB' });
        }
        // Can climb DOWN
        if (isWalkable(gx, gy + 1)) neighbors.push({ gx, gy: gy + 1, action: 'CLIMB' });
    }

    // 5. Springs (Existing)
    const spring = getSpring(gx, gy + 1, spatialGrid, assets);
    if (spring) {
        neighbors.push({ gx, gy: gy - 4, action: 'USE_SPRING', vy: -5 });
    }

    return neighbors;
};

// --- A* Pathfinding ---

export const planBadManPath = (
    startX: number, startY: number,
    targetX: number, targetY: number,
    spatialGrid: SpatialGrid,
    assets: Assets
): BadManPathNode[] | null => {

    const startGx = Math.floor(startX / TILE_SIZE);
    const startGy = Math.floor(startY / TILE_SIZE);
    const targetGx = Math.floor(targetX / TILE_SIZE);
    const targetGy = Math.floor(targetY / TILE_SIZE);

    const startNode: BadManPathNode = { gx: startGx, gy: startGy, action: 'WALK' }; // Initial action irrelevant

    const openSet: BadManPathNode[] = [];
    const openSetMap = new Map<string, BadManPathNode>();
    const closedSet = new Set<string>();

    startNode.g = 0;
    startNode.h = Math.abs(startGx - targetGx) + Math.abs(startGy - targetGy);
    startNode.f = startNode.h;

    openSet.push(startNode);
    openSetMap.set(`${startGx},${startGy}`, startNode);

    let iterations = 0;
    while (openSet.length > 0 && iterations < 500) {
        iterations++;
        const isWalkable = (x: number, y: number) => !isSolid(x, y, spatialGrid, assets);
        const hasFloor = (x: number, y: number) => isSolid(x, y + 1, spatialGrid, assets) || hasLadder(x, y + 1, spatialGrid, assets);

        openSet.sort((a, b) => (a.f || 0) - (b.f || 0));
        const current = openSet.shift()!;
        const key = `${current.gx},${current.gy}`;

        openSetMap.delete(key);
        closedSet.add(key);

        if (current.gx === targetGx && current.gy === targetGy) {
            // Reconstruct
            const path: BadManPathNode[] = [];
            let temp: BadManPathNode | undefined = current;
            while (temp) {
                path.unshift(temp);
                temp = temp.parent;
            }
            return path.slice(1);
        }

        const neighbors = getNeighbors(current, spatialGrid, assets);
        for (const n of neighbors) {
            const nKey = `${n.gx},${n.gy}`;
            if (closedSet.has(nKey)) continue;

            const moveCost = n.action === 'JUMP' ? 50 : (n.action === 'CLIMB' ? 2 : 1);
            const gScore = (current.g || 0) + moveCost;
            const existing = openSetMap.get(nKey);

            if (!existing || gScore < (existing.g || Infinity)) {
                n.parent = current;
                n.g = gScore;
                n.h = Math.abs(n.gx - targetGx) + Math.abs(n.gy - targetGy);
                n.f = n.g + n.h;

                if (!existing) {
                    openSet.push(n);
                    openSetMap.set(nKey, n);
                }
            }
        }
    }

    return null;
};

// --- Update Logic ---

export const updateBadMan = (
    badMan: BadManState,
    playerState: { x: number, y: number },
    teleporterHistory: { id: string, exitId: string, entryTime: number }[],
    spatialGrid: SpatialGrid,
    assets: Assets,
    teleporterPairs: Map<string, PlacedAsset> // Maps teleporter ID to its PAIR (destination) asset
) => {
    // --- 1. Teleporter Detection Logic ---
    if (badMan.teleporterHistoryLength === undefined) {
        badMan.teleporterHistoryLength = teleporterHistory.length;
    }

    if (teleporterHistory.length > badMan.teleporterHistoryLength) {
        if (!badMan.teleportQueue) badMan.teleportQueue = [];

        // Process new events
        for (let i = badMan.teleporterHistoryLength; i < teleporterHistory.length; i++) {
            const evt = teleporterHistory[i];

            // Find Entry Asset Position (Brute force search or lookup)
            // We need the asset where the player ENTERED (id = evt.id).
            // Searching spatialGrid...
            let entryAsset: PlacedAsset | undefined;
            const size = spatialGrid.length;
            for (let j = 0; j < size; j++) {
                const cell = spatialGrid[j];
                if (cell) {
                    const found = cell.find(p => p.id === evt.id);
                    if (found) { entryAsset = found; break; }
                }
            }

            if (entryAsset) {
                // Check Line of Sight to the Entry
                const hasLos = checkLineOfSight(
                    badMan.x + badMan.width / 2, badMan.y + badMan.height / 2,
                    entryAsset.x + TILE_SIZE / 2, entryAsset.y + TILE_SIZE / 2,
                    spatialGrid, assets
                );

                // If seen, queue it!
                if (hasLos) {
                    const exitAsset = teleporterPairs.get(evt.id);
                    if (exitAsset) {
                        badMan.teleportQueue.push({
                            entryId: evt.id,
                            entryX: entryAsset.x,
                            entryY: entryAsset.y,
                            exitX: exitAsset.x,
                            exitY: exitAsset.y
                        });
                        // Automatically switch to FOLLOW if searching to start pursuit
                        if (badMan.mode === 'SEARCH') badMan.mode = 'FOLLOW';
                    }
                }
            }
        }
        badMan.teleporterHistoryLength = teleporterHistory.length;
    }
    // Helper: Initialize Search Sections if missing
    if (!badMan.searchSections || badMan.searchSections.length === 0) {
        badMan.searchSections = [];
        const sectionWidth = GAME_WIDTH / 4;
        for (let i = 0; i < 4; i++) {
            badMan.searchSections.push((i * sectionWidth) + (sectionWidth / 2));
        }
    }

    // Helper: Centralized Movement with Turn Delay
    const applyMovementWithTurnDelay = (dx: number, speed: number) => {
        if (Math.abs(dx) <= 1) {
            badMan.vx = 0;
            badMan.turnTimer = 0;
            return;
        }

        const desiredDir = Math.sign(dx) as 1 | -1;
        if (desiredDir !== badMan.facingDirection) {
            // Turn Delay Active
            if (!badMan.turnTimer) { /* Log removed */ }

            badMan.turnTimer = (badMan.turnTimer ?? 0) + 1;
            badMan.vx = 0;
            badMan.animationState = 'IDLE';

            if (badMan.turnTimer > 15) { // 0.25s delay
                // Log removed

                badMan.facingDirection = desiredDir;
                badMan.turnTimer = 0;
            }
        } else {
            // Safe to move
            badMan.turnTimer = 0;
            badMan.vx = desiredDir * speed;
            badMan.facingDirection = desiredDir;
            badMan.animationState = 'WALKING';
        }
    };
    badMan.searchSectionIndex = badMan.searchSectionIndex || 0;

    if (!badMan.mode) badMan.mode = 'SEARCH';

    badMan.searchTimer = badMan.searchTimer || 0;
    badMan.spawnX = badMan.spawnX || badMan.x;
    badMan.spawnY = badMan.spawnY || badMan.y;

    // Helper: Collision Checks
    const checkCollision = (x: number, y: number): boolean => {
        const cx = Math.floor(x / TILE_SIZE);
        const cy = Math.floor(y / TILE_SIZE);
        const idx = getGridIndex(cx, cy);
        if (idx === -1) return false;

        return spatialGrid[idx]?.some(p => {
            const a = assets[p.assetId];
            if (!a) return false;

            // 1. Platform/Door Logic
            if (a.type === 'PLATFORM' || a.type === 'DOOR') {
                if (badMan.animationState === 'CLIMBING' && Math.abs(badMan.vy) > 0.01) return false;
                return true;
            }

            // 2. Ladder Top Logic
            if (a.type === 'LADDER') {
                const aboveIdx = getGridIndex(cx, cy - 1);
                const hasLadderAbove = spatialGrid[aboveIdx]?.some(ap => assets[ap.assetId]?.type === 'LADDER');
                if (!hasLadderAbove) {
                    if (badMan.animationState === 'CLIMBING' && Math.abs(badMan.vy) > 0.01) return false;
                    return true;
                }
            }

            // 3. Spikes Logic
            if (a.type === 'SPIKE') {
                // Ignore spikes if jumping OR if STUNNED (so we can fall into them)
                if (badMan.mode === 'RUN_JUMP' || badMan.mode === 'PREPARE_JUMP' || badMan.animationState === 'JUMPING' || badMan.stunTimer > 0) return false;
                return true;
            }

            return false;
        }) ?? false;
    };

    // Helper: Spike Hazard Contact (For Death)
    const checkSpikeContact = (x: number, y: number): boolean => {
        const points = [
            { x: x + 6, y: y + 4 },
            { x: x + badMan.width - 6, y: y + 4 },
            { x: x + 6, y: y + badMan.height - 4 },
            { x: x + badMan.width - 6, y: y + badMan.height - 4 }
        ];

        for (const p of points) {
            const cx = Math.floor(p.x / TILE_SIZE);
            const cy = Math.floor(p.y / TILE_SIZE);
            const idx = getGridIndex(cx, cy);
            if (spatialGrid[idx]?.some(asset => assets[asset.assetId]?.type === 'SPIKE')) {
                return true;
            }
        }
        return false;
    };

    // Stun Logic
    badMan.stunTimer = badMan.stunTimer ?? 0;
    const isStunned = badMan.stunTimer > 0;
    if (isStunned) {
        badMan.stunTimer--;

        // Spike Death Check
        if (checkSpikeContact(badMan.x, badMan.y)) {
            badMan.mode = 'DEAD';
            badMan.stunTimer = 0;
            badMan.vx = 0;
            badMan.vy = -3; // Pop up
            badMan.respawnTimer = 600;
            badMan.isVisible = true;
            badMan.slideTimer = 0;
            return;
        }

        if (badMan.slideTimer && badMan.slideTimer > 0) {
            badMan.slideTimer--;
            if (badMan.slideDirection) {
                const nextX = badMan.x + badMan.slideDirection;
                // Simple wall check - only move if not solid
                // We check the leading edge: if moving right, check right side; if left, check left side.
                // Using badMan.width/height offsets.
                const checkX = badMan.slideDirection === 1 ? nextX + badMan.width : nextX;
                // Wall Check: Check Top and Middle to avoid Ground friction issues
                const solidTop = checkCollision(checkX, badMan.y);
                const solidMid = checkCollision(checkX, badMan.y + badMan.height / 2); // Check middle, not feet

                if (!solidTop && !solidMid) {
                    badMan.x = nextX;
                } else {
                    badMan.slideTimer = 0;
                }
            }
        }

        // Waking State Logic (Head crane up + drops)
        if (badMan.stunTimer < 30) {
            badMan.animationState = 'WAKING';
        } else {
            badMan.animationState = 'FLATTENED';
        }

        badMan.vx = 0;
    }

    let currentSpeed = BAD_MAN_SPEED; // Default

    // --- AI State Machine ---
    if (!isStunned) {
        let targetX = badMan.x;
        let targetY = badMan.y;

        // DEAD MODE
        if (badMan.mode === 'DEAD') {
            badMan.animationState = 'IDLE'; // Force IDLE to stop any running loops
            badMan.vx = 0;
            badMan.vy = 0;
            badMan.respawnTimer = (badMan.respawnTimer ?? 0) - 1;

            // Blink Effect (Shortened)
            if (badMan.respawnTimer > (600 - 120)) { // First 2 seconds (was 480 threshold? user wants half?)
                // Actually user said "Shorten blinking phase by half".
                // Original was 2s blink (600 -> 480). Then 8s hidden.
                // Let's make it 1s blink.
                // Respawn starts at 600.
                if (badMan.respawnTimer > 540) { // First 1 second (60 frames)
                    badMan.isVisible = Math.floor(badMan.respawnTimer / 10) % 2 === 0;
                } else {
                    badMan.isVisible = false; // Hidden
                }
            } else {
                badMan.isVisible = false; // Hidden
            }

            if (badMan.respawnTimer <= 0) {
                // Respawn
                badMan.x = badMan.spawnX ?? badMan.x;
                badMan.y = badMan.spawnY ?? badMan.y;
                badMan.mode = 'SEARCH';
                badMan.animationState = 'IDLE';
                badMan.isVisible = true;
                badMan.searchTimer = 0;

            }
            return; // Skip other logic
        }

        // Line of Sight Check (Global, unless Surprised)
        if (badMan.mode === 'SEARCH') {
            const hasLos = checkLineOfSight(badMan.x + badMan.width / 2, badMan.y + badMan.height / 2, playerState.x + 4, playerState.y + 4, spatialGrid, assets);

            badMan.detectionTimer = badMan.detectionTimer ?? 0;

            if (hasLos) {
                badMan.detectionTimer++;
                // Require 0.5s (30 frames) of continuous LoS
                if (badMan.detectionTimer > 30) {
                    // SURPRISE!
                    badMan.mode = 'FOLLOW';
                    badMan.animationState = 'SURPRISED';
                    badMan.surprisedTimer = 40; // Shortened from 60 (30% less approx)
                    badMan.vx = 0;
                    badMan.vy = -1.5; // Small jump
                    badMan.onGround = false;
                    badMan.path = null; // Clear path
                    badMan.detectionTimer = 0; // Reset

                    return; // Exit this frame to process Surprise next
                }
            } else {
                badMan.detectionTimer = 0; // Reset if LoS lost
            }
        }

        // Handle Modes
        if (badMan.animationState === 'SURPRISED') {
            badMan.surprisedTimer--;
            badMan.vx = 0;
            if (badMan.surprisedTimer <= 0) {
                badMan.mode = 'FOLLOW';
                badMan.animationState = 'IDLE';
            }
        }
        else if (badMan.mode === 'EXAMINE_SPIKES') {
            badMan.vx = 0;
            badMan.animationState = 'LOOKING';
            badMan.examineTimer = (badMan.examineTimer ?? 0) - 1;

            if (badMan.examineTimer <= 0) {
                badMan.animationState = 'IDLE'; // Reset animation to allow movement
                if (badMan.spikeJumpData) {
                    // Crossable -> Prepare Jump
                    badMan.mode = 'PREPARE_JUMP';
                    // Log removed
                } else {
                    // Uncrossable -> Give Up -> Search
                    badMan.mode = 'SEARCH';
                    badMan.searchTimer = 0; // Start patrolling immediate
                    // Log removed
                }
            }
        }
        else if (badMan.mode === 'SEARCH') {
            currentSpeed = PLAYER_SPEED * 0.5; // 50% of Player Speed

            // Patrol Logic
            const destX = badMan.searchSections[badMan.searchSectionIndex];
            targetX = destX;
            targetY = badMan.y;

            // Check if arrived (approx X)
            if (Math.abs(badMan.x - destX) < TILE_SIZE) {
                badMan.searchTimer--;
                if (badMan.searchTimer <= 0) {
                    if (badMan.animationState === 'LOOKING') {
                        // Done looking. Move next.
                        badMan.searchSectionIndex = (badMan.searchSectionIndex + 1) % 4;
                        badMan.searchTimer = 0;
                        badMan.animationState = 'IDLE';
                        // Log removed
                    } else {
                        // Start Looking
                        badMan.animationState = 'LOOKING';
                        badMan.searchTimer = 60; // Look for 1s
                        badMan.vx = 0;
                        badMan.path = null;
                        // Log removed
                    }
                }
            }
        }
        else if (badMan.mode === 'FOLLOW') {
            currentSpeed = PLAYER_SPEED * 0.8; // 80% of Player Speed
            targetX = playerState.x;
            targetY = playerState.y;
        }

        else if (badMan.mode === 'PREPARE_JUMP') {
            currentSpeed = PLAYER_SPEED * 0.5; // Walk back slowly (50% speed)
            if (badMan.spikeJumpData) {
                targetX = badMan.spikeJumpData.runStartX;
                targetY = badMan.y;
                const dx = targetX - badMan.x;

                badMan.prepareTimeout = (badMan.prepareTimeout || 0) + 1;

                // Move towards retreat point
                if (Math.abs(dx) > 4 && badMan.prepareTimeout < 180) { // Increased timeout
                    const retreatDir = Math.sign(dx) as 1 | -1;
                    badMan.facingDirection = retreatDir; // Turn immediately
                    badMan.vx = retreatDir * currentSpeed;
                    badMan.animationState = 'WALKING';
                } else {
                    // Reached target (or timed out) - PAUSE before Running!
                    badMan.vx = 0;
                    badMan.animationState = 'IDLE'; // Look at the spikes (or just stand)

                    // Simple property to track pause state
                    badMan.spikeJumpData.pauseTimer = (badMan.spikeJumpData.pauseTimer || 0) + 1;

                    // Wait 30 frames (0.5s)
                    if ((badMan.spikeJumpData.pauseTimer || 0) > 30 || badMan.prepareTimeout >= 180) {
                        if ((badMan.spikeJumpData.pauseTimer || 0) > 30 || badMan.prepareTimeout >= 180) {
                            badMan.mode = 'RUN_JUMP';
                            badMan.prepareTimeout = 0;
                            const dir = badMan.spikeJumpData.originalDirection;
                            badMan.facingDirection = dir;
                            badMan.vx = dir * PLAYER_SPEED;
                            // badMan.vy = -1; // REMOVED
                            if (badMan.prepareTimeout >= 180) {
                                // Force jump immediately if we were stuck
                                badMan.vy = BAD_MAN_JUMP_FORCE;
                                badMan.onGround = false;
                                badMan.animationState = 'JUMPING';
                                badMan.spikeJumpData.hasJumped = true;
                            }
                        }
                    }
                }
            } else {
                badMan.mode = 'FOLLOW';
            }
        }

        // --- Teleporter Queue Override ---
        if (badMan.teleportQueue && badMan.teleportQueue.length > 0) {
            // Override target to the next teleporter entry
            const nextTeleport = badMan.teleportQueue[0];
            targetX = nextTeleport.entryX;
            targetY = nextTeleport.entryY;

            // Ensure we are in a moving mode (not SEARCH/IDLE)
            if (badMan.mode === 'SEARCH') badMan.mode = 'FOLLOW';
        }

        // --- Execute Path ---
        if (!isStunned && badMan.animationState !== 'SURPRISED' && badMan.animationState !== 'LOOKING' && badMan.path && badMan.pathIndex < badMan.path.length) {
            // Skip Execute Path if RUN_JUMP or PREPARE_JUMP (Handled manually)
            if (badMan.mode === 'RUN_JUMP' || badMan.mode === 'PREPARE_JUMP') {
                // Do nothing here
            } else {
                const node = badMan.path[badMan.pathIndex];
                const targetPixelX = node.gx * TILE_SIZE;
                let targetPixelY = node.gy * TILE_SIZE;

                // Detect Spike Jump Action
                if ((node.action as any) === 'JUMP_OVER_SPIKE' && badMan.mode === 'FOLLOW') {
                    const direction = Math.sign(targetPixelX - badMan.x) as 1 | -1;

                    // Calc Retreat Target (Simplified for Reliability)
                    // Request: "Walk back a few squares" (specifically 2)
                    // We will prioritize 2 tiles, then 1 tile.

                    let runStartX = badMan.x;
                    const tile2 = 2.0 * TILE_SIZE;
                    const tile1 = 1.0 * TILE_SIZE;

                    const originalMode = badMan.mode;
                    badMan.mode = 'PREPARE_JUMP'; // Ignore spikes during check

                    // Check 2.0 back
                    const testX2 = badMan.x - (direction * tile2);
                    const hit2 = checkCollision(testX2, badMan.y + badMan.height / 2) ||
                        checkCollision(testX2 + badMan.width - 0.1, badMan.y + badMan.height / 2);

                    if (!hit2) {
                        runStartX = testX2;
                    } else {
                        // Check 1.0 back
                        const testX1 = badMan.x - (direction * tile1);
                        const hit1 = checkCollision(testX1, badMan.y + badMan.height / 2) ||
                            checkCollision(testX1 + badMan.width - 0.1, badMan.y + badMan.height / 2);
                        if (!hit1) {
                            runStartX = testX1;
                        }
                    }

                    badMan.mode = originalMode;



                    // Save the "Edge of the pit" (Current X)
                    const spikeEdgeX = badMan.x;

                    badMan.spikeJumpData = {
                        targetX: targetPixelX,
                        runStartX: runStartX,
                        spikeEdgeX: spikeEdgeX, // NEW: Remember where the spikes start!
                        originalDirection: direction,
                        hasJumped: false
                    };
                    // Stop to examine first!
                    badMan.mode = 'EXAMINE_SPIKES';
                    badMan.examineTimer = 20;
                    badMan.path = null;
                    badMan.path = null;
                    return;
                }

                // Topping Out Logic
                if (node.action === 'CLIMB') {
                    const idx = getGridIndex(node.gx, node.gy);
                    const hasPlatform = spatialGrid[idx]?.some(p => assets[p.assetId]?.type === 'PLATFORM');
                    if (hasPlatform) {
                        targetPixelY -= badMan.height;
                    }
                }

                const dx = targetPixelX - badMan.x;
                const dy = targetPixelY - badMan.y;

                // Movement
                if (Math.abs(dx) > 1) {
                    applyMovementWithTurnDelay(dx, currentSpeed);
                } else {
                    badMan.vx = 0;
                    badMan.x = targetPixelX;
                    if (node.action !== 'CLIMB' && node.action !== 'JUMP') {
                        badMan.animationState = 'IDLE';
                    }
                }

                // Action Handling
                if (node.action === 'JUMP') {
                    if (badMan.onGround && badMan.vy === 0) {
                        badMan.vy = BAD_MAN_JUMP_FORCE;
                        badMan.animationState = 'JUMPING';
                        badMan.onGround = false;
                    }
                }
                else if (node.action === 'CLIMB') {
                    if (Math.abs(dx) > 1) {
                        badMan.vx = Math.sign(dx) * (currentSpeed * 0.5);
                        badMan.vy = 0;
                        badMan.animationState = 'WALKING';
                    } else {
                        badMan.vx = 0;
                        badMan.x = targetPixelX;
                        badMan.vy = Math.sign(dy) * 1.0;
                        badMan.animationState = 'CLIMBING';
                        badMan.onGround = false;
                    }
                }
                else if (node.action === 'USE_SPRING') {
                    badMan.vy = -5;
                    badMan.animationState = 'JUMPING';
                    badMan.onGround = false;
                }

                // Node Completion
                if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
                    badMan.pathIndex++;
                }
            }
        } else if (!isStunned && badMan.animationState !== 'SURPRISED' && badMan.animationState !== 'LOOKING' && badMan.mode !== 'RUN_JUMP' && badMan.mode !== 'PREPARE_JUMP') {
            // Idle friction/stop if no path (And NOT sprinting)
            badMan.vx = 0;
            // Don't reset state if falling/jumping?
            if (badMan.onGround) badMan.animationState = 'IDLE';
        }

        // --- Manual RUN_JUMP Execution ---
        if (badMan.mode === 'RUN_JUMP') {
            currentSpeed = PLAYER_SPEED; // 100% Player Speed
            if (badMan.spikeJumpData) {
                targetX = badMan.spikeJumpData.targetX;
                targetY = badMan.y;
            }

            if (badMan.spikeJumpData) {
                const dir = badMan.spikeJumpData.originalDirection;
                badMan.vx = dir * PLAYER_SPEED; // Full Speed
                badMan.facingDirection = dir;
                badMan.animationState = 'WALKING'; // Sprinting

                // DETERMINISTIC JUMP TRIGGER
                // Jump when we are back at the "Edge" of the pit (where we started the retreat)
                const edgeX = badMan.spikeJumpData?.spikeEdgeX;
                const distToEdge = Math.abs(badMan.x - (edgeX || 0));

                // If we are VERY close to the edge (or slightly past it), JUMP.
                // Use a threshold of < 4 pixels (0.5 tile). This forces a full run-up.
                // AND ensure we are moving towards the spikes (sanity check)
                const runningTowardsSpikes = (dir === 1 && badMan.x < targetX) || (dir === -1 && badMan.x > targetX);

                if (edgeX !== undefined && runningTowardsSpikes && distToEdge < 2 && badMan.onGround) {
                    badMan.vy = BAD_MAN_JUMP_FORCE;
                    badMan.onGround = false;
                    badMan.animationState = 'JUMPING';
                    badMan.spikeJumpData.hasJumped = true;
                }

                // FIX: Check if we are stuck on the landing (e.g. hitting the corner of the next platform)
                // If we have jumped, are on ground (or close), and x is not moving despite vx != 0
                if (badMan.spikeJumpData.hasJumped && badMan.onGround) {
                    // Check if we have crossed the gap. targetX is the destination node.
                    const distToTarget = Math.abs(badMan.x - targetX);
                    if (distToTarget < 8) {
                        // We made it!
                        badMan.mode = 'FOLLOW';
                        badMan.spikeJumpData = undefined;
                        badMan.vx = 0;
                        return;
                    }

                    // Exit condition: If we passed the target X or the spike edge
                    const passedEdge = (dir === 1 && badMan.x > edgeX + 16) || (dir === -1 && badMan.x < edgeX - 16);
                    if (passedEdge) {
                        badMan.mode = 'FOLLOW';
                        badMan.spikeJumpData = undefined;
                        badMan.vx = 0; // Stop and let pathfinding take over
                        badMan.pathIndex = 0; // Reset path to ensure we re-evaluate
                        badMan.path = null;
                        return;
                    }
                }
            }
        }

        // Path Planning (Refreshes)
        if (badMan.mode !== 'RUN_JUMP' && badMan.mode !== 'EXAMINE_SPIKES' && badMan.mode !== 'PREPARE_JUMP' && badMan.animationState !== 'SURPRISED' && badMan.animationState !== 'LOOKING') {
            if (badMan.timer > 0) badMan.timer--;
            // Re-plan
            if (badMan.timer <= 0 || !badMan.path || badMan.pathIndex >= badMan.path.length) {
                const newPath = planBadManPath(badMan.x, badMan.y, targetX, targetY, spatialGrid, assets);
                if (newPath) {
                    badMan.path = newPath;
                    badMan.pathIndex = 0;
                    badMan.timer = 15;
                } else {
                    badMan.timer = 10;
                    // Path Failed. Check for Uncrossable Spikes (if Following)
                    if (badMan.mode === 'FOLLOW') {
                        // Check in front
                        const dir = Math.sign(playerState.x - badMan.x) || 1;
                        const checkX = badMan.x + (dir * TILE_SIZE * 1.5); // Check slightly ahead
                        if (hasSpike(checkX, badMan.y, spatialGrid, assets)) {
                            // Blocked by spikes!
                            badMan.mode = 'EXAMINE_SPIKES';
                            badMan.examineTimer = 30; // Look for 0.5s
                            badMan.spikeJumpData = undefined; // No Jump
                        }
                    }
                    else if (badMan.mode === 'SEARCH') {
                        badMan.searchSectionIndex = (badMan.searchSectionIndex + 1) % 4;
                    }
                }
            }
        }
    }



    // Apply Gravity (Global)
    const isClimbing = badMan.animationState === 'CLIMBING';
    if (!badMan.onGround && !isClimbing && badMan.mode !== 'DEAD') {
        badMan.vy += GRAVITY;
    }

    // --- Physics Integration (X/Y) ---
    if (badMan.vx !== 0) {
        const nextX = badMan.x + badMan.vx;
        const hitWall =
            checkCollision(nextX, badMan.y) ||
            checkCollision(nextX + badMan.width - 0.1, badMan.y) ||
            checkCollision(nextX, badMan.y + badMan.height - 0.1) ||
            checkCollision(nextX + badMan.width - 0.1, badMan.y + badMan.height - 0.1);

        if (!hitWall) {
            badMan.x = nextX;
        } else {
            badMan.vx = 0;
        }
    }

    if (badMan.vy !== 0) {
        const nextY = badMan.y + badMan.vy;
        const movingDown = badMan.vy > 0;

        const hitCeiling = !movingDown && (
            checkCollision(badMan.x, nextY) ||
            checkCollision(badMan.x + badMan.width - 0.1, nextY)
        );

        const hitFloor = movingDown && (
            checkCollision(badMan.x, nextY + badMan.height) ||
            checkCollision(badMan.x + badMan.width - 0.1, nextY + badMan.height)
        );

        if (hitCeiling) {
            badMan.vy = 0;
        } else if (hitFloor) {
            badMan.vy = 0;
            badMan.onGround = true;
            badMan.y = Math.floor((nextY + badMan.height) / TILE_SIZE) * TILE_SIZE - badMan.height;
            // If landed in RUN_JUMP, Check if we made it?
            if (badMan.mode === 'RUN_JUMP' && badMan.spikeJumpData?.hasJumped) {
                // Assume success for now, switch back to Follow
                badMan.mode = 'FOLLOW';
                badMan.spikeJumpData = undefined;

            }
        } else {
            badMan.y = nextY;
            badMan.onGround = false;
        }
    } else {
        if (!isClimbing) {
            const checkGround =
                checkCollision(badMan.x, badMan.y + badMan.height + 1) ||
                checkCollision(badMan.x + badMan.width - 0.1, badMan.y + badMan.height + 1);
            if (!checkGround) {
                badMan.onGround = false;
            }
        }
    }

    // --- Hazard Check (DEATH) ---
    if (badMan.mode !== 'DEAD' && checkSpikeContact(badMan.x, badMan.y)) {


        // Are we safely jumping?
        const isSafeJump = badMan.mode === 'RUN_JUMP' && !badMan.onGround; // Must be AIRBORNE to be safe!

        if (!isSafeJump) {
            // DIE
            badMan.mode = 'DEAD';
            badMan.animationState = 'IDLE'; // Stop running!
            badMan.respawnTimer = 600; // 10 seconds
            badMan.vx = 0;
            badMan.vy = 0;
            badMan.isVisible = true;

        }
    }
    // --- Teleporter Logic ---
    if (badMan.teleporterCooldown && badMan.teleporterCooldown > 0) {
        badMan.teleporterCooldown--;
    }

    if (teleporterPairs && badMan.mode !== 'DEAD') {
        const badManCenterX = badMan.x + badMan.width / 2;
        const badManCenterY = badMan.y + badMan.height / 2;
        const cx = Math.floor(badManCenterX / TILE_SIZE);
        const cy = Math.floor(badManCenterY / TILE_SIZE);
        const idx = getGridIndex(cx, cy);

        // Check center tile for teleporter
        const teleporter = spatialGrid[idx]?.find(a => assets[a.assetId]?.type === 'TELEPORTER');

        if (teleporter) {
            const tCenterX = teleporter.x + TILE_SIZE / 2;
            const tCenterY = teleporter.y + TILE_SIZE / 2;
            // Use 6 pixel distance (~0.75 tile) for center proximity - wider tolerance
            if (Math.abs(badManCenterX - tCenterX) <= 6 && Math.abs(badManCenterY - tCenterY) <= 6) {
                if (badMan.lastTeleporterId !== teleporter.id) {
                    // Teleport!
                    const partner = teleporterPairs.get(teleporter.id);
                    if (partner && (!badMan.teleporterCooldown || badMan.teleporterCooldown <= 0)) {
                        badMan.x = partner.x;
                        badMan.y = partner.y;
                        badMan.vx = 0; badMan.vy = 0;
                        badMan.lastTeleporterId = partner.id; // Mark exit teleporter as "last visited"

                        // Queue Cleanup: If this was the queued teleporter, remove it
                        if (badMan.teleportQueue && badMan.teleportQueue.length > 0) {
                            if (badMan.teleportQueue[0].entryId === teleporter.id) {
                                badMan.teleportQueue.shift();
                            }
                        }

                        badMan.teleporterCooldown = 60; // 1s cooldown
                        badMan.path = null; // Clear path
                        badMan.onGround = false;
                    }
                }
            } else {
                if (badMan.lastTeleporterId === teleporter.id) badMan.lastTeleporterId = null;
            }
        } else {
            // Left the teleporter tile
            badMan.lastTeleporterId = null;
        }
    }
};
