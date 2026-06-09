import WatchFolder from "./WatchFolder";

export default function SettingsModal({ onClose, initialDir, initialDataDir, onScanDone }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <WatchFolder
          initialDir={initialDir}
          initialDataDir={initialDataDir}
          onScanDone={onScanDone}
          embedded
        />
      </div>
    </div>
  );
}
