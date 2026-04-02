import React, { useEffect } from 'react';
import { preloadSounds } from '../sounds';

interface SplashScreenProps {
  onStartGame: () => void;
  isLoadingAssets?: boolean;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onStartGame, isLoadingAssets = false }) => {
  useEffect(() => {
    // Don't allow starting the game if assets are still loading
    if (isLoadingAssets) return;

    const handleKeyPress = () => {
      preloadSounds(); // Initialize audio context and warm up buffers
      onStartGame();
    };

    window.addEventListener('keydown', handleKeyPress);
    window.addEventListener('mousedown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      window.removeEventListener('mousedown', handleKeyPress);
    };
  }, [onStartGame, isLoadingAssets]);

  return (
    <div className="splash-screen crt-effect" style={{ position: 'relative' }}>
      <img
        src="https://raw.githubusercontent.com/gullibein/Spikes-Ladders-assets-sounds/refs/heads/main/spikes%26ladderssplash.png"
        alt="Spikes & Ladders Splash Screen"
      />
      {isLoadingAssets && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#FFFFFF',
          fontSize: '8px',
          fontFamily: '"Press Start 2P", monospace',
          textShadow: '1px 1px 0px #000000',
          animation: 'pulse 1.5s ease-in-out infinite'
        }}>
          Loading sprites...
        </div>
      )}
    </div>
  );
};

export default SplashScreen;
