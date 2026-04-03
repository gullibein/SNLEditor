
import type { Assets, PixelData } from './types';

export const TILE_SIZE = 8;
export const GAME_WIDTH = 128; // 16 tiles
export const GAME_HEIGHT = 128; // 16 tiles

export const GRAVITY = 0.25;
export const MAX_FALL_SPEED = 3.5;
export const PLAYER_SPEED = 1.5;
export const BAD_MAN_SPEED = 1.15;
export const BAD_MAN_JUMP_FORCE = -2.5;
export const SPRING_BOUNCE_MULTIPLIER = 1.6;
export const LADDER_CLIMB_SPEED = 1.0;
export const LADDER_HORIZONTAL_SPEED = 0.75;

// New palette inspired by the reference image (Lode Runner style)
export const INITIAL_PALETTE: string[] = [
  '#00000000', // 0: Transparent
  '#000000',   // 1: Black
  '#5DF4F4',   // 2: Cyan (Brick Face)
  '#004848',   // 3: Dark Cyan (Brick Shadow)
  '#FFFFFF',   // 4: White
  '#F45D5D',   // 5: Red
  '#F4A460',   // 6: Orange/Gold
  '#F4F45D',   // 7: Yellow
  '#5D5DF4',   // 8: Blue
  '#F45DF4',   // 9: Magenta
  '#5DF45D',   // 10: Green
  '#A0A0A0',   // 11: Light Gray
  '#505050',   // 12: Dark Gray
  '#333c57',   // 13: Dark Gray-Blue
  '#800000',   // 14: Maroon
  '#008000',   // 15: Dark Green
  '#000080',   // 16: Navy Blue
];

// New, more detailed player character sprite
const playerSprite: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 10, 10, 10, 10, 10, 10, 0],
  [0, 0, 14, 0, 0, 14, 0, 0],
  [0, 0, 14, 0, 0, 14, 0, 0]
];

const playerSpriteWalk1: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 10, 10, 10, 10, 10, 10, 0],
  [0, 0, 14, 0, 0, 14, 0, 0],
  [0, 14, 0, 0, 0, 0, 14, 0]
];

const playerSpriteWalk2: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 10, 10, 10, 10, 10, 10, 0],
  [0, 0, 0, 14, 14, 0, 0, 0],
  [0, 0, 14, 0, 0, 14, 0, 0]
];

const playerSpriteJump: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 10, 10, 10, 10, 10, 10, 0],
  [0, 14, 0, 0, 0, 0, 14, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
];

const playerSpriteClimb1: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 10, 10, 10, 10, 10, 0, 0],
  [0, 0, 10, 10, 10, 10, 10, 0],
  [0, 14, 0, 0, 0, 0, 14, 0],
  [0, 0, 14, 0, 0, 0, 0, 0]
];

const playerSpriteClimb2: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 10, 0],
  [0, 10, 10, 10, 10, 10, 0, 0],
  [0, 14, 0, 0, 0, 0, 14, 0],
  [0, 0, 0, 0, 0, 0, 14, 0]
];

const playerSpritePush1: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 10, 0],
  [0, 10, 10, 10, 10, 10, 0, 0],
  [0, 0, 14, 14, 0, 0, 0, 0],
  [0, 0, 0, 14, 14, 0, 0, 0]
];

const playerSpritePush2: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 10, 10],
  [0, 10, 10, 10, 10, 10, 0, 0],
  [0, 0, 14, 14, 0, 0, 0, 0],
  [0, 0, 0, 14, 14, 0, 0, 0]
];

const playerSpritePush3: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 10, 10],
  [0, 10, 10, 10, 10, 10, 0, 0],
  [0, 0, 0, 14, 14, 0, 0, 0],
  [0, 0, 14, 0, 0, 14, 0, 0]
];

const playerSpriteKick1: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 10, 10, 10, 10, 10, 10, 0],
  [0, 14, 0, 0, 0, 0, 14, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
]; // Copy of jump sprite - first frame

const playerSpriteKick2: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 1, 4, 4, 1, 6, 0],
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 10, 10, 10, 10, 10, 10, 0],
  [0, 14, 0, 0, 0, 0, 14, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
]; // Copy of jump sprite - second frame

const platformSprite: PixelData = [
  [3, 3, 3, 3, 3, 3, 3, 3],
  [2, 2, 2, 2, 2, 2, 2, 3],
  [2, 2, 2, 2, 2, 2, 2, 3],
  [3, 3, 3, 3, 3, 3, 3, 3],
  [2, 2, 2, 2, 2, 2, 2, 3],
  [2, 2, 2, 2, 2, 2, 2, 3],
  [3, 3, 3, 3, 3, 3, 3, 3],
  [2, 2, 2, 2, 2, 2, 2, 3]
];

const platformSprite2: PixelData = [
  [13, 13, 13, 13, 13, 13, 13, 13],
  [12, 12, 12, 12, 12, 12, 12, 13],
  [12, 12, 12, 12, 12, 12, 12, 13],
  [13, 13, 13, 13, 13, 13, 13, 13],
  [12, 12, 12, 12, 12, 12, 12, 13],
  [12, 12, 12, 12, 12, 12, 12, 13],
  [13, 13, 13, 13, 13, 13, 13, 13],
  [12, 12, 12, 12, 12, 12, 12, 13]
];

const platformSprite3: PixelData = [
  [14, 14, 14, 14, 14, 14, 14, 14],
  [5, 5, 5, 5, 5, 5, 5, 14],
  [5, 5, 5, 5, 5, 5, 5, 14],
  [14, 14, 14, 14, 14, 14, 14, 14],
  [5, 5, 5, 5, 5, 5, 5, 14],
  [5, 5, 5, 5, 5, 5, 5, 14],
  [14, 14, 14, 14, 14, 14, 14, 14],
  [5, 5, 5, 5, 5, 5, 5, 14]
];

const spikeSprite: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 4, 0, 0, 0, 0, 4, 0],
  [0, 4, 4, 0, 0, 4, 4, 0],
  [0, 4, 4, 4, 4, 4, 4, 0],
  [4, 4, 4, 4, 4, 4, 4, 4]
];

const springSprite: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 4, 4, 4, 4, 4, 4, 8],
  [8, 4, 8, 8, 8, 8, 4, 8],
  [8, 4, 8, 8, 8, 8, 4, 8],
  [8, 4, 4, 4, 4, 4, 4, 8]
];

const ladderSprite: PixelData = [
  [4, 0, 0, 0, 0, 0, 0, 4],
  [4, 4, 4, 4, 4, 4, 4, 4],
  [4, 0, 0, 0, 0, 0, 0, 4],
  [4, 0, 0, 0, 0, 0, 0, 4],
  [4, 4, 4, 4, 4, 4, 4, 4],
  [4, 0, 0, 0, 0, 0, 0, 4],
  [4, 0, 0, 0, 0, 0, 0, 4],
  [4, 4, 4, 4, 4, 4, 4, 4]
];

const levelLadderSprite: PixelData = [
  [5, 0, 0, 0, 0, 0, 0, 5],
  [5, 5, 5, 5, 5, 5, 5, 5],
  [5, 0, 0, 0, 0, 0, 0, 5],
  [5, 0, 0, 0, 0, 0, 0, 5],
  [5, 5, 5, 5, 5, 5, 5, 5],
  [5, 0, 0, 0, 0, 0, 0, 5],
  [5, 0, 0, 0, 0, 0, 0, 5],
  [5, 5, 5, 5, 5, 5, 5, 5]
];


const teleporterSprite: PixelData = [
  [0, 9, 9, 9, 9, 9, 9, 0],
  [9, 0, 0, 8, 8, 0, 0, 9],
  [9, 0, 8, 8, 8, 8, 0, 9],
  [9, 8, 8, 4, 4, 8, 8, 9],
  [9, 8, 8, 4, 4, 8, 8, 9],
  [9, 0, 8, 8, 8, 8, 0, 9],
  [9, 0, 0, 8, 8, 0, 0, 9],
  [0, 9, 9, 9, 9, 9, 9, 0]
];

const gemSprite: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 6, 6, 4, 4, 6, 6, 0],
  [0, 6, 6, 4, 4, 6, 6, 0],
  [0, 0, 6, 6, 6, 6, 0, 0],
  [0, 0, 0, 6, 6, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
];

const chestSprite: PixelData = [
  [0, 0, 7, 7, 7, 7, 0, 0],
  [0, 7, 7, 1, 1, 7, 7, 0],
  [7, 6, 7, 7, 7, 7, 6, 7],
  [7, 6, 6, 6, 6, 6, 6, 7],
  [7, 6, 6, 6, 6, 6, 6, 7],
  [7, 6, 6, 6, 6, 6, 6, 7],
  [0, 7, 7, 7, 7, 7, 7, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
];

const keySprite: PixelData = [
  [0, 0, 7, 7, 0, 0, 0, 0],
  [0, 7, 7, 7, 7, 0, 0, 0],
  [0, 0, 7, 7, 0, 0, 0, 0],
  [0, 0, 7, 0, 0, 0, 0, 0],
  [0, 0, 7, 7, 7, 0, 0, 0],
  [0, 0, 7, 0, 7, 0, 0, 0],
  [0, 0, 7, 7, 7, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
];

const doorSprite: PixelData = [
  [12, 11, 12, 11, 12, 11, 12, 11],
  [11, 12, 11, 12, 11, 12, 11, 12],
  [12, 11, 12, 11, 12, 11, 12, 11],
  [11, 12, 11, 12, 11, 12, 11, 12],
  [12, 11, 12, 11, 12, 11, 12, 11],
  [11, 12, 11, 7, 7, 11, 12, 11],
  [12, 11, 12, 1, 1, 12, 11, 12],
  [11, 12, 11, 1, 1, 11, 12, 11]
];

const pillSprite: PixelData = [
  [0, 0, 0, 5, 5, 0, 0, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 5, 5, 4, 4, 5, 5, 0],
  [5, 5, 4, 4, 4, 4, 5, 5],
  [5, 5, 4, 4, 4, 4, 5, 5],
  [0, 5, 5, 4, 4, 5, 5, 0],
  [0, 0, 5, 5, 5, 5, 0, 0],
  [0, 0, 0, 5, 5, 0, 0, 0]
];

const slimeSprite: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 10, 10, 10, 10, 0, 0],
  [0, 10, 10, 15, 15, 10, 10, 0],
  [10, 10, 15, 15, 15, 15, 10, 10],
  [10, 15, 15, 15, 15, 15, 15, 10],
  [10, 10, 15, 15, 15, 15, 10, 10],
  [0, 10, 10, 4, 4, 10, 10, 0],
  [0, 0, 10, 10, 10, 10, 0, 0]
];

const slimeSprite2: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 10, 10, 10, 10, 10, 10, 0],
  [10, 10, 15, 15, 15, 15, 10, 10],
  [10, 10, 15, 15, 15, 15, 10, 10],
  [10, 15, 15, 15, 15, 15, 15, 10],
  [10, 10, 15, 15, 15, 15, 10, 10],
  [0, 10, 10, 4, 4, 10, 10, 0],
  [0, 0, 10, 10, 10, 10, 0, 0]
];

const puddleSprite: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 8, 8, 0, 0, 8, 8, 0],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8]
];

const puddleSprite2: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 8, 8, 0, 0, 8, 0],
  [8, 0, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8]
];

const puddleSpriteDrip: PixelData = [
  [0, 0, 8, 8, 0, 0, 0, 0],
  [0, 8, 8, 8, 8, 0, 0, 0],
  [0, 8, 8, 8, 8, 0, 0, 0],
  [0, 0, 8, 8, 0, 0, 0, 0],
  [0, 0, 8, 8, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
];

const puddleSpriteClimb: PixelData = [
  [0, 0, 8, 8, 8, 8, 0, 0],
  [0, 8, 8, 8, 8, 8, 8, 0],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [0, 8, 8, 8, 8, 8, 8, 0],
  [0, 0, 8, 8, 8, 8, 0, 0]
];

const puddleSpriteSplash: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [8, 0, 0, 0, 0, 0, 0, 8],
  [8, 8, 0, 0, 0, 0, 8, 8],
  [8, 8, 8, 0, 0, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8]
];

const puddleSpriteCornerConvex: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 8],
  [0, 0, 0, 0, 0, 0, 8, 8],
  [0, 0, 0, 0, 0, 8, 8, 8],
  [0, 0, 0, 0, 8, 8, 8, 8],
  [0, 0, 0, 8, 8, 8, 8, 8],
  [0, 0, 8, 8, 8, 8, 8, 8],
  [0, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8]
];

const puddleSpriteCornerConcave: PixelData = [
  [8, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 0],
  [8, 8, 8, 8, 8, 8, 0, 0],
  [8, 8, 8, 8, 8, 0, 0, 0],
  [8, 8, 8, 8, 0, 0, 0, 0],
  [8, 8, 8, 0, 0, 0, 0, 0],
  [8, 8, 0, 0, 0, 0, 0, 0],
  [8, 0, 0, 0, 0, 0, 0, 0]
];



export const FOLDER_ICON: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0], // Tab top
  [0, 1, 4, 4, 4, 4, 1, 0], // Tab sides / body top
  [1, 4, 4, 4, 4, 4, 4, 1], // Body
  [1, 4, 4, 4, 4, 4, 4, 1],
  [1, 4, 4, 4, 4, 4, 4, 1],
  [1, 4, 4, 4, 4, 4, 4, 1],
  [0, 1, 1, 1, 1, 1, 1, 0]  // Bottom border
];

export const FILE_ICON: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 4, 4, 1, 1, 0],
  [0, 0, 1, 4, 4, 4, 1, 0],
  [0, 0, 1, 4, 4, 4, 1, 0],
  [0, 0, 1, 4, 4, 4, 1, 0],
  [0, 0, 1, 4, 4, 4, 1, 0],
  [0, 0, 1, 1, 1, 1, 1, 0]
];

export const WORLD_ICON: PixelData = [
  [0, 0, 1, 8, 8, 1, 0, 0],
  [0, 8, 8, 8, 8, 8, 8, 0],
  [1, 8, 8, 10, 10, 8, 8, 1],
  [1, 8, 8, 10, 8, 8, 8, 1],
  [1, 8, 8, 8, 8, 10, 8, 1],
  [0, 8, 8, 10, 10, 8, 8, 0],
  [0, 8, 8, 8, 8, 8, 8, 0],
  [0, 0, 1, 8, 8, 1, 0, 0]
];

const badManFlattened: PixelData = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 13, 13, 6, 6, 13, 13, 0],
  [0, 0, 16, 16, 16, 16, 0, 0],
  [0, 16, 16, 6, 6, 16, 16, 0],
  [0, 16, 16, 16, 16, 16, 16, 0]
];

const badManWaking: PixelData = [
  [0, 2, 0, 0, 0, 0, 2, 0], // Drops
  [2, 0, 0, 0, 0, 0, 0, 2], // Drops
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 13, 13, 6, 6, 13, 13, 0],
  [0, 0, 16, 16, 16, 16, 0, 0],
  [0, 16, 16, 6, 6, 16, 16, 0],
  [0, 16, 16, 16, 16, 16, 16, 0]
];

const crateSprite: PixelData = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 12, 12, 12, 12, 12, 12, 1],
  [1, 12, 12, 12, 12, 12, 12, 1],
  [1, 12, 12, 12, 12, 12, 12, 1],
  [1, 12, 12, 12, 12, 12, 12, 1],
  [1, 12, 12, 12, 12, 12, 12, 1],
  [1, 12, 12, 12, 12, 12, 12, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
];

const badManSprite: PixelData = [
  [0, 0, 0, 13, 13, 0, 0, 0], // Helmet Top
  [0, 0, 13, 13, 13, 13, 0, 0], // Helmet
  [0, 13, 13, 6, 6, 13, 13, 0], // Helmet Rim
  [0, 0, 16, 16, 16, 16, 0, 0], // Navy Uniform
  [0, 16, 16, 6, 6, 16, 16, 0], // Gold Badge/Buttons
  [0, 16, 16, 16, 16, 16, 16, 0],
  [0, 0, 15, 0, 0, 15, 0, 0], // Dark Green Pants
  [0, 0, 15, 0, 0, 15, 0, 0]
];

const badManWalk1: PixelData = [
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 13, 13, 6, 6, 13, 13, 0],
  [0, 0, 16, 16, 16, 16, 0, 0],
  [0, 16, 16, 6, 6, 16, 16, 0],
  [0, 16, 16, 16, 16, 16, 16, 0],
  [0, 0, 15, 0, 0, 15, 0, 0],
  [0, 15, 0, 0, 0, 0, 15, 0]
];

const badManWalk2: PixelData = [
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 13, 13, 6, 6, 13, 13, 0],
  [0, 0, 16, 16, 16, 16, 0, 0],
  [0, 16, 16, 6, 6, 16, 16, 0],
  [0, 16, 16, 16, 16, 16, 16, 0],
  [0, 0, 0, 15, 15, 0, 0, 0],
  [0, 0, 15, 0, 0, 15, 0, 0]
];

const badManJump: PixelData = [
  [0, 0, 0, 13, 13, 0, 0, 0],
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 13, 13, 6, 6, 13, 13, 0],
  [0, 0, 16, 16, 16, 16, 0, 0],
  [0, 16, 16, 6, 6, 16, 16, 0],
  [0, 16, 16, 16, 16, 16, 16, 0],
  [0, 15, 0, 0, 0, 0, 15, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
];

const badManLook: PixelData = [
  [0, 0, 0, 0, 13, 13, 0, 0], // Head shifted left
  [0, 0, 0, 13, 13, 13, 13, 0],
  [0, 0, 13, 13, 6, 6, 13, 0],
  [0, 0, 16, 16, 16, 16, 0, 0], // Body same
  [0, 16, 16, 6, 6, 16, 16, 0],
  [0, 16, 16, 16, 16, 16, 16, 0],
  [0, 0, 15, 0, 0, 15, 0, 0],
  [0, 0, 15, 0, 0, 15, 0, 0]
];

const badManSurprised: PixelData = [
  [2, 0, 0, 13, 13, 0, 0, 2], // Drops
  [0, 0, 13, 13, 13, 13, 0, 0],
  [0, 13, 13, 6, 6, 13, 13, 0],
  [15, 0, 16, 16, 16, 16, 0, 15], // Hands up (Dark green gloves?)
  [0, 16, 16, 6, 6, 16, 16, 0],
  [0, 16, 16, 16, 16, 16, 16, 0],
  [0, 0, 15, 0, 0, 15, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0] // Jump pose (pixels up)
];

export const INITIAL_ASSETS: Assets = {
  player: {
    id: 'player',
    name: 'Player',
    data: playerSprite,
    type: 'PLAYER',
    animationFps: 10,
    animations: {
      'IDLE': [playerSprite],
      'WALKING': [playerSpriteWalk1, playerSpriteWalk2],
      'JUMPING': [playerSpriteJump],
      'KICKING': [playerSpriteKick1, playerSpriteKick2],
      'CLIMBING': [playerSpriteClimb1, playerSpriteClimb2],
      'PUSHING': [playerSpritePush1, playerSpritePush2, playerSpritePush3]
    }
  },
  platform: { id: 'platform', name: 'Bricks', data: platformSprite, type: 'PLATFORM' },
  spike: { id: 'spike', name: 'Spike', data: spikeSprite, type: 'SPIKE' },
  spring: { id: 'spring', name: 'Spring', data: springSprite, type: 'SPRING' },
  ladder: { id: 'ladder', name: 'Ladder', data: ladderSprite, type: 'LADDER' },
  teleporter: { id: 'teleporter', name: 'Portal', data: teleporterSprite, type: 'TELEPORTER' },
  gem: { id: 'gem', name: 'Gem', data: gemSprite, type: 'GEM' },
  chest: { id: 'chest', name: 'Chest', data: chestSprite, type: 'CHEST' },
  key: { id: 'key', name: 'Key', data: keySprite, type: 'KEY' },
  door: { id: 'door', name: 'Door', data: doorSprite, type: 'DOOR' },
  pill: { id: 'pill', name: 'Pill', data: pillSprite, type: 'PILL' },
  slime: { id: 'slime', name: 'Slime', data: slimeSprite, type: 'SLIME', animationFps: 5, animations: { 'WALKING': [slimeSprite, slimeSprite2] } }, // Position-based animation
  puddle: {
    id: 'puddle',
    name: 'Puddle',
    data: puddleSprite,
    type: 'PUDDLE',
    animationFps: 5,
    animations: {
      'WALKING': [puddleSprite, puddleSprite2],
      'DRIPPING': [puddleSpriteDrip],
      'FALLING': [puddleSpriteDrip],
      'CLIMBING': [puddleSpriteClimb],
      'LANDING': [puddleSpriteSplash],
      'CORNER_CONVEX': [puddleSpriteCornerConvex],
      'CORNER_CONCAVE': [puddleSpriteCornerConcave]
    }
  },
  level_ladder: { id: 'level_ladder', name: 'Level Ladder', data: levelLadderSprite, type: 'LEVEL_LADDER' },
  crate: { id: 'crate', name: 'Crate', data: crateSprite, type: 'CRATE' },
  bad_man_v2: {
    id: 'bad_man_v2',
    name: 'Bad Man',
    data: badManSprite,
    type: 'BAD_MAN',
    animationFps: 10,
    animations: {
      'IDLE': [badManSprite],
      'WALKING': [badManWalk1, badManWalk2],
      'JUMPING': [badManJump],
      'FLATTENED': [badManFlattened],
      'WAKING': [badManWaking],
      'LOOKING': [badManLook],
      'SURPRISED': [badManSurprised]
    }
  }
};
