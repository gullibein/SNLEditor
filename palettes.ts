import { INITIAL_PALETTE } from './constants';
import type { ColorTheme } from './types';

export const THEMES: Record<string, ColorTheme> = {
    'pixel-pro': { 
        name: 'Pixel Pro', 
        palette: INITIAL_PALETTE,
        textColorIndex: 4, // White
    },
    'vga': {
        name: 'VGA Classic',
        screenEffect: 'crt-effect vga-effect',
        palette: [
            '#00000000', // 0: Transparent
            '#0000AA',   // 1: Blue
            '#00AA00',   // 2: Green
            '#004848',   // 3: Dark Cyan
            '#AA0000',   // 4: Red
            '#AA00AA',   // 5: Magenta
            '#AA5500',   // 6: Brown
            '#AAAAAA',   // 7: Light Gray
            '#000000',   // 8: Black (was Dark Gray)
            '#5555FF',   // 9: Light Blue
            '#55FF55',   // 10: Light Green
            '#55FFFF',   // 11: Light Cyan
            '#FF5555',   // 12: Light Red
            '#FF55FF',   // 13: Light Magenta
            '#FFFF55',   // 14: Yellow
            '#FFFFFF',   // 15: White
        ],
        textColorIndex: 15, // White
    },
    'cga': {
        name: 'CGA Mode 4',
        screenEffect: 'crt-effect cga-effect',
        palette: [
            '#00000000', // 0: Transparent
            '#000000',   // 1: Black
            '#55FFFF',   // 2: Cyan
            '#FF55FF',   // 3: Magenta
            '#FFFFFF',   // 4: White
        ],
        textColorIndex: 4, // White
    },
    'ibm-5151-green': {
        name: 'IBM 5151 Green',
        screenEffect: 'crt-effect mono-effect',
        palette: [
            '#00000000', // 0: Transparent
            '#000000',   // 1: Black
            '#1d4d19',   // 2: Darkest green
            '#24681c',   // 3
            '#2c831e',   // 4
            '#339e21',   // 5
            '#3ab823',   // 6
            '#42d326',   // 7
            '#49ee28',   // 8: Brightest green
        ],
        textColorIndex: 8, // Brightest Green
    }
};