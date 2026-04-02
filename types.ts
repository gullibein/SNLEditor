

export type PixelData = number[][];

export type AssetType = 'PLAYER' | 'PLATFORM' | 'SPIKE' | 'SPRING' | 'LADDER' | 'TELEPORTER' | 'GEM' | 'CHEST' | 'KEY' | 'DOOR' | 'PILL' | 'SLIME' | 'PUDDLE' | 'LEVEL_LADDER' | 'BAD_MAN' | 'CRATE';

export type PlayerAnimationState = 'IDLE' | 'WALKING' | 'JUMPING' | 'CLIMBING' | 'DYING' | 'PUSHING';
export type EnemyAnimationState = 'IDLE' | 'WALKING';

export interface Asset {
  id: string;
  name: string;
  data: PixelData;
  type: AssetType;
  animationFps?: number;
  animations?: {
    [key: string]: PixelData[];
  }
}

export type Assets = {
  [key: string]: Asset;
};

export type GameMode = 'EDIT' | 'PLAY';

export interface PhysicsState {
  playerSpeed: number;
  jumpForce: number;
  friction: number;
  canJump: boolean;
  gravity: number;
  gameSpeed: number;
}

export interface PlacedAsset {
  id: string;
  assetId: string;
  x: number;
  y: number;
  teleporterPairId?: number;
  rotation?: number; // For rotatable assets like PUDDLE (0=top, 90=right, 180=bottom, 270=left)
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  // FSM State
  state: 'IDLE' | 'RUN' | 'JUMP' | 'FALL' | 'CLIMB';
  // Subpixel accumulators
  remainderX: number;
  remainderY: number;

  // Legacy flags (kept for compatibility during refactor, will strictly map to state)
  onGround: boolean;
  isClimbing: boolean;

  currentLadderId: string | null;
  targetX: number | null;
  targetY: number | null;

  teleportCooldown: number;
  jumpCooldown: number;
  ladderSwitchCooldown: number;
  ladderGrabCooldown: number;
  ladderSidewaysCooldown: number;
  collisionDisabledCooldown: number;
  isSwitchingLadders: boolean;
  isDetaching: boolean;
  isDismounting: boolean;
  justDismountedCooldown: number;
  switchVerticalDirection: number;
  width: number;
  height: number;
  dying: number;
  isDead: boolean;
  isInvincible: boolean;
  hasWon: boolean;
  wasTouchingHazard: boolean;
  hasKey: boolean;
  isSpikeImmune: boolean;
  spikeImmuneCooldown: number;
  lastTeleporterId: string | null;
  animationState: PlayerAnimationState;
  animationFrame: number;
  facingDirection: -1 | 1;
  coyoteTime: number;
  jumpBuffer: number;
  ladderExitTimer: number;
  ladderExitDirection: -1 | 1 | 0;
  transitionStartX: number;
  transitionTargetX: number | null; // Target X for ladder centering (locked when entering ladder)
  transitionBypassPlatformY: number | null; // Y position of platform to bypass during ladder grab
  fallStartY: number; // Y position when fall started (for landing sound)
}

export type EnemyMoveState = 'IDLE' | 'ACCELERATING' | 'MID_PAUSE' | 'DECELERATING';

export interface EnemyState {
  id: string;
  assetId: string;
  x: number;
  y: number;
  direction: -1 | 1;
  moveState: EnemyMoveState;
  moveProgress: number;
  moveOriginX: number;
  targetX: number;
  cooldown: number;
  animationState: EnemyAnimationState;
  animationFrame: number;
  pushingCrateId?: string | null;
  cycleStartX?: number;
}

export type PuddleSide = 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'LADDER';

export interface PuddlePathNode {
  gx: number;
  gy: number;
  side: PuddleSide;
  action?: 'WALK' | 'CLIMB' | 'DROP' | 'WRAP_CONVEX' | 'WRAP_CONCAVE' | 'LAND';
  parent?: any; // A* parent, recursive type difficult in simple interfaces?
  g?: number;
  h?: number;
  f?: number;
}

export interface PuddleState {
  id: string;
  assetId: string;
  x: number;
  y: number;
  z?: number;
  side: PuddleSide;
  state: 'WALKING' | 'FALLING' | 'CLIMBING' | 'DRIPPING' | 'LANDING';
  animationState?: string;
  animationFrame: number;
  facingDirection: 1 | -1;
  rotation: number;

  // Logic State
  path: PuddlePathNode[] | null;
  pathIndex: number;
  timer: number;
  gridX: number;
  gridY: number;

  // Visual Interpolation
  targetX?: number;
  targetY?: number;
  targetRotation?: number;

  // Corner Logic
  isTurningCorner?: boolean;
  cornerType?: 'CONVEX' | 'CONCAVE';

  // Error Recovery
  locationVerification?: boolean;

  // Movement Interim
  moveWaypoint?: { x: number, y: number };

  // Legacy/Unused
  turnTimer?: number;
  dropTimer?: number;
  landingTimer?: number;
  stepsToNextPlan?: number;
  facing?: 1 | -1; // Deprecated
}

export type BadManMode = 'SEARCH' | 'FOLLOW' | 'PREPARE_JUMP' | 'RUN_JUMP' | 'EXAMINE_SPIKES' | 'DEAD';

export interface BadManState {
  id: string; // matches PlacedAsset ID
  assetId: string;
  x: number; // Pixel collision
  y: number;
  vx: number;
  vy: number;
  facingDirection: 1 | -1;
  animationState: 'IDLE' | 'WALKING' | 'JUMPING' | 'FLATTENED' | 'CLIMBING' | 'LOOKING' | 'SURPRISED' | 'WAKING';
  animationFrame: number;
  path: any[] | null; // Changed from BadManPathNode[] to any[] as BadManPathNode is not defined
  pathIndex: number;
  onGround: boolean;
  timer: number;   // General path re-plan timer
  turnTimer?: number; // Delay before turning
  examineTimer?: number; // Time to look at spikes
  stunTimer: number; // For flat/stun
  width: number;
  height: number;
  isVisible?: boolean; // For blinking/hiding

  // AI State
  mode: BadManMode;
  searchSectionIndex: number;
  searchSections: number[]; // X-coordinates of section centers
  searchTimer: number; // For looking around
  detectionTimer?: number; // Delay for verifying LoS
  surprisedTimer: number; // For reaction delay

  // Respawn
  spawnX?: number;
  spawnY?: number;
  respawnTimer?: number;

  // Spike Jump Data
  spikeJumpData?: {
    targetX: number; // Where to jump TO
    runStartX: number; // Where to start running FROM
    spikeEdgeX?: number; // Approximate edge of the pit
    originalDirection: 1 | -1;
    hasJumped?: boolean;
    pauseTimer?: number;
  };
  slideTimer?: number;
  slideDirection?: 1 | -1;
  prepareTimeout?: number;
  lastTeleporterId?: string | null;
  teleporterCooldown?: number;
  teleporterHistoryLength?: number;
  teleportQueue?: {
    entryId: string;
    entryX: number;
    entryY: number;
    exitX: number;
    exitY: number;
  }[];
}


export interface CrateState {
  id: string;
  assetId: string;
  x: number;
  y: number;
  vy: number;
  remainderY: number;
  onGround: boolean;
  lastTeleporterId: string | null;
  pushCooldown: number;
  tipState: 'NONE' | 'TIPPING';
  tipAngle: number;
  tipPivotX: number;
  tipPivotY: number;
  tipDirection: -1 | 1;
}

export interface ColorTheme {
  name: string;
  palette: string[];
  screenEffect?: string;
  textColorIndex?: number;
}

export interface Level {
  id: string;
  name: string;
  introText?: string;
  levelData: PlacedAsset[];
  playerStartPos: { x: number, y: number };
}

export interface EditorState {
  levels: Level[];
  currentLevelIndex: number;
  assets: Assets;
  palette: string[];
  theme: string;
}

export interface GameSave {
  id: string;
  name: string;
  assets: Assets;
  levels: Level[];
  physics: PhysicsState;
  createdAt: number;
}

export type SavedGames = {
  [id: string]: GameSave;
};

export interface FileSystemNode {
  id: string;
  name: string;
  type: 'FOLDER' | 'FILE';
  children: FileSystemNode[]; // Only for folders
  parentId?: string;
}

export type FileExplorerMode = 'SAVE_WORLD' | 'LOAD_WORLD' | null;

export interface WorldData {
  levels: Level[];
  assets: Assets;
  physics: PhysicsState;
  theme: string;
  palette: string[];
}