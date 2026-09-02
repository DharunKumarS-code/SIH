import React from 'react';
import './Building360Controls.css';

export default function Building360Controls({ onPause, onResume, onExit, paused }) {
  return (
    <div className="building-360-controls">
      <button className="control-button" onClick={paused ? onResume : onPause}>
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button className="control-button" onClick={onExit}>Exit 360°</button>
    </div>
  );
}
