import React, { useState } from 'react';
import { parseCSV } from '../lib/csvImport.js';

export default function CSVImportModal({ onClose, onImport }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [name, setName] = useState('CUSTOM');

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const filename = file.name.replace(/\.(csv|txt)$/i, '');
    setName(filename.toUpperCase().slice(0, 12));
    const reader = new FileReader();
    reader.onload = ev => setText(ev.target.result);
    reader.readAsText(file);
  }

  function handleImport() {
    setErr('');
    try {
      const bars = parseCSV(text);
      onImport({ symbol: name, bars });
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Importar CSV</h3>
        <p>
          Descarga datos históricos desde Yahoo Finance (ej. <code style={{ color: '#e8b86a' }}>COPEC.SN</code> → Historical Data → Download).
          Acepta formatos con columnas <code>Date, Open, High, Low, Close, Volume</code>.
        </p>

        <div className="field">
          <label>Símbolo (etiqueta)</label>
          <input value={name} onChange={e => setName(e.target.value.toUpperCase().slice(0, 12))} />
        </div>

        <div className="field">
          <label>Subir archivo</label>
          <input type="file" accept=".csv,.txt" onChange={handleFile} />
        </div>

        <div className="field">
          <label>O pegar contenido CSV</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Date,Open,High,Low,Close,Adj Close,Volume&#10;2024-05-12,150.50,151.20,149.80,150.95,150.95,12500000&#10;..."
          />
        </div>

        {err && <div className="err">{err}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={!text}>Importar</button>
        </div>
      </div>
    </div>
  );
}
