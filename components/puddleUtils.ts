
import { Assets, PlacedAsset, PuddleState, PuddleSide, PuddlePathNode as PathNode } from '../types';
import { TILE_SIZE, GAME_WIDTH, GAME_HEIGHT } from '../constants';

// --- Types ---
// Imported from types.ts


// Optimized Spatial Grid Interface (matches GameCanvas)
type SpatialGrid = (PlacedAsset[] | undefined)[];
const TILES_X = GAME_WIDTH / TILE_SIZE;
const TILES_Y = GAME_HEIGHT / TILE_SIZE;

const getGridIndex = (gx: number, gy: number): number => {
    if (gx < 0 || gx >= TILES_X || gy < 0 || gy >= TILES_Y) return -1;
    return gy * TILES_X + gx;
};

// --- Helpers ---

const isSolid = (gx: number, gy: number, spatialGrid: SpatialGrid, assets: Assets): boolean => {
    const idx = getGridIndex(gx, gy);
    if (idx === -1) return false; // Bounds check: out of bounds is NOT solid (void), or is it? Assuming void is empty.

    return spatialGrid[idx]?.some(p => {
        const a = assets[p.assetId];
        return a && (a.type === 'PLATFORM' || a.type === 'DOOR');
    }) ?? false;
};

const hasLadder = (gx: number, gy: number, spatialGrid: SpatialGrid, assets: Assets): boolean => {
    const idx = getGridIndex(gx, gy);
    if (idx === -1) return false;
    return spatialGrid[idx]?.some(p => {
        const a = assets[p.assetId];
        return a && a.type === 'LADDER';
    }) ?? false;
};

// --- Navigation Logic ---

// Get robust neighbors for A*
const getNeighbors = (node: PathNode, spatialGrid: SpatialGrid, assets: Assets): PathNode[] => {
    const { gx, gy, side } = node;
    const neighbors: PathNode[] = [];

    // Helper to check validity
    const allowMove = (nx: number, ny: number) => !isSolid(nx, ny, spatialGrid, assets);
    // Treat LADDER as solid path for support (allows walking ON TOP of ladders)
    const requiresSolid = (nx: number, ny: number) => isSolid(nx, ny, spatialGrid, assets) || hasLadder(nx, ny, spatialGrid, assets);

    if (side === 'LADDER') {
        // 1. Climb UP/DOWN
        if (hasLadder(gx, gy - 1, spatialGrid, assets)) {
            neighbors.push({ gx, gy: gy - 1, side: 'LADDER', action: 'CLIMB' });
        } else if (allowMove(gx, gy - 1)) {
            neighbors.push({ gx, gy, side: 'TOP', action: 'CLIMB' });
        }

        if (hasLadder(gx, gy + 1, spatialGrid, assets)) {
            neighbors.push({ gx, gy: gy + 1, side: 'LADDER', action: 'CLIMB' });
        } else if (requiresSolid(gx, gy + 1)) {
            // Floor below
            neighbors.push({ gx, gy: gy + 1, side: 'TOP', action: 'CLIMB' });
        }

        // 2. Climb SIDEWAYS (to walls)
        if (requiresSolid(gx - 1, gy)) neighbors.push({ gx: gx - 1, gy, side: 'RIGHT', action: 'CLIMB' });
        if (requiresSolid(gx + 1, gy)) neighbors.push({ gx: gx + 1, gy, side: 'LEFT', action: 'CLIMB' });

        return neighbors;
    }

    // Surface Movement (TOP, BOTTOM, LEFT, RIGHT)
    const dirs = [-1, 1]; // Left/Up, Right/Down

    if (side === 'TOP' || side === 'BOTTOM') {
        // Moving Horizontal
        for (const dx of dirs) {
            const nextGx = gx + dx;
            const nextGy = gy; // Moving along same row
            // Side 'TOP' means we are on TOP of block (gx,gy). So block (gx,gy) is solid. Air is (gx, gy-1).
            // Side 'BOTTOM' means we are on BOTTOM of block (gx,gy). Block (gx,gy) is solid. Air is (gx, gy+1).
            const airGy = side === 'TOP' ? gy - 1 : gy + 1;

            // 1. WALK (Straight)
            // Condition: Next block (nextGx, gy) is solid, and Next Air (nextGx, airGy) is empty.
            if (requiresSolid(nextGx, gy) && allowMove(nextGx, airGy)) {
                neighbors.push({ gx: nextGx, gy, side, action: 'WALK' });
            }
            // 2. CONVEX TURN (Outer Corner)
            // Condition: Next block (nextGx, gy) is EMPTY (cliff/edge).
            // We wrap around to the side of the current block.
            else if (!requiresSolid(nextGx, gy) && allowMove(nextGx, gy)) { // Must be empty to wrap into it
                const newSide = dx === 1 ? 'RIGHT' : 'LEFT';
                neighbors.push({ gx, gy, side: newSide, action: 'WRAP_CONVEX' });
            }
            // 3. CONCAVE TURN (Inner Corner)
            // Condition: Next Air (nextGx, airGy) is SOLID (wall in face).
            // We wrap onto that wall.
            else if (requiresSolid(nextGx, airGy)) {
                // We move TO the wall block (nextGx, airGy).
                // Side becomes: Moving Right -> LEFT side of wall. Moving Left -> RIGHT side.
                const newSide = dx === 1 ? 'LEFT' : 'RIGHT';
                neighbors.push({ gx: nextGx, gy: airGy, side: newSide, action: 'WRAP_CONCAVE' });
            }

            // 4. LADDER INTERACTION
            if (side === 'TOP' && hasLadder(gx, airGy, spatialGrid, assets)) {
                neighbors.push({ gx, gy: airGy, side: 'LADDER', action: 'CLIMB' });
            }
            // Special Case: Ladder Top.
            if (side === 'TOP' && hasLadder(gx, gy, spatialGrid, assets)) {
                neighbors.push({ gx, gy, side: 'LADDER', action: 'CLIMB' }); // Enter down
            }

            // 5. DROP (from Ceiling/BOTTOM only)
            if (side === 'BOTTOM') {
                // Check if clear below
                let dropY = gy + 1; // Air
                // Scan down 10 tiles max
                for (let i = 0; i < 10; i++) {
                    if (requiresSolid(gx, dropY)) {
                        neighbors.push({ gx, gy: dropY, side: 'TOP', action: 'DROP' });
                        break;
                    }
                    if (hasLadder(gx, dropY, spatialGrid, assets)) {
                        neighbors.push({ gx, gy: dropY, side: 'LADDER', action: 'DROP' });
                        break;
                    }
                    dropY++;
                }
            }
        }
    } else { // LEFT or RIGHT
        // Moving Vertical
        for (const dy of dirs) {
            const nextGy = gy + dy;
            const nextGx = gx;
            const airGx = side === 'LEFT' ? gx - 1 : gx + 1;

            if (requiresSolid(gx, nextGy) && allowMove(airGx, nextGy)) {
                neighbors.push({ gx, gy: nextGy, side, action: 'WALK' });
            } else if (!requiresSolid(gx, nextGy) && allowMove(gx, nextGy)) {
                const newSide = dy === 1 ? 'BOTTOM' : 'TOP';
                neighbors.push({ gx, gy, side: newSide, action: 'WRAP_CONVEX' });
            } else if (requiresSolid(airGx, nextGy)) {
                const newSide = dy === 1 ? 'TOP' : 'BOTTOM';
                neighbors.push({ gx: airGx, gy: nextGy, side: newSide, action: 'WRAP_CONCAVE' });
            }

            // Ladder from side
            if (hasLadder(airGx, gy, spatialGrid, assets)) {
                neighbors.push({ gx: airGx, gy, side: 'LADDER', action: 'CLIMB' });
            }
        }
    }

    return neighbors;
};

// --- A* Pathfinding ---

export const planPuddlePath = (
    startNode: PathNode,
    playerRect: { x: number, y: number, w: number, h: number },
    spatialGrid: SpatialGrid,
    assets: Assets,
    otherPuddles: PuddleState[] = [],
    myId: string
): PathNode[] | null => {

    const targetCx = playerRect.x + playerRect.w / 2;
    const targetCy = playerRect.y + playerRect.h / 2;

    // Determine Target Side based on Player Position relative to Grid
    let targetSide: PuddleSide = 'TOP'; // Default
    let targetGx = Math.floor(targetCx / TILE_SIZE);
    let targetGy = Math.floor(targetCy / TILE_SIZE);

    // Analyze player position to find which surface they are likely on
    // If player feet are near the bottom of their tile, they are on TOP of the tile below.
    // If player is climbing (needs state info? or just assume LADDER if on ladder tile)

    // Check if on Ladder
    if (hasLadder(targetGx, targetGy, spatialGrid, assets)) {
        targetSide = 'LADDER';
    } else {
        // Assume standing on floor (TOP of solid block)
        // Solid block is at targetGy + 1 (below feet)
        // So target is (Gx, Gy+1, TOP)
        // Wait, playerRect.y is TopLeft. Feet are at y+h.
        const feetY = playerRect.y + playerRect.h;
        // Block below feet
        const blockGy = Math.floor((feetY + 1) / TILE_SIZE);

        // However, we want to target the specific block surface the player is traversing.
        // If player is standing on a platform at (Gx, Gy), the player is at (Gx, Gy-1).
        // The Surface is TOP of (Gx, Gy).

        // Let's refine targetGx/Gy to point to the SOLID block the puddle should attach to.
        // Try raycast down to find solid ground
        if (isSolid(targetGx, blockGy, spatialGrid, assets)) {
            targetGy = blockGy;
            targetSide = 'TOP';
        } else if (isSolid(targetGx, blockGy + 1, spatialGrid, assets)) {
            // Maybe falling?
            targetGy = blockGy + 1;
            targetSide = 'TOP';
        } else {
            // Check walls (Side Clinging?) - not for player usually.
            // Default to current grid center solid check?
            // Fallback: Just aim for nearest node?
            // Let's stick to "Bottom of Player -> Top of Block" logic for now.
            targetGy = blockGy;
            targetSide = 'TOP';
        }
    }

    const startKey = `${startNode.gx},${startNode.gy},${startNode.side}`;

    // Nodes to avoid (occupied by others)
    const avoidanceMap = new Set<string>();
    // Add "future" paths of others to avoidance
    otherPuddles.forEach(p => {
        if (p.id === myId) return;
        if (p.path) {
            p.path.forEach(n => avoidanceMap.add(`${n.gx},${n.gy},${n.side}`));
        } else {
            avoidanceMap.add(`${p.gridX},${p.gridY},${p.side}`);
        }
    });

    const openSet: PathNode[] = [];
    const openSetMap = new Map<string, PathNode>();
    const closedSet = new Set<string>();

    startNode.g = 0;
    startNode.h = Math.abs((startNode.gx * TILE_SIZE) - targetCx) + Math.abs((startNode.gy * TILE_SIZE) - targetCy);
    startNode.f = startNode.h;

    openSet.push(startNode);
    openSetMap.set(startKey, startNode);

    // Track closest node to target in case we can't search all the way
    let closestNode: PathNode = startNode;
    let minH = startNode.h || Infinity;

    let iterations = 0;
    const MAX_ITERATIONS = 400; // Limit search

    while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        // Pop lowest f
        openSet.sort((a, b) => (a.f || 0) - (b.f || 0));
        const current = openSet.shift()!;
        const currentKey = `${current.gx},${current.gy},${current.side}`;
        openSetMap.delete(currentKey);
        closedSet.add(currentKey);

        // Update closest node (fallback)
        if ((current.h || Infinity) < minH) {
            minH = current.h || Infinity;
            closestNode = current;
        }

        // Check Goal (Distance < 2 tiles)
        const currentPixelX = current.gx * TILE_SIZE + TILE_SIZE / 2;
        const currentPixelY = current.gy * TILE_SIZE + TILE_SIZE / 2;
        const distSq = (currentPixelX - targetCx) ** 2 + (currentPixelY - targetCy) ** 2;

        if (distSq < (TILE_SIZE * 1.5) ** 2) {
            // Close enough logic:
            // 1. If we are on the correct side, allowing "close" distance is fine.
            // 2. If we are on WRONG side, we must NOT stop.

            if (current.side === targetSide) {
                // Reconstruct path
                const path: PathNode[] = [];
                let temp: PathNode | undefined = current;
                while (temp) {
                    path.unshift(temp);
                    temp = temp.parent;
                }
                return path.slice(1);
            }
        }

        const neighbors = getNeighbors(current, spatialGrid, assets);

        for (const neighbor of neighbors) {
            const nKey = `${neighbor.gx},${neighbor.gy},${neighbor.side}`;
            if (closedSet.has(nKey)) continue;

            const avoidanceCost = avoidanceMap.has(nKey) ? 50 : 0; // High cost to overlap paths
            const movementCost = neighbor.action === 'DROP' ? 20 : 1; // Dropping is risky and should be avoided if ceiling walk is possible
            const tentativeG = (current.g || 0) + movementCost + avoidanceCost;

            const existing = openSetMap.get(nKey);

            if (!existing || tentativeG < (existing.g || Infinity)) {
                neighbor.parent = current;
                neighbor.g = tentativeG;
                // Heuristic
                const nPx = neighbor.gx * TILE_SIZE + TILE_SIZE / 2;
                const nPy = neighbor.gy * TILE_SIZE + TILE_SIZE / 2;
                // Random noise to heuristic to distribute paths if costs are equal
                // Use hash of coords combined with a random factor passed in or just use implicit randomness if planPuddlePath is called frequently?
                // Actually, let's use a specialized random factor.
                const randomFactor = Math.random() * 2.0;
                const noise = ((neighbor.gx * 37 + neighbor.gy * 13) % 10) * 0.1 + randomFactor;

                // Side Penalty: If checking regular distance, being on top vs bottom is same distance.
                // Add huge penalty if side doesn't match target side, reducing as we get closer?
                // No, simply adding a constant penalty for wrong side helps distinguish states.
                const sidePenalty = (neighbor.side !== targetSide) ? 5 : 0;

                neighbor.h = (Math.abs(nPx - targetCx) + Math.abs(nPy - targetCy)) / TILE_SIZE + sidePenalty + noise;
                neighbor.f = neighbor.g + neighbor.h;

                if (!existing) {
                    openSet.push(neighbor);
                    openSetMap.set(nKey, neighbor);
                }
            }
        }
    }

    // Fallback: If no path found, go to closest node
    if (closestNode && closestNode !== startNode) {
        const path: PathNode[] = [];
        let temp: PathNode | undefined = closestNode;
        while (temp) {
            path.unshift(temp);
            temp = temp.parent;
        }
        // Only return if path has some length
        if (path.length > 1) return path.slice(1);
    }

    return null; // No path found
};

// --- Update Logic ---

export const updatePuddle = (
    puddle: PuddleState,
    target: { x: number, y: number, w: number, h: number },
    spatialGrid: SpatialGrid,
    assets: Assets,
    allPuddles: PuddleState[]
) => {
    // Timer for corner pause
    if (puddle.turnTimer && puddle.turnTimer > 0) {
        puddle.turnTimer--;
        return; // Stop movement during pause
    }

    // Animation Wait States
    if (puddle.state === 'LANDING') {
        if (puddle.landingTimer && puddle.landingTimer > 0) {
            puddle.landingTimer--;
            return; // Wait for landing animation
        } else {
            // Done landing
            puddle.state = 'WALKING';
            puddle.animationState = 'WALKING';
            // Resume pathing/movement below
        }
    }

    if (puddle.state === 'DRIPPING') {
        if (puddle.dropTimer && puddle.dropTimer > 0) {
            puddle.dropTimer--;
            return; // Wait for dripping animation
        } else {
            // Done dripping -> Fall
            puddle.state = 'FALLING';
            puddle.animationState = 'FALLING';
            puddle.rotation = 0;
            puddle.path = null;
            return; // Start falling on next frame
        }
    }

    // Timer always ticks (Active Replanning)
    puddle.timer--;

    // DEBUG LOGGING (Temporary)
    if (Math.random() < 0.01) {
        console.log(`Puddle ${puddle.id}: Pos(${puddle.x.toFixed(1)}, ${puddle.y.toFixed(1)}) Grid(${puddle.gridX}, ${puddle.gridY}) Side(${puddle.side}) isSolid(${isSolid(puddle.gridX, puddle.gridY, spatialGrid, assets)})`);
    }

    // State Machine
    if (puddle.state === 'FALLING') {
        // Fall Logic
        puddle.y += 2; // Gravity

        // ... (Falling check can use corrected gx/gy now if needed, but usually checks below)
        const fallGy = Math.floor((puddle.y + TILE_SIZE - 1) / TILE_SIZE);
        const fallGx = Math.floor((puddle.x + TILE_SIZE / 2) / TILE_SIZE); // Center X

        if (puddle.moveWaypoint) return; // Never fall if aiming for a corner waypoint

        if (isSolid(fallGx, fallGy, spatialGrid, assets) || hasLadder(fallGx, fallGy, spatialGrid, assets)) {
            // Landed
            puddle.state = 'LANDING';
            puddle.animationState = 'LANDING';
            puddle.landingTimer = 20; // 20 frames for Full Landing Animation
            puddle.y = (fallGy - 1) * TILE_SIZE; // Snap to top
            puddle.side = 'TOP';
            puddle.rotation = 0;
            puddle.gridX = fallGx;
            puddle.gridY = fallGy;
            puddle.path = null;
        } else if (puddle.y > GAME_HEIGHT) {
            // Respawn or kill (loop)
            puddle.y = -TILE_SIZE;
            puddle.state = 'FALLING';
            puddle.locationVerification = false; // Flag to ensure we don't get stuck
        }
        puddle.rotation = 0; // Always upright when falling
        return;
    }

    // 1. Plan Path if needed (Finished or Periodic Update)
    // Replan if path is done OR timer expired (re-evaluate target position)
    const pathFinished = !puddle.path || puddle.pathIndex >= puddle.path.length;

    if (pathFinished || puddle.timer <= 0) {

        // If we have a path but just need a periodic refresh, maybe ensure we don't jitter?
        // But for now, full replan is safest for tracking.

        const startNode: PathNode = { gx: puddle.gridX, gy: puddle.gridY, side: puddle.side };
        const newPath = planPuddlePath(startNode, target, spatialGrid, assets, allPuddles, puddle.id);

        if (newPath) {
            puddle.path = newPath;
            puddle.pathIndex = 0;
            // Set refresh timer (e.g. 45 frames = 0.75s)
            // This ensures we adjust to player movement while walking
            puddle.timer = 45;
        } else {
            // No path found
            puddle.timer = 30; // Wait briefly before retrying
            // If we were finished, this will cause a stop, which is correct (can't reach player).
        }
    }

    // 2. Execute Movement
    const SPEED = 0.5;

    if (puddle.path && puddle.pathIndex < puddle.path.length) {
        const targetNode = puddle.path[puddle.pathIndex];

        let tx = targetNode.gx * TILE_SIZE;
        let ty = targetNode.gy * TILE_SIZE;
        let targetRot = 0;
        let cornerType: 'CONVEX' | 'CONCAVE' | undefined = undefined;

        if (targetNode.side === 'TOP') { ty -= TILE_SIZE; targetRot = 0; }
        else if (targetNode.side === 'BOTTOM') { ty += TILE_SIZE; targetRot = 180; }
        else if (targetNode.side === 'LEFT') { tx -= TILE_SIZE; targetRot = 270; }
        else if (targetNode.side === 'RIGHT') { tx += TILE_SIZE; targetRot = 90; }
        else if (targetNode.side === 'LADDER') { targetRot = 0; }

        const action = targetNode.action;

        // SPECIAL ACTION: DROP
        if (action === 'DROP') {
            // "Not drop from corners" Rule:
            // Walk to the horizontal CENTER of the tile before letting go.
            // Puddle coordinates are Top-Left. To center a 16px sprite in a 16px tile, x must equal tileX.
            const tileAlignedX = targetNode.gx * TILE_SIZE;
            const distToAlign = Math.abs(puddle.x - tileAlignedX);

            if (distToAlign > 2) {
                // Walk towards center (Manual Movement)
                const dir = Math.sign(tileAlignedX - puddle.x);
                puddle.x += dir * SPEED;
                // Ensure we stay on the ceiling
                puddle.rotation = 180;

                // Set facing direction for the walk
                const facing = dir >= 0 ? 1 : -1;
                puddle.facingDirection = facing;
                puddle.state = 'WALKING';
                puddle.animationState = 'WALKING';

                // Consume this frame completely.
                return;
            } else {
                // We are centered. NOW we start dipping.
                puddle.x = tileAlignedX; // Snap exactly
                puddle.state = 'DRIPPING';
                puddle.animationState = 'DRIPPING';
                puddle.dropTimer = 20; // e.g. 20 frames for drip animation
                puddle.rotation = 0; // Rotate 0 so drip falls DOWN (gravity), even though on ceiling
                puddle.path = null;
                return;
            }
        }

        // Special Corner Animation Handling
        if (action === 'WRAP_CONVEX') {
            cornerType = 'CONVEX';

            // Calculate Waypoint (Corner Hugging) if not already set
            // Only strictly needed for initial setup of the move step
            if (!puddle.moveWaypoint) { // Removed `dist > SPEED` as it's calculated later
                // Determine Source Side
                const s1 = puddle.side;
                // Determine Target Side (from targetNode)
                const s2 = targetNode.side;

                // Logic: We are at (puddle.gridX, puddle.gridY). We are WRAPPING around THIS block?
                // Wait, WRAP_CONVEX means we are at (gx, gy) and moving to NEIGHBOR (nextGx, nextGy) which is EMPTY.
                // WE are ACTUALLY moving from (gx, gy) SIDE S1 to (nextGx, nextGy) SIDE S2?
                // Let's re-read getNeighbors logic.

                // neighbor.push({ gx, gy, side: newSide, action: 'WRAP_CONVEX' }); 
                // Result: We stay in SAME grid cell (gx, gy) but change SIDE.
                // e.g. TOP -> RIGHT.
                // Target coord calc:
                // tx = targetNode.gx * TILE_SIZE...
                // if targetSide == RIGHT: tx += TILE_SIZE.
                // So target position is indeed the Correct Side Position.

                // If we move linearly from TOP (x+8, y) to RIGHT (x+16, y+8), we cut through (x+16, y).
                // Waypoint should be the corner: (x+16, y).
                // Or rather:
                // TOP -> RIGHT: Corner is Top-Right. (x+16, y).
                // RIGHT -> BOTTOM: Corner is Bottom-Right. (x+16, y+16).
                // BOTTOM -> LEFT: Corner is Bottom-Left. (x, y+16).
                // LEFT -> TOP: Corner is Top-Left. (x, y).

                const tileX = puddle.gridX * TILE_SIZE;
                const tileY = puddle.gridY * TILE_SIZE;

                // Adjust Base Visual Coordinates based on current side
                // (e.g., if on TOP, our visual Y is one tile ABOVE the block's Y)
                let baseX = tileX;
                let baseY = tileY;

                if (puddle.side === 'TOP') baseY -= TILE_SIZE;
                else if (puddle.side === 'LEFT') baseX -= TILE_SIZE;
                else if (puddle.side === 'BOTTOM') baseY += TILE_SIZE;
                else if (puddle.side === 'RIGHT') baseX += TILE_SIZE;

                let wx = baseX;
                let wy = baseY;

                let validCorner = false;

                // Calculate RELATIVE offsets for the corner
                // Note: We are starting from the Visual Position of the current side.
                // TOP -> RIGHT: Start (x, y-8). Target Corner (x+8, y-8).
                // Wait, if TOP is (x, y-8). RIGHT is (x+8, y).
                // Corner is (x+8, y-8).

                // Let's rely on simple corner logic:
                // TOP-RIGHT Corner: (tileX + TILE, tileY - TILE)
                // TOP-LEFT Corner: (tileX, tileY - TILE)
                // BOTTOM-RIGHT Corner: (tileX + TILE, tileY + TILE)
                // BOTTOM-LEFT Corner: (tileX, tileY + TILE)

                // Redefine based on the INTERSECTION of the two faces.

                if (s1 === 'TOP' && s2 === 'RIGHT') { wx = tileX + TILE_SIZE; wy = tileY - TILE_SIZE; validCorner = true; }
                else if (s1 === 'RIGHT' && s2 === 'BOTTOM') { wx = tileX + TILE_SIZE; wy = tileY + TILE_SIZE; validCorner = true; }
                else if (s1 === 'BOTTOM' && s2 === 'LEFT') { wx = tileX; wy = tileY + TILE_SIZE; validCorner = true; }
                else if (s1 === 'LEFT' && s2 === 'TOP') { wx = tileX - TILE_SIZE; wy = tileY - TILE_SIZE; validCorner = true; } // Corrected X to be Left Face Plane

                // Reverse (Counter-Clockwise)
                else if (s1 === 'RIGHT' && s2 === 'TOP') { wx = tileX + TILE_SIZE; wy = tileY - TILE_SIZE; validCorner = true; }
                else if (s1 === 'BOTTOM' && s2 === 'RIGHT') { wx = tileX + TILE_SIZE; wy = tileY + TILE_SIZE; validCorner = true; }
                else if (s1 === 'LEFT' && s2 === 'BOTTOM') { wx = tileX - TILE_SIZE; wy = tileY + TILE_SIZE; validCorner = true; } // Corrected X to be Left Face Plane
                else if (s1 === 'TOP' && s2 === 'LEFT') { wx = tileX - TILE_SIZE; wy = tileY - TILE_SIZE; validCorner = true; } // Corrected X to be Left Face Plane

                if (validCorner) {
                    // Only set waypoint if we are not already there
                    const distSq = (puddle.x - wx) * (puddle.x - wx) + (puddle.y - wy) * (puddle.y - wy);
                    if (distSq > 4) { // Only if > 2 pixels away
                        puddle.moveWaypoint = { x: wx, y: wy };
                    }
                }
            }
        }
        else if (action === 'WRAP_CONCAVE') cornerType = 'CONCAVE';

        // Apply Movement
        let targetX = tx;
        let targetY = ty;

        // Re-calculate visual target position on the block's surface (Corrected logic)
        // LEFT side = Top-Left of Left Air Tile = gx * TILE - TILE.
        // RIGHT side = Top-Left of Right Air Tile = gx * TILE + TILE.
        // TOP side = Top-Left of Top Air Tile = gy * TILE - TILE.
        // BOTTOM side = Top-Left of Bottom Air Tile = gy * TILE + TILE.

        if (targetNode.side === 'LEFT') {
            targetX = targetNode.gx * TILE_SIZE - TILE_SIZE;
        } else if (targetNode.side === 'RIGHT') {
            targetX = targetNode.gx * TILE_SIZE + TILE_SIZE;
        } else if (targetNode.side === 'TOP') {
            targetY = targetNode.gy * TILE_SIZE - TILE_SIZE;
        } else if (targetNode.side === 'BOTTOM') {
            targetY = targetNode.gy * TILE_SIZE + TILE_SIZE;
        }

        // Keep tx/ty consistent for final snap
        tx = targetX;
        ty = targetY;

        // If we have a waypoint, move there first
        if (puddle.moveWaypoint) {
            targetX = puddle.moveWaypoint.x;
            targetY = puddle.moveWaypoint.y;

            // SQUARE CORNER LOGIC:
            // Force movement along the current face to alignment first.
            // If on TOP/BOTTOM, move X to corner X first, keeping Y constant.
            // If on LEFT/RIGHT, move Y to corner Y first, keeping X constant.

            const dxC = Math.abs(puddle.x - targetX);
            const dyC = Math.abs(puddle.y - targetY);

            if (puddle.side === 'TOP' || puddle.side === 'BOTTOM') {
                if (dxC > SPEED) targetY = puddle.y; // Lock Y
            } else { // LEFT / RIGHT
                if (dyC > SPEED) targetX = puddle.x; // Lock X
            }
        }

        const dx = targetX - puddle.x;
        const dy = targetY - puddle.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= SPEED) {
            // Reached Target (Either Waypoint or Final)

            if (puddle.moveWaypoint) {
                // Reached Waypoint (Corner)!
                puddle.moveWaypoint = undefined;

                // IMMEDIATE SNAP & ROTATION (Before Pause)
                // This ensures the visuals match the new side during the turning pause.

                // 1. Update Side & State
                puddle.side = targetNode.side;
                if (targetNode.side === 'LADDER') {
                    puddle.state = 'CLIMBING';
                    puddle.animationState = 'CLIMBING';
                } else {
                    puddle.state = 'WALKING';
                    puddle.animationState = 'WALKING';
                }

                // 2. Smart Snap Position & Rotation
                const tileX = targetNode.gx * TILE_SIZE;
                const tileY = targetNode.gy * TILE_SIZE;
                const centerX = tileX + TILE_SIZE / 2;
                const centerY = tileY + TILE_SIZE / 2;

                if (puddle.side === 'TOP') {
                    puddle.rotation = 0;
                    puddle.y = tileY - TILE_SIZE;
                    puddle.x = (puddle.x < centerX) ? tileX : tileX + TILE_SIZE;
                }
                else if (puddle.side === 'RIGHT') {
                    puddle.rotation = 90;
                    puddle.x = tileX + TILE_SIZE;
                    puddle.y = (puddle.y < centerY) ? tileY : tileY + TILE_SIZE;
                }
                else if (puddle.side === 'BOTTOM') {
                    puddle.rotation = 180;
                    puddle.y = tileY + TILE_SIZE;
                    puddle.x = (puddle.x < centerX) ? tileX : tileX + TILE_SIZE;
                }
                else if (puddle.side === 'LEFT') {
                    puddle.rotation = 270;
                    puddle.x = tileX - TILE_SIZE;
                    puddle.y = (puddle.y < centerY) ? tileY : tileY + TILE_SIZE;
                }
                else if (puddle.side === 'LADDER') {
                    puddle.rotation = 0;
                    puddle.x = tileX;
                    puddle.y = tileY;
                }

                // 3. Advance Path (Since we are effectively on the new segment now)
                puddle.pathIndex++;
                puddle.isTurningCorner = false;
                puddle.timer = 100;

                // 4. Start Pause
                puddle.turnTimer = 6;
                return;
            }

            // Reached Final Node
            puddle.x = tx;
            puddle.y = ty;
            puddle.gridX = targetNode.gx;
            puddle.gridY = targetNode.gy;
            puddle.side = targetNode.side;
            puddle.rotation = targetRot;
            puddle.pathIndex++;
            puddle.isTurningCorner = false; // Reset
            puddle.cornerType = undefined;
            puddle.moveWaypoint = undefined; // Safety clear

            if (targetNode.side === 'LADDER') {
                puddle.state = 'CLIMBING';
                puddle.animationState = 'CLIMBING';
            } else {
                puddle.state = 'WALKING';
                puddle.animationState = 'WALKING';
            }

            // Ensure rotation is correct for the new side immediately
            if (puddle.side === 'TOP') puddle.rotation = 0;
            else if (puddle.side === 'RIGHT') puddle.rotation = 90;
            else if (puddle.side === 'BOTTOM') puddle.rotation = 180;
            else if (puddle.side === 'LEFT') puddle.rotation = 270;
            else if (puddle.side === 'LADDER') puddle.rotation = 0;

        } else {
            // Move
            puddle.x += (dx / dist) * SPEED;
            puddle.y += (dy / dist) * SPEED;

            // Determine Facing Direction based on local movement
            // Logic differs by side.
            // visual "Right" relative to the surface.
            let movingRight = false;

            // Calculate Movement Delta Real (for this frame)
            const frameDx = (dx / dist) * SPEED;
            const frameDy = (dy / dist) * SPEED;

            // Use the CURRENT side to determine "local right"
            // If we are moving to waypoint, we are on Source Side (s1).
            // If we passed waypoint? We are still technically on Source Side until we reach target?
            // Actually, once we hit waypoint (Corner), we are "turning".
            // Let's stick to simple logic: Movement along surface tangent.

            let localDelta = 0;
            if (puddle.side === 'TOP') localDelta = frameDx;
            else if (puddle.side === 'RIGHT') localDelta = frameDy;
            else if (puddle.side === 'BOTTOM') localDelta = -frameDx;
            else if (puddle.side === 'LEFT') localDelta = -frameDy;
            else if (puddle.side === 'LADDER') localDelta = 0;

            // If wrapping convex, we might be moving perpendicular to side (towards corner).
            // e.g. TOP moving Right towards Corner. dx > 0. localDelta > 0. Facing 1. Correct.
            // When moving FROM Corner TO Right Side (Down):
            // We are technically still side=TOP until we reach the end?
            // "puddle.side" is not updated until Reached Final.
            // So we are Side TOP, moving DOWN.
            // frameDx = 0, frameDy = 1.
            // localDelta (TOP logic) = 0.
            // So we lose facing info during the second leg of the turn.

            // Fix: If localDelta is near 0, keep previous facing? 
            if (Math.abs(localDelta) > 0.01) {
                puddle.facingDirection = localDelta > 0 ? 1 : -1;
            }
            // Else keep existing.


            // Corner Sprite Logic Removed to prevent early rotation
            if (cornerType) {
                puddle.isTurningCorner = true;
                // Do NOT change rotation here. Maintain source rotation until target is reached.
            } else {
                puddle.isTurningCorner = false;
                // For normal moves (WALK/CLIMB), ensure rotation matches target (usually same as source)
                if (action === 'WALK' || action === 'CLIMB') {
                    puddle.rotation = targetRot;
                }
            }
        }

    }
    // Removed explicit Idle state to allow continuous movement
};
