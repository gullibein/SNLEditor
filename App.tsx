

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import GameCanvas from './components/GameCanvas';
import AssetEditor from './components/AssetEditor';
import SplashScreen from './components/SplashScreen';
import { INITIAL_ASSETS, PLAYER_SPEED, TILE_SIZE, GAME_WIDTH, GAME_HEIGHT } from './constants';
import { INITIAL_PALETTE } from './constants';
import { THEMES } from './palettes';
import type { GameMode, Assets, PixelData, PhysicsState, PlacedAsset, EditorState, AssetType, Asset, Level, GameSave } from './types';
import save10JsonRaw from './save10.json';
const save10 = save10JsonRaw as unknown as { assets: Assets; levels: Level[] };

const generateInitialLevel = (): Level => {
  const levelData: PlacedAsset[] = [];
  const levelWidthInTiles = 34;
  const levelHeightInTiles = 20;

  const addAsset = (assetId: string, x: number, y: number, extra: Partial<PlacedAsset> = {}) => {
    const tileX = x * TILE_SIZE;
    const tileY = y * TILE_SIZE;
    const id = extra.id || `${assetId}-${tileX}-${tileY}-${Math.random()}`;
    levelData.push({ id, assetId, x: tileX, y: tileY, ...extra });
  };

  for (let i = 0; i < levelWidthInTiles; i++) {
    addAsset('platform', i, levelHeightInTiles - 1);
  }
  for (let i = 1; i < levelHeightInTiles - 1; i++) {
    addAsset('platform', 0, i);
    addAsset('platform', levelWidthInTiles - 1, i);
  }

  for (let i = 0; i < 28; i++) addAsset('platform', i, 18);
  for (let i = 6; i < levelWidthInTiles; i++) if (i !== 8) addAsset('platform', i, 14);
  for (let i = 0; i < 22; i++) if (i !== 4 && i !== 18) addAsset('platform', i, 10);
  for (let i = 12; i < levelWidthInTiles; i++) if (i !== 26) addAsset('platform', i, 6);
  for (let i = 0; i < 15; i++) if (i !== 14) addAsset('platform', i, 2);

  for (let i = 14; i < 18; i++) addAsset('ladder', 8, i);
  for (let i = 10; i < 14; i++) addAsset('ladder', 18, i);
  for (let i = 10; i < 14; i++) addAsset('ladder', 4, i);
  for (let i = 2; i < 6; i++) addAsset('ladder', 14, i);
  for (let i = 6; i < 14; i++) addAsset('ladder', 26, i);

  addAsset('gem', 15, 13); addAsset('gem', 30, 13);
  addAsset('gem', 20, 9); addAsset('gem', 2, 9); addAsset('gem', 16, 5); addAsset('gem', 24, 5);

  addAsset('spike', 20, 17); addAsset('spike', 21, 17); addAsset('spike', 22, 17);

  addAsset('pill', 2, 1);
  addAsset('chest', 32, 17);
  addAsset('slime', 10, 13);
  addAsset('puddle', 20, 5); // Add a puddle to initial level

  const playerStartPos = { x: 2 * TILE_SIZE, y: 17 * TILE_SIZE };

  return { id: `level-${Date.now()}`, name: 'Level 1', levelData, playerStartPos };
};

const createEmptyLevel = (name: string): Level => {
  const levelData: PlacedAsset[] = [];
  const levelWidthInTiles = GAME_WIDTH / TILE_SIZE;
  const levelHeightInTiles = GAME_HEIGHT / TILE_SIZE;

  const addAsset = (assetId: string, x: number, y: number) => {
    const tileX = x * TILE_SIZE;
    const tileY = y * TILE_SIZE;
    levelData.push({ id: `${assetId}-${tileX}-${tileY}-${Math.random()}`, assetId, x: tileX, y: tileY });
  };

  for (let i = 0; i < levelWidthInTiles; i++) {
    addAsset('platform', i, levelHeightInTiles - 1); // Floor
  }
  for (let i = 1; i < levelHeightInTiles - 1; i++) {
    addAsset('platform', 0, i); // Left Wall
    addAsset('platform', levelWidthInTiles - 1, i); // Right Wall
  }

  return {
    id: `level-${Date.now()}`,
    name: name,
    levelData: levelData,
    playerStartPos: { x: 2 * TILE_SIZE, y: (levelHeightInTiles - 2) * TILE_SIZE }
  };
};

const initialLevel = generateInitialLevel();

const initialEditorState: EditorState = {
  levels: save10.levels,
  currentLevelIndex: 0,
  assets: { ...INITIAL_ASSETS, ...save10.assets },
  palette: THEMES['vga'].palette,
  theme: 'vga',
};

type AssetCategory = 'PLAYER_AND_ENEMIES' | 'PLATFORMS' | 'ASSETS';

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  if (hex.length === 9 && hex.startsWith('#')) hex = '#' + hex.substring(1, 7);
  if (hex.length === 9 && hex.endsWith('00')) return { r: 0, g: 0, b: 0 };
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
};

const colorDistance = (rgb1: { r: number; g: number; b: number }, rgb2: { r: number; g: number; b: number }) => {
  return Math.pow(rgb1.r - rgb2.r, 2) + Math.pow(rgb1.g - rgb2.g, 2) + Math.pow(rgb1.b - rgb2.b, 2);
};

const App: React.FC = () => {
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('EDIT');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('platform');
  const [physics, setPhysics] = useState<PhysicsState>({
    playerSpeed: PLAYER_SPEED,
    jumpForce: -2.0,
    friction: 0.35,
    canJump: true,
    gravity: 0.25,
    gameSpeed: 0.75,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const [openCategory, setOpenCategory] = useState<AssetCategory | null>('PLAYER_AND_ENEMIES');

  const [history, setHistory] = useState<EditorState[]>([initialEditorState]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const currentEditorState = history[historyIndex];

  const commitChanges = useCallback((newState: Partial<EditorState>) => {
    const nextState = { ...currentEditorState, ...newState };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(nextState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex, currentEditorState]);

  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (gameMode === 'EDIT') setHistoryIndex(prev => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', handleUndo);
    return () => window.removeEventListener('keydown', handleUndo);
  }, [gameMode]);

  useEffect(() => { setGameMode(isEditorOpen ? 'EDIT' : 'PLAY'); }, [isEditorOpen]);

  const handleThemeChange = useCallback((themeName: string) => {
    const newPalette = THEMES[themeName]?.palette;
    if (newPalette) commitChanges({ palette: newPalette, theme: themeName });
  }, [commitChanges]);

  const displayPalette = useMemo(() => {
    const { palette } = currentEditorState;
    const masterPalette = THEMES['pixel-pro'].palette;
    const currentRgbPalette = palette.map(hexToRgb);
    const masterRgbPalette = masterPalette.map(hexToRgb);

    return masterRgbPalette.map((masterRgb, masterIndex) => {
      if (masterIndex === 0 || !masterRgb) return '#00000000';
      let bestMatchColor = palette[1] || '#000000';
      let minDistance = Infinity;
      currentRgbPalette.forEach((currentRgb, currentIndex) => {
        if (currentIndex === 0 || !currentRgb) return;
        const distance = colorDistance(masterRgb, currentRgb);
        if (distance < minDistance) {
          minDistance = distance;
          bestMatchColor = palette[currentIndex];
        }
      });
      return bestMatchColor;
    });
  }, [currentEditorState.palette]);

  const getAssetsForCategory = useCallback((category: AssetCategory | null): string[] => {
    if (!category) return [];
    const { assets } = currentEditorState;
    // FIX: Cast Object.values(assets) to Asset[] to resolve type errors caused by untyped data from localStorage.
    const assetList = Object.values(assets) as Asset[];
    switch (category) {
      case 'PLAYER_AND_ENEMIES': return assetList.filter(a => a.type === 'PLAYER' || a.type === 'SLIME' || a.type === 'PUDDLE' || a.type === 'BAD_MAN').map(a => a.id);
      case 'PLATFORMS':
        return assetList
          .filter(a => a.type === 'PLATFORM' || a.type === 'LADDER')
          .sort((a, b) => {
            // Force 'platform' to be first (1)
            if (a.id === 'platform') return -1;
            if (b.id === 'platform') return 1;
            // Force 'ladder' to be second (2)
            if (a.id === 'ladder') {
              return b.id === 'platform' ? 1 : -1;
            }
            if (b.id === 'ladder') {
              return a.id === 'platform' ? -1 : 1;
            }
            return 0;
          })
          .map(a => a.id);
      case 'ASSETS': return assetList.filter(a => a.type !== 'PLAYER' && a.type !== 'SLIME' && a.type !== 'PUDDLE' && a.type !== 'BAD_MAN' && a.type !== 'PLATFORM' && a.type !== 'LADDER').map(a => a.id);
      default: return [];
    }
  }, [currentEditorState.assets]);

  const handleCategoryClick = useCallback((category: AssetCategory) => {
    setOpenCategory(prev => (prev === category ? null : category));
  }, []);

  useEffect(() => {
    const currentCategoryAssets = getAssetsForCategory(openCategory);
    if (openCategory && !currentCategoryAssets.includes(selectedAssetId)) {
      if (currentCategoryAssets.length > 0) setSelectedAssetId(currentCategoryAssets[0]);
    }
  }, [openCategory, selectedAssetId, getAssetsForCategory]);

  const handlePhysicsChange = useCallback((newPhysics: Partial<PhysicsState>) => {
    setPhysics(p => ({ ...p, ...newPhysics }));
  }, []);

  const modifyCurrentLevel = useCallback((levelModifier: (level: Level) => Level) => {
    const newLevels = [...currentEditorState.levels];
    const modifiedLevel = levelModifier(newLevels[currentEditorState.currentLevelIndex]);
    newLevels[currentEditorState.currentLevelIndex] = modifiedLevel;
    commitChanges({ levels: newLevels });
  }, [currentEditorState, commitChanges]);

  const handleLevelDrawCommit = useCallback((changes: { x: number, y: number, assetId: string | null, rotation?: number }[]) => {
    if (changes.length === 0) return;
    modifyCurrentLevel(level => {
      const currentLevelMap = new Map(level.levelData.map(p => [`${p.x},${p.y}`, p]));
      changes.forEach(change => {
        const coordKey = `${change.x},${change.y}`;
        if (change.assetId === 'player') return;
        if (change.assetId) {
          const newAsset: PlacedAsset = {
            id: `${change.assetId}-${change.x}-${change.y}`,
            assetId: change.assetId,
            x: change.x,
            y: change.y
          };
          // Add rotation if provided
          if (change.rotation !== undefined) {
            newAsset.rotation = change.rotation;
          }
          currentLevelMap.set(coordKey, newAsset);
        }
        else currentLevelMap.delete(coordKey);
      });

      const newLevelData = Array.from(currentLevelMap.values()) as PlacedAsset[];

      // Auto-pair teleporters
      const teleporters = newLevelData.filter(p => currentEditorState.assets[p.assetId]?.type === 'TELEPORTER');
      const pairedIds = new Set<number>();
      const unpairedTeleporters: PlacedAsset[] = [];

      teleporters.forEach(t => {
        const existingPair = teleporters.find(other => other.id !== t.id && other.teleporterPairId === t.teleporterPairId);
        if (t.teleporterPairId !== undefined && existingPair) {
          pairedIds.add(t.teleporterPairId);
        } else {
          t.teleporterPairId = undefined; // Mark as unpaired
          unpairedTeleporters.push(t);
        }
      });

      while (unpairedTeleporters.length >= 2) {
        const t1 = unpairedTeleporters.shift()!;
        const t2 = unpairedTeleporters.shift()!;
        let nextPairId = 1;
        while (pairedIds.has(nextPairId)) nextPairId++;
        t1.teleporterPairId = nextPairId;
        t2.teleporterPairId = nextPairId;
        pairedIds.add(nextPairId);
      }

      return { ...level, levelData: newLevelData };
    });
  }, [modifyCurrentLevel, currentEditorState.assets]);

  const handlePlayerStartChange = useCallback((x: number, y: number) => {
    modifyCurrentLevel(level => ({ ...level, playerStartPos: { x, y } }));
  }, [modifyCurrentLevel]);

  const handleMoveAsset = useCallback((assetIdToMove: string, newX: number, newY: number) => {
    modifyCurrentLevel(level => ({ ...level, levelData: level.levelData.map(p => p.id === assetIdToMove ? { ...p, x: newX, y: newY } : p) }));
  }, [modifyCurrentLevel]);

  const handleAddLevel = useCallback(() => {
    const newLevel = createEmptyLevel(`Level ${currentEditorState.levels.length + 1}`);
    const newLevels = [...currentEditorState.levels, newLevel];
    commitChanges({ levels: newLevels, currentLevelIndex: newLevels.length - 1 });
  }, [currentEditorState.levels, commitChanges]);

  const handleDeleteLevel = useCallback((indexToDelete: number) => {
    if (currentEditorState.levels.length <= 1) return;
    const newLevels = currentEditorState.levels.filter((_, index) => index !== indexToDelete);
    const newIndex = Math.min(currentEditorState.currentLevelIndex, newLevels.length - 1);
    commitChanges({ levels: newLevels, currentLevelIndex: newIndex });
  }, [currentEditorState, commitChanges]);

  const handleSelectLevel = useCallback((index: number) => {
    commitChanges({ currentLevelIndex: index });
  }, [commitChanges]);

  const handleRenameLevel = useCallback((index: number, newName: string) => {
    const newLevels = [...currentEditorState.levels];
    newLevels[index] = { ...newLevels[index], name: newName };
    commitChanges({ levels: newLevels });
  }, [currentEditorState.levels, commitChanges]);

  const handleSetLevelIntroText = useCallback((index: number, text: string) => {
    const newLevels = [...currentEditorState.levels];
    newLevels[index] = { ...newLevels[index], introText: text };
    commitChanges({ levels: newLevels });
  }, [currentEditorState.levels, commitChanges]);

  const handleReorderLevel = useCallback((fromIndex: number, toIndex: number) => {
    const newLevels = [...currentEditorState.levels];
    const [moved] = newLevels.splice(fromIndex, 1);
    newLevels.splice(toIndex, 0, moved);
    let newCurrentIndex = currentEditorState.currentLevelIndex;
    if (newCurrentIndex === fromIndex) {
      newCurrentIndex = toIndex;
    } else if (fromIndex < toIndex && newCurrentIndex > fromIndex && newCurrentIndex <= toIndex) {
      newCurrentIndex--;
    } else if (fromIndex > toIndex && newCurrentIndex >= toIndex && newCurrentIndex < fromIndex) {
      newCurrentIndex++;
    }
    commitChanges({ levels: newLevels, currentLevelIndex: newCurrentIndex });
  }, [currentEditorState, commitChanges]);

  const handleLevelComplete = useCallback(() => {
    const { levels, currentLevelIndex } = currentEditorState;
    if (currentLevelIndex < levels.length - 1) {
      commitChanges({ currentLevelIndex: currentLevelIndex + 1 });
    }
  }, [currentEditorState, commitChanges]);

  const loadGame = useCallback((gameData: GameSave) => {
    const { assets, levels, physics: loadedPhysics } = gameData;

    const newState: EditorState = {
      assets: assets,
      levels: levels,
      currentLevelIndex: 0,
      palette: currentEditorState.palette, // Keep user's theme
      theme: currentEditorState.theme,
    };

    setHistory([newState]);
    setHistoryIndex(0);
    setPhysics(loadedPhysics);
    setIsEditorOpen(false); // Switch to play mode for a quick test

  }, [currentEditorState.palette, currentEditorState.theme]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameMode !== 'EDIT' || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      switch (key) { case 'p': handleCategoryClick('PLAYER_AND_ENEMIES'); return; case 'g': handleCategoryClick('PLATFORMS'); return; case 'a': handleCategoryClick('ASSETS'); return; }
      const numKey = parseInt(e.key);
      if (isNaN(numKey) || numKey < 1) return;
      const assetsInCategory = getAssetsForCategory(openCategory);
      const assetIndex = numKey - 1;
      if (assetIndex >= 0 && assetIndex < assetsInCategory.length) setSelectedAssetId(assetsInCategory[assetIndex]);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameMode, openCategory, getAssetsForCategory, handleCategoryClick, setSelectedAssetId]);

  const currentLevel = useMemo(() => currentEditorState.levels[currentEditorState.currentLevelIndex], [currentEditorState]);

  if (!isGameStarted) {
    return <SplashScreen onStartGame={() => setIsGameStarted(true)} isLoadingAssets={false} />;
  }

  // Guard against undefined currentLevel
  if (!currentLevel) {
    return <div className="w-screen h-screen bg-gray-800 flex items-center justify-center text-white">Loading...</div>;
  }

  return (
    <div className="w-screen h-screen bg-gray-800 relative overflow-hidden">
      <div className={`absolute top-0 left-0 h-full transition-all duration-300 ease-in-out ${isEditorOpen ? 'right-80' : 'right-0'}`}>
        <GameCanvas
          key={currentLevel.id}
          mode={gameMode}
          playerAsset={currentEditorState.assets.player as Asset}
          assets={currentEditorState.assets}
          physics={physics}
          palette={displayPalette}
          level={currentLevel}
          levels={currentEditorState.levels}
          onCommitChanges={handleLevelDrawCommit}
          selectedAssetId={selectedAssetId}
          errorMessage={errorMessage}
          onPlayerStartChange={handlePlayerStartChange}
          onMoveAsset={handleMoveAsset}
          theme={currentEditorState.theme}
          currentLevelIndex={currentEditorState.currentLevelIndex}
          onLevelComplete={handleLevelComplete}
          isLastLevel={currentEditorState.currentLevelIndex === currentEditorState.levels.length - 1}
        />
      </div>

      <div className={`absolute top-0 right-0 h-full w-80 transition-transform duration-300 ease-in-out ${isEditorOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <AssetEditor
          editorState={currentEditorState}
          onCommitChanges={commitChanges}
          selectedAssetId={selectedAssetId}
          onSelectAsset={setSelectedAssetId}
          gameMode={gameMode}
          physics={physics}
          onPhysicsChange={handlePhysicsChange}
          displayPalette={displayPalette}
          onThemeChange={handleThemeChange}
          openCategory={openCategory}
          onCategoryClick={handleCategoryClick}
          getAssetsForCategory={getAssetsForCategory}
          onAddLevel={handleAddLevel}
          onDeleteLevel={handleDeleteLevel}
          onSelectLevel={handleSelectLevel}
          onRenameLevel={handleRenameLevel}
          onReorderLevel={handleReorderLevel}
          onSetLevelIntroText={handleSetLevelIntroText}
          onLoadGame={loadGame}
        />
      </div>

      <button
        onClick={() => setIsEditorOpen(!isEditorOpen)}
        className={`absolute top-1/2 -translate-y-1/2 bg-gray-700 hover:bg-gray-600 text-white rounded-l-lg transition-all duration-300 ease-in-out group focus:outline-none z-10 ${isEditorOpen ? 'right-80' : 'right-0'}`}
        style={{ height: '80px' }}
      >
        <div className={`h-full flex items-center justify-center transition-all duration-300 ${isEditorOpen ? 'w-8' : 'w-4 group-hover:w-8'}`}>
          <span className={`transform transition-transform duration-300 ${isEditorOpen ? 'rotate-180' : 'rotate-0'}`}>{'<'}</span>
        </div>
      </button>
    </div>
  );
};

export default App;