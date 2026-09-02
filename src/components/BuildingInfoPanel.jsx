import React from 'react';
import './BuildingInfoPanel.css';

export default function BuildingInfoPanel({ title, properties, onClose, onFocus, onEnter360 }) {
  const renderRows = () => {
    return Object.entries(properties).map(([key, value]) => {
      // Skip empty values
      if (value === undefined || value === null || value === '') return null;
      // If value is object, stringify safely
      let display = value;
      if (typeof value === 'object') {
        try {
          display = JSON.stringify(value);
        } catch (_) {
          display = String(value);
        }
      }
      return (
        <tr key={key}>
          <td className="property-key">{key}</td>
          <td className="property-value">{display}</td>
        </tr>
      );
    });
  };

  return (
    <div className="building-info-panel">
      <header className="panel-header">
        <h2 className="panel-title">{title || 'Selected Building'}</h2>
        <button className="close-button" onClick={onClose}>×</button>
      </header>
      <div className="panel-content">
        <table className="properties-table">
          <tbody>{renderRows()}</tbody>
        </table>
      </div>
      <footer className="panel-footer">
        <button className="action-button" onClick={onFocus}>Focus Building</button>
        <button className="action-button" onClick={onEnter360}>360° View</button>
      </footer>
    </div>
  );
}
