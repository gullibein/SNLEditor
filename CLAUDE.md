# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a pixel platformer game maker built with React, TypeScript, and Vite. It features a built-in level editor, custom sprite editor, and real-time gameplay. The game supports custom assets, multiple levels, and world persistence through InstantDB cloud storage.

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (port 3014)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Setup

Set `GEMINI_API_KEY` in `.env.local` for AI features (required for deployment but optional for local development).

## Core Architecture

### State Management
- **Editor State**: Managed through undo/redo history system (`history` array with `historyIndex`)
- **Game State**: Canvas-based game loop with fixed timestep (60 FPS target)
- **Persistence**: LocalStorage for editor state, InstantDB for cloud saves

### Component Hierarchy
```
App.tsx
├── SplashScreen.tsx (startup/loading screen)
├── GameCanvas.tsx (main game rendering and logic)
│   ├── Player physics and FSM (IDLE, RUN, JUMP, FALL, CLIMB states)
│   ├── Enemy AI (Slime: simple patrol, Puddle: complex wall-crawling)
│   ├── Level rendering
│   └── File explorer modal (save/load worlds and spritesheets)
├── AssetEditor.tsx (right sidebar panel)
└── AssetPickerModal.tsx (sprite selection)
```

### Key Systems

#### 1. Asset System
- All game objects are 8x8 pixel sprites defined in `constants.ts`
- Assets stored as `PixelData` (2D number arrays where each number is a palette index)
- Asset types: PLAYER, PLATFORM, SPIKE, SPRING, LADDER, TELEPORTER, GEM, CHEST, KEY, DOOR, PILL, SLIME, PUDDLE
- Supports animation frames through `animations` object (e.g., WALKING, JUMPING, DYING)

#### 2. Palette System
- Master palette in `palettes.ts` with multiple themes (VGA, CGA, DOS, etc.)
- Runtime color mapping: GameCanvas receives `displayPalette` which maps master palette indices to current theme colors
- Sprites use palette indices (0-16), actual colors determined by active theme

#### 3. Physics & Collision
- Pixel-perfect subpixel movement with remainder accumulation (`remainderX`, `remainderY`)
- Player FSM with distinct states affecting physics behavior
- Ladder system with complex grab/release mechanics and centering
- Platform collision uses TILE_SIZE (8px) aligned grid

#### 4. Enemy AI
- **Slime**: Simple state machine with IDLE, ACCELERATING, MID_PAUSE, DECELERATING states
- **Puddle**: Advanced wall-crawling enemy using A* pathfinding on surface grid
  - Tracks player position and navigates along platform surfaces
  - Side tracking (TOP, BOTTOM, LEFT, RIGHT, LADDER) for orientation
  - Smooth corner wrapping with rotation interpolation
  - See `components/puddleUtils.ts` for pathfinding logic

#### 5. World File Format
- Text-based level representation using ASCII symbols (defined in `worldUtils.ts`)
- Asset mapping: `@` = player, `#` = platform, `^` = spike, etc.
- Header contains physics, theme, and metadata
- Used for cloud storage and level sharing

#### 6. InstantDB Integration
- Schema defined in `instantDb.ts`
- Three main entities: `folders`, `spritesheets`, `worlds`
- Protected folders system with password hashing
- Binary file storage for PNG spritesheets via Storage API
- Auto-loads "OGWORLD" on startup if available

## File Structure

### Core Files
- `App.tsx` - Main application state, editor/play mode switching, level management
- `types.ts` - Complete TypeScript definitions for all game objects
- `constants.ts` - All game assets, sprites, and configuration constants
- `palettes.ts` - Color themes and palette definitions

### Game Logic
- `components/GameCanvas.tsx` - Main game loop, rendering, player physics, enemy AI
- `components/puddleUtils.ts` - A* pathfinding for puddle enemy wall-crawling
- `worldUtils.ts` - World serialization/deserialization to/from text format
- `spritesheetUtils.ts` - PNG sprite packing and extraction

### UI Components
- `components/AssetEditor.tsx` - Right sidebar: sprite editor, physics tuning, level list
- `components/AssetPickerModal.tsx` - Asset selection modal
- `components/SplashScreen.tsx` - Loading screen

### Utilities
- `sounds.ts` - Web Audio API sound effects
- `font.ts` - Retro bitmap font rendering
- `dos-font.ts` - DOS-style font variant
- `instantDb.ts` - Cloud database schema and initialization

## Important Patterns

### Adding New Asset Types
1. Add type to `AssetType` union in `types.ts`
2. Add sprite data to `constants.ts` (8x8 PixelData array)
3. Add to `INITIAL_ASSETS` object in `constants.ts`
4. Add symbol mapping in `worldUtils.ts` ASSET_SYMBOLS
5. Add collision logic in GameCanvas.tsx if needed
6. Update asset category filtering in App.tsx `getAssetsForCategory`

### Physics Modifications
- Gravity, friction, speeds defined in `constants.ts`
- Per-game physics state in `physics` object (App.tsx)
- Player movement uses subpixel precision - modify `remainderX/Y` logic carefully
- Collision detection iterates pixel-by-pixel to prevent tunneling

### Enemy Behavior
- Simple enemies: use state machine in GameCanvas.tsx `updateEnemies` function
- Complex pathfinding: implement in separate utils file (see puddleUtils.ts pattern)
- Animation state updated separately from movement state

### Level Data
- Levels stored as array of `PlacedAsset` objects with pixel coordinates
- Player start position separate from level data
- Teleporters auto-pair by `teleporterPairId`
- Rotation support for directional assets (e.g., puddle spawn orientation)

## Known Quirks

- Ladder centering uses smooth transition with platform bypass logic
- Player death animation plays upside-down sprite
- Puddle pathfinding can occasionally get stuck in corners (has recovery logic)
- InstantDB queries use both `db.useQuery` (reactive) and `db.queryOnce` (one-time fetch)
- File explorer uses retro Windows 95 style rendering on canvas
- Undo/redo only works in EDIT mode

## Configuration

- Game resolution: 272x160 (34x20 tiles)
- Tile size: 8x8 pixels
- Target FPS: 60
- Dev server port: 3014
- Path alias: `@/` maps to project root
