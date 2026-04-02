

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TILE_SIZE } from '../constants';
import type { Assets, GameMode, PixelData, PhysicsState, Asset, EditorState, Level, GameSave, SavedGames, AssetType } from '../types';
import { THEMES } from '../palettes';

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    // Treat fully transparent as null so it doesn't get matched to a color
    if (hex === '#00000000') return null;
    // Ignore alpha channel for color matching
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
};
const colorDistance = (rgb1: { r: number; g: number; b: number }, rgb2: { r: number; g: number; b: number }) => Math.pow(rgb1.r - rgb2.r, 2) + Math.pow(rgb1.g - rgb2.g, 2) + Math.pow(rgb1.b - rgb2.b, 2);
const masterPalette = THEMES['pixel-pro'].palette;
const masterRgbPalette = masterPalette.map(hexToRgb);

interface PixelGridProps {
    data: PixelData;
    scale: number;
    palette: string[];
    selection: { x: number; y: number; width: number; height: number; } | null;
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>, x: number, y: number) => void;
    onMouseMove: (e: React.MouseEvent<HTMLDivElement>, x: number, y: number) => void;
    onMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const PixelGrid: React.FC<PixelGridProps> = ({ data, scale, palette, selection, onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onContextMenu }) => {
    return (
        <div
            className="grid border-2 border-gray-500 bg-gray-900 cursor-crosshair relative"
            style={{ width: `${TILE_SIZE * scale}px`, height: `${TILE_SIZE * scale}px`, gridTemplateColumns: `repeat(${TILE_SIZE}, 1fr)` }}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onContextMenu={onContextMenu}
        >
            {data.map((row, y) => row.map((colorIndex, x) => (
                <div
                    key={`${y}-${x}`}
                    className="w-full h-full"
                    style={{ backgroundColor: palette[colorIndex] || 'transparent' }}
                    onMouseDown={(e) => onMouseDown(e, x, y)}
                    onMouseEnter={(e) => onMouseMove(e, x, y)}
                />
            )))}
            {selection && (
                <div className="absolute pointer-events-none border-2 border-dashed border-white mix-blend-difference"
                    style={{
                        top: selection.y * scale,
                        left: selection.x * scale,
                        width: selection.width * scale,
                        height: selection.height * scale,
                        boxSizing: 'border-box'
                    }}
                />
            )}
        </div>
    );
};


interface AssetEditorProps {
    editorState: EditorState;
    onCommitChanges: (newState: Partial<EditorState>) => void;
    selectedAssetId: string;
    onSelectAsset: (assetId: string) => void;
    gameMode: GameMode;
    physics: PhysicsState;
    onPhysicsChange: (newPhysics: Partial<PhysicsState>) => void;
    displayPalette: string[];
    onThemeChange: (themeName: string) => void;
    openCategory: 'PLAYER_AND_ENEMIES' | 'PLATFORMS' | 'ASSETS' | null;
    onCategoryClick: (category: 'PLAYER_AND_ENEMIES' | 'PLATFORMS' | 'ASSETS') => void;
    getAssetsForCategory: (category: 'PLAYER_AND_ENEMIES' | 'PLATFORMS' | 'ASSETS' | null) => string[];
    onAddLevel: () => void;
    onDeleteLevel: (index: number) => void;
    onSelectLevel: (index: number) => void;
    onRenameLevel: (index: number, newName: string) => void;
    onReorderLevel: (fromIndex: number, toIndex: number) => void;
    onSetLevelIntroText: (index: number, text: string) => void;
    onLoadGame: (game: GameSave) => void;
}

const ShortcutBadge: React.FC<{ children?: React.ReactNode }> = ({ children }) => (<span className="absolute -top-1 -right-1 text-xs bg-gray-900 text-white rounded-full w-4 h-4 flex items-center justify-center border-2 border-gray-700 font-sans">{children}</span>);

const AssetIcon: React.FC<{ assetData: PixelData; palette: string[] }> = ({ assetData, palette }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current, ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const scale = 4;
        canvas.width = TILE_SIZE * scale; canvas.height = TILE_SIZE * scale; ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < TILE_SIZE; y++) for (let x = 0; x < TILE_SIZE; x++) {
            const colorIndex = assetData[y][x];
            if (colorIndex > 0) { ctx.fillStyle = palette[colorIndex]; ctx.fillRect(x * scale, y * scale, scale, scale); }
        }
    }, [assetData, palette]);
    return <canvas ref={canvasRef} className="bg-gray-900 rounded-md border-2 border-gray-800" />;
};

const AssetPanel: React.FC<Omit<AssetEditorProps, 'onAddLevel' | 'onDeleteLevel' | 'onSelectLevel' | 'onRenameLevel' | 'physics' | 'onPhysicsChange' | 'onThemeChange' | 'onLoadGame'>> = ({ editorState, onCommitChanges, selectedAssetId, onSelectAsset, displayPalette, openCategory, onCategoryClick, getAssetsForCategory }) => {
    const [selectedColorIndex, setSelectedColorIndex] = useState(2);
    const isEditingAsset = useRef(false);
    const [tempAssets, setTempAssets] = useState<Assets>(editorState.assets);

    const [activeAnim, setActiveAnim] = useState<{ type: string, frame: number } | null>(null);

    const [activeTool, setActiveTool] = useState<'draw' | 'fill' | 'select'>('draw');
    const [selection, setSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const selectionRef = useRef(selection);
    useEffect(() => { selectionRef.current = selection; }, [selection]);
    const [selectionStartCoord, setSelectionStartCoord] = useState<{ x: number; y: number } | null>(null);
    const [isDraggingSelection, setIsDraggingSelection] = useState(false);
    const [draggedSelection, setDraggedSelection] = useState<{ pixels: PixelData, x: number, y: number } | null>(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const originalSelectionOrigin = useRef<{ x: number, y: number } | null>(null);
    const mouseState = useRef<'none' | 'drawing' | 'erasing' | 'selecting'>('none');
    const clipboardRef = useRef<PixelData | null>(null);

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, animType: string, frameIndex: number } | null>(null);
    const [pixelEditorContextMenu, setPixelEditorContextMenu] = useState<{ x: number; y: number } | null>(null);

    const [draggedFrame, setDraggedFrame] = useState<{ animType: string, index: number, isDuplicating: boolean } | null>(null);
    const [dragOverState, setDragOverState] = useState<{ animType: string, index: number, side: 'left' | 'right' } | null>(null);

    useEffect(() => { setTempAssets(editorState.assets); }, [editorState.assets]);
    useEffect(() => { if (selectedColorIndex >= editorState.palette.length) setSelectedColorIndex(editorState.palette.length > 1 ? 1 : 0); }, [editorState.palette, selectedColorIndex]);

    useEffect(() => {
        // When a new asset is selected, default to showing the IDLE animation for the player.
        // We deliberately omit dependencies other than selectedAssetId to avoid resetting
        // the user's animation selection while they are editing.
        const asset = tempAssets[selectedAssetId];
        if (asset?.type === 'PLAYER' && asset.animations?.IDLE?.[0]) {
            setActiveAnim({ type: 'IDLE', frame: 0 });
        } else {
            setActiveAnim(null);
        }
        setSelection(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAssetId]);

    const selectedAsset = tempAssets[selectedAssetId];

    const closeMenus = useCallback(() => {
        setContextMenu(null);
        setPixelEditorContextMenu(null);
    }, []);

    const getMasterColorIndex = useCallback((paletteColorIndex: number): number => {
        const selectedHex = editorState.palette[paletteColorIndex];
        if (paletteColorIndex === 0) return 0;

        let bestMatchIndex = masterPalette.indexOf(selectedHex);
        if (bestMatchIndex === -1) {
            const selectedRgb = hexToRgb(selectedHex);
            if (!selectedRgb) return 1;
            let minDistance = Infinity;
            let matchIndex = 1;
            masterRgbPalette.forEach((masterRgb, masterIndex) => {
                if (masterIndex === 0 || !masterRgb) return;
                const distance = colorDistance(selectedRgb, masterRgb);
                if (distance < minDistance) {
                    minDistance = distance;
                    matchIndex = masterIndex;
                }
            });
            bestMatchIndex = matchIndex;
        }
        return bestMatchIndex;
    }, [editorState.palette]);

    const updatePixelData = useCallback((updateFn: (data: PixelData) => PixelData, commit: boolean = false) => {
        setTempAssets(currentAssets => {
            const assetToUpdate = currentAssets[selectedAssetId];
            if (!assetToUpdate) return currentAssets;

            let newAsset: Asset;

            if (activeAnim && assetToUpdate.animations && assetToUpdate.animations[activeAnim.type]) {
                const newPixelData = updateFn(assetToUpdate.animations[activeAnim.type][activeAnim.frame].map(r => [...r]));
                const newAnimations = { ...assetToUpdate.animations };
                const newFrames = [...newAnimations[activeAnim.type]];
                newFrames[activeAnim.frame] = newPixelData;
                newAnimations[activeAnim.type] = newFrames;
                newAsset = { ...assetToUpdate, animations: newAnimations };
            } else {
                const newPixelData = updateFn(assetToUpdate.data.map(r => [...r]));
                newAsset = { ...assetToUpdate, data: newPixelData };
            }

            const newAssets = { ...currentAssets, [selectedAssetId]: newAsset };
            if (commit) {
                onCommitChanges({ assets: newAssets });
            }
            return newAssets;
        });
    }, [selectedAssetId, activeAnim, onCommitChanges]);

    const handlePixelChange = useCallback((x: number, y: number) => {
        const newColorIndex = getMasterColorIndex(selectedColorIndex);
        updatePixelData(data => {
            if (x >= 0 && x < TILE_SIZE && y >= 0 && y < TILE_SIZE) {
                if (data[y][x] !== newColorIndex) data[y][x] = newColorIndex;
            }
            return data;
        });
    }, [selectedColorIndex, updatePixelData, getMasterColorIndex]);

    const handlePixelErase = useCallback((x: number, y: number) => {
        updatePixelData(data => {
            if (x >= 0 && x < TILE_SIZE && y >= 0 && y < TILE_SIZE) {
                if (data[y][x] !== 0) data[y][x] = 0;
            }
            return data;
        });
    }, [updatePixelData]);

    const handleFill = useCallback((startX: number, startY: number) => {
        const newColorIndex = getMasterColorIndex(selectedColorIndex);
        updatePixelData(data => {
            const targetColor = data[startY][startX];
            if (targetColor === newColorIndex) return data;

            const queue: [number, number][] = [[startX, startY]];
            const visited = new Set<string>();
            visited.add(`${startX},${startY}`);

            while (queue.length > 0) {
                const [x, y] = queue.shift()!;
                data[y][x] = newColorIndex;

                [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].forEach(([nx, ny]) => {
                    const key = `${nx},${ny}`;
                    if (nx >= 0 && nx < TILE_SIZE && ny >= 0 && ny < TILE_SIZE && !visited.has(key) && data[ny][nx] === targetColor) {
                        visited.add(key);
                        queue.push([nx, ny]);
                    }
                });
            }
            return data;
        });
    }, [selectedColorIndex, updatePixelData, getMasterColorIndex]);

    const handleAssetEditStart = () => { isEditingAsset.current = true; };
    const handleAssetEditEnd = useCallback(() => {
        if (isEditingAsset.current) {
            onCommitChanges({ assets: tempAssets });
            isEditingAsset.current = false;
        }
    }, [onCommitChanges, tempAssets]);

    const deleteSelection = useCallback(() => {
        if (!selection) return;
        updatePixelData(data => {
            for (let y = selection.y; y < selection.y + selection.height; y++) {
                for (let x = selection.x; x < selection.x + selection.width; x++) {
                    if (x >= 0 && x < TILE_SIZE && y >= 0 && y < TILE_SIZE) {
                        data[y][x] = 0;
                    }
                }
            }
            return data;
        }, true);
        setSelection(null);
    }, [selection, updatePixelData]);

    const handleCopySelection = useCallback(() => {
        if (!selection) return;
        const currentPixelData = activeAnim && selectedAsset?.animations?.[activeAnim.type]?.[activeAnim.frame]
            ? selectedAsset.animations[activeAnim.type][activeAnim.frame]
            : selectedAsset?.data;

        if (currentPixelData) {
            const sel = selection;
            const copied: PixelData = [];
            for (let y = 0; y < sel.height; y++) {
                copied.push(currentPixelData[sel.y + y].slice(sel.x, sel.x + sel.width));
            }
            clipboardRef.current = copied;
        }
    }, [selection, activeAnim, selectedAsset]);

    useEffect(() => {
        const currentPixelData = activeAnim && selectedAsset?.animations?.[activeAnim.type]?.[activeAnim.frame]
            ? selectedAsset.animations[activeAnim.type][activeAnim.frame]
            : selectedAsset?.data;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                if (selectionRef.current && currentPixelData) {
                    e.preventDefault();
                    handleCopySelection();
                }
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                if (clipboardRef.current) {
                    e.preventDefault();
                    setSelection(null);
                    setDraggedSelection({ pixels: clipboardRef.current, x: 0, y: 0 });
                    setIsDraggingSelection(true);
                    setDragOffset({ x: 0, y: 0 });
                }
            } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectionRef.current) {
                e.preventDefault();
                deleteSelection();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setSelection(null);
                setIsDraggingSelection(false);
                setDraggedSelection(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [deleteSelection, selectedAsset, activeAnim, handleCopySelection]);

    const handleGridMouseDown = (e: React.MouseEvent<HTMLDivElement>, x: number, y: number) => {
        e.preventDefault();
        if (e.button !== 2) closeMenus();

        if (e.button === 2) {
            if (selection && x >= selection.x && x < selection.x + selection.width && y >= selection.y && y < selection.y + selection.height) {
                return;
            }
        }

        if (isDraggingSelection && draggedSelection) {
            handleGridMouseUp(e);
            return;
        }
        handleAssetEditStart();
        if (e.button === 2) {
            mouseState.current = 'erasing';
            handlePixelErase(x, y);
            return;
        }
        switch (activeTool) {
            case 'draw': mouseState.current = 'drawing'; handlePixelChange(x, y); break;
            case 'fill': handleFill(x, y); handleAssetEditEnd(); break;
            case 'select':
                if (selection && x >= selection.x && x < selection.x + selection.width && y >= selection.y && y < selection.y + selection.height) {
                    originalSelectionOrigin.current = { x: selection.x, y: selection.y };
                    const currentData = activeAnim ? tempAssets[selectedAssetId]?.animations?.[activeAnim.type][activeAnim.frame] : tempAssets[selectedAssetId]?.data;
                    if (!currentData) return;
                    const pixels: PixelData = [];
                    for (let sy = 0; sy < selection.height; sy++) {
                        pixels.push(currentData[selection.y + sy].slice(selection.x, selection.x + selection.width));
                    }
                    setDraggedSelection({ pixels, x: selection.x, y: selection.y });
                    setDragOffset({ x: x - selection.x, y: y - selection.y });
                    setIsDraggingSelection(true);
                    setSelection(null);
                } else {
                    mouseState.current = 'selecting';
                    setSelection(null);
                    setSelectionStartCoord({ x, y });
                }
                break;
        }
    };

    const handleGridMouseMove = (e: React.MouseEvent<HTMLDivElement>, x: number, y: number) => {
        if (mouseState.current === 'drawing') handlePixelChange(x, y);
        if (mouseState.current === 'erasing') handlePixelErase(x, y);
        if (mouseState.current === 'selecting' && selectionStartCoord) {
            const x1 = Math.min(selectionStartCoord.x, x);
            const y1 = Math.min(selectionStartCoord.y, y);
            const x2 = Math.max(selectionStartCoord.x, x);
            const y2 = Math.max(selectionStartCoord.y, y);
            setSelection({ x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 });
        }
        if (isDraggingSelection && draggedSelection) {
            setDraggedSelection(prev => prev ? { ...prev, x: x - dragOffset.x, y: y - dragOffset.y } : null);
        }
    };

    const handleGridMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isDraggingSelection && draggedSelection) {
            updatePixelData(data => {
                if (originalSelectionOrigin.current) {
                    const origin = originalSelectionOrigin.current;
                    for (let y = 0; y < draggedSelection.pixels.length; y++) {
                        for (let x = 0; x < draggedSelection.pixels[0].length; x++) {
                            const ox = origin.x + x;
                            const oy = origin.y + y;
                            if (ox >= 0 && ox < TILE_SIZE && oy >= 0 && oy < TILE_SIZE) {
                                data[oy][ox] = 0;
                            }
                        }
                    }
                }
                for (let y = 0; y < draggedSelection.pixels.length; y++) {
                    for (let x = 0; x < draggedSelection.pixels[0].length; x++) {
                        const nx = draggedSelection.x + x;
                        const ny = draggedSelection.y + y;
                        if (nx >= 0 && nx < TILE_SIZE && ny >= 0 && ny < TILE_SIZE) {
                            data[ny][nx] = draggedSelection.pixels[y][x];
                        }
                    }
                }
                return data;
            });
        }

        mouseState.current = 'none';
        setSelectionStartCoord(null);
        setIsDraggingSelection(false);
        setDraggedSelection(null);
        originalSelectionOrigin.current = null;
        handleAssetEditEnd();
    };

    const handleGridMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        if (mouseState.current === 'drawing' || mouseState.current === 'erasing' || mouseState.current === 'selecting') {
            handleGridMouseUp(e);
        }
    };

    const handleGridContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (selection) {
            const gridContainer = e.currentTarget;
            const rect = gridContainer.getBoundingClientRect();
            const scale = rect.width / TILE_SIZE;
            const x = Math.floor((e.clientX - rect.left) / scale);
            const y = Math.floor((e.clientY - rect.top) / scale);

            if (x >= selection.x && x < selection.x + selection.width && y >= selection.y && y < selection.y + selection.height) {
                setPixelEditorContextMenu({ x: e.clientX, y: e.clientY });
                setContextMenu(null);
            } else {
                closeMenus();
            }
        } else {
            closeMenus();
        }
    }

    const handleDeleteAsset = (assetId: string) => {
        if (assetId === 'platform' || assetId === 'ladder') return; // Prevent deleting defaults
        const newAssets = { ...tempAssets };
        delete newAssets[assetId];
        onCommitChanges({ assets: newAssets });
        if (selectedAssetId === assetId) {
            onSelectAsset('player'); // Default selection
        }
    };

    const handleAddAsset = (type: AssetType) => {
        // Enforce limit: Max 5 user-created assets
        const userAssetsCount = (Object.values(tempAssets) as Asset[]).filter(a => a.type === type && a.id !== 'platform' && a.id !== 'ladder').length;
        if (userAssetsCount >= 5) {
            alert(`You can only create up to 5 custom ${type === 'PLATFORM' ? 'platform' : 'ladder'} assets.`);
            return;
        }

        const timestamp = Date.now();
        const newId = `${type.toLowerCase()}-${timestamp}`;
        const newName = `${type.charAt(0) + type.slice(1).toLowerCase()} ${(Object.values(tempAssets) as Asset[]).filter(a => a.type === type).length + 1}`;

        // Create empty 16x16 pixel data
        const emptyData: PixelData = Array(TILE_SIZE).fill(0).map(() => Array(TILE_SIZE).fill(0));

        const newAsset: Asset = {
            id: newId,
            name: newName,
            type: type,
            data: emptyData
        };

        const newAssets = { ...tempAssets, [newId]: newAsset };
        onCommitChanges({ assets: newAssets });
        // Select the new asset
        onSelectAsset(newId);
    };

    const handleAddFrame = (animType: string) => {
        setTempAssets(assets => {
            const assetToUpdate = assets[selectedAssetId];
            if (!assetToUpdate?.animations?.[animType]) return assets;
            const currentFrames = assetToUpdate.animations[animType];
            const lastFrame = JSON.parse(JSON.stringify(currentFrames[currentFrames.length - 1]));
            const newFrames = [...currentFrames, lastFrame];
            const newAnimations = { ...assetToUpdate.animations, [animType]: newFrames };
            const newAsset = { ...assetToUpdate, animations: newAnimations };
            const newAssets = { ...assets, [selectedAssetId]: newAsset };
            onCommitChanges({ assets: newAssets });
            setActiveAnim({ type: animType, frame: newFrames.length - 1 });
            return newAssets;
        });
    };

    const handleRemoveFrame = (animType: string, frameIndex: number) => {
        setTempAssets(assets => {
            const assetToUpdate = assets[selectedAssetId];
            if (!assetToUpdate?.animations?.[animType] || assetToUpdate.animations[animType].length <= 1) return assets;
            const newFrames = assetToUpdate.animations[animType].filter((_, i) => i !== frameIndex);
            const newAnimations = { ...assetToUpdate.animations, [animType]: newFrames };
            const newAsset = { ...assetToUpdate, animations: newAnimations };
            const newAssets = { ...assets, [selectedAssetId]: newAsset };
            onCommitChanges({ assets: newAssets });
            if (activeAnim?.type === animType && activeAnim.frame >= newFrames.length) {
                setActiveAnim({ type: animType, frame: newFrames.length - 1 });
            }
            return newAssets;
        });
    };

    const handleDuplicateFrame = (animType: string, frameIndex: number) => {
        setTempAssets(assets => {
            const assetToUpdate = assets[selectedAssetId];
            if (!assetToUpdate?.animations?.[animType]) return assets;
            const currentFrames = assetToUpdate.animations[animType];
            const frameToCopy = JSON.parse(JSON.stringify(currentFrames[frameIndex]));
            const newFrames = [...currentFrames];
            newFrames.splice(frameIndex + 1, 0, frameToCopy);
            const newAnimations = { ...assetToUpdate.animations, [animType]: newFrames };
            const newAsset = { ...assetToUpdate, animations: newAnimations };
            const newAssets = { ...assets, [selectedAssetId]: newAsset };
            onCommitChanges({ assets: newAssets });
            return newAssets;
        });
    };

    const handleClearFrame = (animType: string, frameIndex: number) => {
        setTempAssets(assets => {
            const assetToUpdate = assets[selectedAssetId];
            if (!assetToUpdate?.animations?.[animType]) return assets;
            const newFrames = [...assetToUpdate.animations[animType]];
            newFrames[frameIndex] = Array(TILE_SIZE).fill(0).map(() => Array(TILE_SIZE).fill(0));
            const newAnimations = { ...assetToUpdate.animations, [animType]: newFrames };
            const newAsset = { ...assetToUpdate, animations: newAnimations };
            const newAssets = { ...assets, [selectedAssetId]: newAsset };
            onCommitChanges({ assets: newAssets });
            return newAssets;
        });
    };

    const handleFrameDrop = (animType: string, targetDropIndex: number) => {
        if (!draggedFrame || draggedFrame.animType !== animType) return;
        const { index: dragIndex, isDuplicating } = draggedFrame;

        setTempAssets(assets => {
            const assetToUpdate = assets[selectedAssetId];
            if (!assetToUpdate?.animations?.[animType]) return assets;

            const newFrames = [...assetToUpdate.animations[animType]];

            if (isDuplicating) {
                const frameToCopy = JSON.parse(JSON.stringify(newFrames[dragIndex]));
                newFrames.splice(targetDropIndex, 0, frameToCopy);
                setActiveAnim({ type: animType, frame: targetDropIndex }); // Make new frame active
            } else {
                const dropIndex = dragIndex < targetDropIndex ? targetDropIndex - 1 : targetDropIndex;
                if (dragIndex === dropIndex) return assets;

                const [removed] = newFrames.splice(dragIndex, 1);
                newFrames.splice(dropIndex, 0, removed);

                if (activeAnim?.type === animType && activeAnim.frame === dragIndex) {
                    setActiveAnim({ type: animType, frame: dropIndex });
                }
            }

            const newAnimations = { ...assetToUpdate.animations, [animType]: newFrames };
            const newAsset = { ...assetToUpdate, animations: newAnimations };
            const newAssets = { ...assets, [selectedAssetId]: newAsset };
            onCommitChanges({ assets: newAssets });

            return newAssets;
        });
    };

    const handleFpsChange = (newFps: number) => {
        const fps = Math.max(1, Math.min(60, newFps || 1));
        const newAssets = { ...tempAssets };
        const assetToUpdate = newAssets[selectedAssetId];
        if (assetToUpdate) {
            assetToUpdate.animationFps = fps;
            setTempAssets(newAssets);
            onCommitChanges({ assets: newAssets });
        }
    };

    const currentPixelData = activeAnim && selectedAsset?.animations?.[activeAnim.type]?.[activeAnim.frame]
        ? selectedAsset.animations[activeAnim.type][activeAnim.frame]
        : selectedAsset?.data;

    const ToolButton: React.FC<{ tool: 'draw' | 'fill' | 'select', title: string, children: React.ReactNode }> = ({ tool, title, children }) => (
        <button onClick={() => { setActiveTool(tool); setSelection(null); }} title={title} className={`p-1.5 rounded-md ${activeTool === tool ? 'bg-blue-600 text-white' : 'bg-gray-600 hover:bg-gray-500 text-gray-300'}`}>
            {children}
        </button>
    );

    const ContextMenuPortal: React.FC = () => {
        if (!contextMenu && !pixelEditorContextMenu) return null;

        const handleBackdropClick = (e: React.MouseEvent) => {
            e.preventDefault();
            closeMenus();
        };

        const menuContent = contextMenu ? (
            <div style={{ top: contextMenu.y, left: contextMenu.x }} className="fixed bg-gray-800 border border-gray-600 rounded-md shadow-lg z-50 py-1">
                <button onClick={() => { handleDuplicateFrame(contextMenu.animType, contextMenu.frameIndex); closeMenus(); }} className="block w-full text-left px-4 py-1 text-sm text-white hover:bg-gray-700">Duplicate</button>
                <button onClick={() => { handleClearFrame(contextMenu.animType, contextMenu.frameIndex); closeMenus(); }} className="block w-full text-left px-4 py-1 text-sm text-white hover:bg-gray-700">Clear</button>
            </div>
        ) : pixelEditorContextMenu && selection ? (
            <div style={{ top: pixelEditorContextMenu.y, left: pixelEditorContextMenu.x }} className="fixed bg-gray-800 border border-gray-600 rounded-md shadow-lg z-50 py-1">
                <button onClick={() => { handleCopySelection(); closeMenus(); }} className="block w-full text-left px-4 py-1 text-sm text-white hover:bg-gray-700">Copy</button>
                <button onClick={() => { deleteSelection(); closeMenus(); }} className="block w-full text-left px-4 py-1 text-sm text-white hover:bg-gray-700">Clear</button>
            </div>
        ) : null;

        if (!menuContent) return null;

        return createPortal(
            <>
                <div
                    className="fixed inset-0 z-40"
                    onClick={handleBackdropClick}
                    onContextMenu={handleBackdropClick}
                />
                {menuContent}
            </>,
            document.body
        );
    };

    return (
        <>
            <ContextMenuPortal />
            <div className="flex flex-col gap-4 min-h-full">
                <div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                        <button onClick={() => onCategoryClick('PLAYER_AND_ENEMIES')} className={`w-full py-2 text-sm font-bold rounded-md transition-colors relative hover:bg-gray-500 text-gray-300 ${openCategory === 'PLAYER_AND_ENEMIES' ? 'bg-blue-600 text-white' : 'bg-gray-600'}`}><u>P</u>layer & Enemies <ShortcutBadge>p</ShortcutBadge></button>
                        <button onClick={() => onCategoryClick('PLATFORMS')} className={`w-full py-2 text-sm font-bold rounded-md transition-colors relative hover:bg-gray-500 text-gray-300 ${openCategory === 'PLATFORMS' ? 'bg-blue-600 text-white' : 'bg-gray-600'}`}><u>G</u>round & Ladders <ShortcutBadge>g</ShortcutBadge></button>
                        <button onClick={() => onCategoryClick('ASSETS')} className={`w-full py-2 text-sm font-bold rounded-md transition-colors relative hover:bg-gray-500 text-gray-300 ${openCategory === 'ASSETS' ? 'bg-blue-600 text-white' : 'bg-gray-600'}`}><u>A</u>ssets <ShortcutBadge>a</ShortcutBadge></button>
                    </div>
                    {openCategory && <div className="bg-gray-800 p-2 rounded-md">
                        {openCategory === 'PLATFORMS' ? (
                            <div className="flex flex-col gap-2">
                                {/* Ground Tiles Row */}
                                <div>
                                    <div className="flex flex-wrap gap-2">
                                        {(Object.values(editorState.assets) as Asset[])
                                            .filter(a => a.type === 'PLATFORM')
                                            .sort((a, b) => {
                                                if (a.id === 'platform') return -1;
                                                if (b.id === 'platform') return 1;
                                                return 0;
                                            })
                                            .map((asset, index) => (
                                                <button key={asset.id} onClick={() => onSelectAsset(asset.id)} className={`group relative p-1 rounded-md transition-colors duration-150 ${selectedAssetId === asset.id ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`} title={asset.name}>
                                                    <AssetIcon assetData={asset.data} palette={displayPalette} />

                                                    {asset.id === 'platform' && <ShortcutBadge>1</ShortcutBadge>}
                                                    {asset.id !== 'platform' && (
                                                        <div
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteAsset(asset.id); }}
                                                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center text-white text-xs font-bold hover:bg-red-700 z-10 border border-gray-900"
                                                            title="Delete Asset"
                                                        >
                                                            ×
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        <button
                                            onClick={() => handleAddAsset('PLATFORM')}
                                            className="p-1 rounded-md bg-gray-700 hover:bg-gray-600 border-2 border-dashed border-gray-500 text-gray-400 hover:text-white transition-colors flex items-center justify-center box-border"
                                            style={{ width: '40px', height: '40px' }}
                                            title="Add New Platform"
                                        >
                                            <span className="text-xl font-bold">+</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Ladders Row */}
                                <div>
                                    <div className="flex flex-wrap gap-2">
                                        {(Object.values(editorState.assets) as Asset[])
                                            .filter(a => a.type === 'LADDER')
                                            .sort((a, b) => {
                                                if (a.id === 'ladder') return -1;
                                                if (b.id === 'ladder') return 1;
                                                return 0;
                                            })
                                            .map((asset, index) => (
                                                <button key={asset.id} onClick={() => onSelectAsset(asset.id)} className={`group relative p-1 rounded-md transition-colors duration-150 ${selectedAssetId === asset.id ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`} title={asset.name}>
                                                    <AssetIcon assetData={asset.data} palette={displayPalette} />
                                                    {asset.id === 'ladder' && <ShortcutBadge>2</ShortcutBadge>}
                                                    {asset.id !== 'ladder' && (
                                                        <div
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteAsset(asset.id); }}
                                                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center text-white text-xs font-bold hover:bg-red-700 z-10 border border-gray-900"
                                                            title="Delete Asset"
                                                        >
                                                            ×
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        <button
                                            onClick={() => handleAddAsset('LADDER')}
                                            className="p-1 rounded-md bg-gray-700 hover:bg-gray-600 border-2 border-dashed border-gray-500 text-gray-400 hover:text-white transition-colors flex items-center justify-center box-border"
                                            style={{ width: '40px', height: '40px' }}
                                            title="Add New Ladder"
                                        >
                                            <span className="text-xl font-bold">+</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {getAssetsForCategory(openCategory).map((assetId, index) => {
                                    const asset = editorState.assets[assetId]; if (!asset) return null;
                                    const iconData = (asset.type === 'PLAYER' && asset.animations?.IDLE?.[0]) ? asset.animations.IDLE[0] : asset.data;
                                    return <button key={asset.id} onClick={() => onSelectAsset(asset.id)} className={`group relative p-1 rounded-md transition-colors duration-150 ${selectedAssetId === asset.id ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`} title={asset.name}><AssetIcon assetData={iconData} palette={displayPalette} /><ShortcutBadge>{index + 1}</ShortcutBadge></button>;
                                })}
                            </div>
                        )}
                    </div>}
                </div>

                <div className="flex-grow flex flex-col items-center justify-start min-h-0">
                    {selectedAsset && currentPixelData && (
                        <div className="relative">
                            <PixelGrid
                                data={currentPixelData}
                                scale={12}
                                palette={displayPalette}
                                selection={selection}
                                onMouseDown={handleGridMouseDown}
                                onMouseMove={handleGridMouseMove}
                                onMouseUp={handleGridMouseUp}
                                onMouseLeave={handleGridMouseLeave}
                                onContextMenu={handleGridContextMenu}
                            />
                            {isDraggingSelection && draggedSelection && (
                                <div className="absolute pointer-events-none opacity-75" style={{ top: draggedSelection.y * 12, left: draggedSelection.x * 12, width: (draggedSelection.pixels[0]?.length || 0) * 12 }}>
                                    <div className="grid" style={{ gridTemplateColumns: `repeat(${draggedSelection.pixels[0]?.length || 0}, 1fr)` }}>
                                        {draggedSelection.pixels.map((row, ry) => row.map((colorIndex, rx) => (
                                            <div key={`${ry}-${rx}`} style={{ width: 12, height: 12, backgroundColor: displayPalette[colorIndex] || 'transparent' }} />
                                        )))}
                                    </div>
                                    <div className="absolute top-0 left-0 w-full h-full border-2 border-dashed border-white mix-blend-difference" style={{ boxSizing: 'border-box' }} />
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex gap-2 bg-gray-800 p-1 rounded-md mt-2">
                        <ToolButton tool="draw" title="Draw Tool (D)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" /></svg></ToolButton>
                        <ToolButton tool="fill" title="Fill Tool (F)">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                <path d="M10.08 3.442a.75.75 0 00-1.06-1.06L3.93 7.472a.75.75 0 001.06 1.06L10 3.53l5.091 5.091a.75.75 0 001.06-1.06L10.08 3.442z" />
                                <path d="M3 8.75A2.75 2.75 0 015.75 6h8.5A2.75 2.75 0 0117 8.75v5.5A2.75 2.75 0 0114.25 17h-8.5A2.75 2.75 0 013 14.25v-5.5zM5.75 7.5c-.69 0-1.25.56-1.25 1.25v5.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-5.5c0-.69-.56-1.25-1.25-1.25h-8.5z" />
                            </svg>
                        </ToolButton>
                        <ToolButton tool="select" title="Selection Tool (S)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" stroke="currentColor" fill="none" className="w-5 h-5"><rect x="3" y="3" width="14" height="14" rx="1" strokeWidth="1.5" strokeDasharray="4 2" /></svg></ToolButton>
                    </div>
                    <div className="w-full mt-2">
                        <label className="block text-sm font-medium text-gray-300 mb-1">Color Palette</label>
                        <div className="grid grid-cols-8 gap-1">
                            {editorState.palette.map((color, index) => index === 0 ? null : <button key={index} onClick={() => setSelectedColorIndex(index)} className={`w-full h-6 rounded-md transition-transform duration-150 transform hover:scale-110 ${selectedColorIndex === index ? 'ring-2 ring-offset-2 ring-offset-gray-700 ring-white' : ''}`} style={{ backgroundColor: color }} title={`Color ${index}`} />)}
                        </div>
                    </div>
                    {selectedAsset?.animations && (
                        <div className="w-full mt-2 border-t border-gray-600 pt-2 space-y-2 overflow-y-auto relative">
                            <div className="absolute top-0 right-0 flex items-center gap-1 bg-gray-700 p-1 rounded-bl-md z-10">
                                <label htmlFor="fps-input" className="text-xs font-medium text-gray-400">FPS</label>
                                <input id="fps-input" type="number" min="1" max="60" value={selectedAsset.animationFps || 10} onChange={(e) => handleFpsChange(parseInt(e.target.value, 10))} className="w-12 bg-gray-900 text-white text-sm outline-none ring-1 ring-gray-600 rounded px-1 py-0.5" />
                            </div>
                            {Object.keys(selectedAsset.animations).map(animType => (
                                <div key={animType}>
                                    <h4 className="text-xs font-bold uppercase text-gray-400 mb-1">{animType}</h4>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-grow flex items-center gap-1 bg-gray-900/50 p-1 rounded-md overflow-x-auto">
                                            {selectedAsset.animations![animType].map((frameData, frameIndex) => (
                                                <button
                                                    key={frameIndex}
                                                    draggable
                                                    onDragStart={(e) => {
                                                        e.dataTransfer.effectAllowed = e.altKey ? 'copy' : 'move';
                                                        setDraggedFrame({ animType, index: frameIndex, isDuplicating: e.altKey });

                                                        const canvas = e.currentTarget.querySelector('canvas');
                                                        if (canvas) {
                                                            const dragImage = document.createElement('canvas');
                                                            const newSize = canvas.width * 0.75;
                                                            dragImage.width = newSize;
                                                            dragImage.height = newSize;
                                                            const ctx = dragImage.getContext('2d');
                                                            if (ctx) {
                                                                ctx.imageSmoothingEnabled = false;
                                                                ctx.drawImage(canvas, 0, 0, newSize, newSize);

                                                                dragImage.style.position = 'absolute';
                                                                dragImage.style.top = '-1000px';
                                                                document.body.appendChild(dragImage);

                                                                e.dataTransfer.setDragImage(dragImage, newSize / 2, newSize / 2);

                                                                setTimeout(() => {
                                                                    if (document.body.contains(dragImage)) {
                                                                        document.body.removeChild(dragImage);
                                                                    }
                                                                }, 0);
                                                            }
                                                        }
                                                    }}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        if (!draggedFrame || draggedFrame.animType !== animType) return;
                                                        const target = e.currentTarget;
                                                        const rect = target.getBoundingClientRect();
                                                        const x = e.clientX - rect.left;
                                                        const side = x < rect.width / 2 ? 'left' : 'right';
                                                        if (dragOverState?.index !== frameIndex || dragOverState?.side !== side) {
                                                            setDragOverState({ animType, index: frameIndex, side });
                                                        }
                                                    }}
                                                    onDragLeave={() => setDragOverState(null)}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        if (dragOverState && draggedFrame && draggedFrame.animType === dragOverState.animType) {
                                                            const targetDropIndex = dragOverState.index + (dragOverState.side === 'right' ? 1 : 0);
                                                            handleFrameDrop(dragOverState.animType, targetDropIndex);
                                                        }
                                                        setDragOverState(null);
                                                    }}
                                                    onDragEnd={() => {
                                                        setDraggedFrame(null);
                                                        setDragOverState(null);
                                                    }}
                                                    onClick={() => setActiveAnim({ type: animType, frame: frameIndex })}
                                                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, animType, frameIndex }); setPixelEditorContextMenu(null); }}
                                                    className={`relative p-0.5 rounded-md transition-all duration-150 flex-shrink-0 
                                              ${activeAnim?.type === animType && activeAnim?.frame === frameIndex ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}
                                              ${draggedFrame?.animType === animType && draggedFrame?.index === frameIndex ? 'opacity-40 scale-75' : ''}`}
                                                >
                                                    <AssetIcon assetData={frameData} palette={displayPalette} />
                                                    {selectedAsset.animations![animType].length > 1 && (
                                                        <span onClick={(e) => { e.stopPropagation(); handleRemoveFrame(animType, frameIndex); }} className="absolute -top-1 -right-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center border-2 border-gray-700 font-sans cursor-pointer">×</span>
                                                    )}
                                                    {draggedFrame && draggedFrame.animType === animType && dragOverState?.animType === animType && dragOverState?.index === frameIndex && (
                                                        <div className={`absolute top-1 bottom-1 w-1 bg-yellow-300 rounded-full z-10
                                                  ${dragOverState.side === 'left' ? 'left-[-2px]' : 'right-[-2px]'}
                                              `} />
                                                    )}
                                                </button>
                                            ))}
                                            {draggedFrame && draggedFrame.animType === animType && (
                                                <div
                                                    className="relative w-8 h-8 flex-shrink-0"
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        const lastIndex = selectedAsset.animations![animType].length;
                                                        if (dragOverState?.index !== lastIndex) {
                                                            setDragOverState({ animType, index: lastIndex, side: 'left' });
                                                        }
                                                    }}
                                                    onDragLeave={() => setDragOverState(null)}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        handleFrameDrop(animType, selectedAsset.animations![animType].length);
                                                        setDragOverState(null);
                                                        setDraggedFrame(null);
                                                    }}
                                                >
                                                    {dragOverState?.animType === animType && dragOverState.index === selectedAsset.animations![animType].length && (
                                                        <div className="absolute top-1 bottom-1 w-1 bg-yellow-300 rounded-full z-10 left-[-2px]" />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <button onClick={() => handleAddFrame(animType)} className="w-8 h-8 flex-shrink-0 bg-green-600 hover:bg-green-700 rounded-md text-white font-bold text-xl">+</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

const PhysicsPanel: React.FC<Pick<AssetEditorProps, 'physics' | 'onPhysicsChange' | 'editorState' | 'onThemeChange' | 'onLoadGame'>> = ({ physics, onPhysicsChange, editorState, onThemeChange, onLoadGame }) => (
    <div className="space-y-3">
        <div>
            <label htmlFor="speed-slider" className="flex justify-between text-sm font-medium text-gray-300 mb-1"><span>Run Speed</span><span>{physics.playerSpeed.toFixed(1)}</span></label>
            <input id="speed-slider" type="range" min="0.5" max="4" step="0.1" value={physics.playerSpeed} onChange={(e) => onPhysicsChange({ playerSpeed: parseFloat(e.target.value) })} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" />
        </div>
        <div>
            <label htmlFor="jump-slider" className="flex justify-between text-sm font-medium text-gray-300 mb-1"><span>Jump Height</span><span>{(-physics.jumpForce).toFixed(1)}</span></label>
            <input id="jump-slider" type="range" min="2" max="8" step="0.1" value={-physics.jumpForce} onChange={(e) => onPhysicsChange({ jumpForce: -parseFloat(e.target.value) })} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" />
        </div>
        <div>
            <label htmlFor="friction-slider" className="flex justify-between text-sm font-medium text-gray-300 mb-1"><span>Drag</span><span>{(physics.friction * 100).toFixed(0)}%</span></label>
            <input id="friction-slider" type="range" min="0" max="50" step="1" value={physics.friction * 100} onChange={(e) => onPhysicsChange({ friction: parseFloat(e.target.value) / 100 })} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" />
        </div>
        <div className="flex items-center justify-between pt-2">
            <label htmlFor="can-jump-checkbox" className="text-sm font-medium text-gray-300">Enable Jumping</label>
            <input id="can-jump-checkbox" type="checkbox" checked={physics.canJump} onChange={(e) => onPhysicsChange({ canJump: e.target.checked })} className="h-4 w-4 rounded border-gray-500 bg-gray-800 text-blue-600 focus:ring-blue-500" />
        </div>
        <div>
            <label htmlFor="gravity-slider" className="flex justify-between text-sm font-medium text-gray-300 mb-1"><span>Gravity</span><span>{physics.gravity.toFixed(2)}</span></label>
            <input id="gravity-slider" type="range" min="0.1" max="1.0" step="0.05" value={physics.gravity} onChange={(e) => onPhysicsChange({ gravity: parseFloat(e.target.value) })} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" />
        </div>
        <div>
            <label htmlFor="gameSpeed-slider" className="flex justify-between text-sm font-medium text-gray-300 mb-1"><span>Game Speed</span><span>{(physics.gameSpeed * 100).toFixed(0)}%</span></label>
            <input id="gameSpeed-slider" type="range" min="0.25" max="2" step="0.05" value={physics.gameSpeed} onChange={(e) => onPhysicsChange({ gameSpeed: parseFloat(e.target.value) })} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" />
        </div>
        <div className="pt-2 border-t border-gray-600">
            <label htmlFor="theme-select" className="block text-sm font-medium text-gray-300 mb-1 mt-2">Color Theme</label>
            <select id="theme-select" value={editorState.theme} onChange={(e) => onThemeChange(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-md px-2 py-1.5 text-sm text-white">
                {Object.keys(THEMES).map(key => <option key={key} value={key}>{THEMES[key].name}</option>)}
            </select>
        </div>
        <div className="border-t border-gray-600 mt-4 pt-4 flex gap-2 w-full">
            <button 
               onClick={async () => {
                   // Deep copy editor state to avoid mutability issues
                   const exportState = JSON.parse(JSON.stringify(editorState)) as EditorState;
                   const GAME_WIDTH = 128;
                   const GAME_HEIGHT = 128;

                   // Clamp level data to only include assets within the 128x128 screen
                   exportState.levels.forEach(level => {
                       level.levelData = level.levelData.filter(asset => 
                           asset.x >= 0 && asset.x < GAME_WIDTH && 
                           asset.y >= 0 && asset.y < GAME_HEIGHT
                       );
                   });

                   const blob = new Blob([JSON.stringify(exportState)], { type: "application/json" });
                   const url = URL.createObjectURL(blob);
                   const dlAnchorElem = document.createElement('a');
                   dlAnchorElem.setAttribute("href", url);
                   dlAnchorElem.setAttribute("download", "save.json");
                   document.body.appendChild(dlAnchorElem);
                   dlAnchorElem.click();
                   document.body.removeChild(dlAnchorElem);
                   URL.revokeObjectURL(url);
               }} 
               className="flex-1 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
               title="Downloads only assets within the 128x128 visible area."
            >
                Download save.json
            </button>
            <input 
                type="file" 
                id="load-local-save"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const result = event.target?.result as string;
                            const loadedState = JSON.parse(result) as EditorState;
                            if (loadedState.assets && loadedState.levels) {
                                onLoadGame({
                                    assets: loadedState.assets,
                                    levels: loadedState.levels,
                                    physics: physics
                                });
                            }
                        } catch (err) {
                            console.error("Failed to parse save file:", err);
                            alert("Invalid save file.");
                        }
                    };
                    reader.readAsText(file);
                    // Reset input so the same file can be loaded again if needed
                    e.target.value = '';
                }}
            />
            <button 
                onClick={() => document.getElementById('load-local-save')?.click()}
                className="flex-1 py-2 text-sm font-bold bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                title="Load a save.json file."
            >
                Load save.json
            </button>
        </div>
    </div>
);

const LevelPanel: React.FC<Pick<AssetEditorProps, 'editorState' | 'onAddLevel' | 'onDeleteLevel' | 'onSelectLevel' | 'onRenameLevel' | 'onReorderLevel' | 'onSetLevelIntroText'>> = ({ editorState, onAddLevel, onDeleteLevel, onSelectLevel, onRenameLevel, onReorderLevel, onSetLevelIntroText }) => {
    const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
    const [editingTextIndex, setEditingTextIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const dragIndexRef = useRef<number | null>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (renamingIndex !== null && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingIndex]);

    useEffect(() => {
        if (editingTextIndex !== null && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [editingTextIndex]);

    const handleRenameCommit = (index: number, newName: string) => {
        onRenameLevel(index, newName);
        setRenamingIndex(null);
    };

    return (
        <div className="flex flex-col gap-3">
            <ul className="space-y-2 flex-grow overflow-y-auto max-h-96 pr-1">
                {editorState.levels.map((level, index) => (
                    <li
                        key={level.id}
                        draggable
                        onClick={() => onSelectLevel(index)}
                        onDragStart={(e) => { dragIndexRef.current = index; e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIndex(index); }}
                        onDragLeave={() => setDragOverIndex(null)}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
                                onReorderLevel(dragIndexRef.current, index);
                            }
                            setDragOverIndex(null);
                            dragIndexRef.current = null;
                        }}
                        onDragEnd={() => { setDragOverIndex(null); dragIndexRef.current = null; }}
                        className={`flex flex-col gap-1 p-2 rounded-md cursor-grab transition-colors ${
                            editorState.currentLevelIndex === index ? 'bg-blue-600' :
                            dragOverIndex === index ? 'bg-gray-500 ring-2 ring-blue-400' :
                            'bg-gray-800 hover:bg-gray-700'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-xs select-none">⣿</span>
                            <span className="text-sm text-white truncate">{index + 1}.</span>

                            {renamingIndex === index ? (
                                <input
                                    ref={renameInputRef}
                                    type="text"
                                    defaultValue={level.name}
                                    onBlur={(e) => handleRenameCommit(index, e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleRenameCommit(index, e.currentTarget.value);
                                        if (e.key === 'Escape') setRenamingIndex(null);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-28 bg-gray-900 text-white text-sm outline-none ring-1 ring-blue-400 rounded px-1"
                                />
                            ) : (
                                <span
                                    className="flex-grow text-white text-sm truncate px-1"
                                    onDoubleClick={() => setRenamingIndex(index)}
                                >
                                    {level.name}
                                </span>
                            )}

                            <button onClick={(e) => { e.stopPropagation(); setEditingTextIndex(editingTextIndex === index ? null : index); setRenamingIndex(null); }} className={`text-xs px-2 py-1 rounded text-white ${level.introText ? 'bg-blue-700 hover:bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`}>Text</button>
                            <button onClick={(e) => { e.stopPropagation(); setRenamingIndex(index); setEditingTextIndex(null); }} className="text-xs px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 text-white">Rename</button>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteLevel(index); }} disabled={editorState.levels.length <= 1} className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:bg-gray-500 disabled:cursor-not-allowed">Del</button>
                        </div>

                        {editingTextIndex === index && (
                            <div draggable={false} onClick={(e) => e.stopPropagation()} className="w-full mt-1">
                                <textarea
                                    ref={textareaRef}
                                    maxLength={250}
                                    defaultValue={level.introText || ''}
                                    placeholder="Intro text shown before this level..."
                                    rows={3}
                                    draggable={false}
                                    className="w-full bg-gray-900 text-white text-xs outline-none ring-1 ring-blue-400 rounded px-2 py-1 resize-none"
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Escape') setEditingTextIndex(null);
                                    }}
                                />
                                <div className="flex items-center justify-between mt-1">
                                    <span className="text-xs text-gray-400">max 250 chars</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (textareaRef.current) onSetLevelIntroText(index, textareaRef.current.value);
                                            setEditingTextIndex(null);
                                        }}
                                        className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
            <button onClick={onAddLevel} className="w-full py-2 text-sm font-bold bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">Add New Level</button>
        </div>
    );
};


const AssetEditor: React.FC<AssetEditorProps> = (props) => {
    const [activePanel, setActivePanel] = useState<'ASSET' | 'PHYSICS' | 'LEVEL'>('ASSET');
    const { editorState, gameMode } = props;

    return (
        <div className="bg-gray-700 rounded-lg shadow-lg h-full flex flex-col overflow-hidden">
            <div className={`flex-grow flex flex-col min-h-0 transition-opacity duration-300 ${gameMode === 'PLAY' ? 'opacity-50 pointer-events-none' : ''}`}>

                <div className="flex-shrink-0 flex border-b border-gray-600">
                    <button
                        onClick={() => setActivePanel('ASSET')}
                        className={`flex-1 py-3 text-sm font-bold text-center transition-colors ${activePanel === 'ASSET' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-600'}`}
                    >
                        Assets
                    </button>
                    <button
                        onClick={() => setActivePanel('LEVEL')}
                        className={`flex-1 py-3 text-sm font-bold text-center transition-colors border-l border-gray-600 ${activePanel === 'LEVEL' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-600'}`}
                    >
                        Levels
                    </button>
                    <button
                        onClick={() => setActivePanel('PHYSICS')}
                        className={`flex-1 py-3 text-sm font-bold text-center transition-colors border-l border-r border-gray-600 ${activePanel === 'PHYSICS' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-600'}`}
                    >
                        World
                    </button>
                </div>

                <div className="flex-grow p-4 overflow-y-auto">
                    {activePanel === 'ASSET' && <AssetPanel {...props} />}
                    {activePanel === 'PHYSICS' && <PhysicsPanel {...props} />}
                    {activePanel === 'LEVEL' && <LevelPanel {...props} />}
                </div>
            </div>
        </div>
    );
};

export default AssetEditor;