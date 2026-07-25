import WatchFolder from "./WatchFolder";
import Icon from "./Icon";

export default function SettingsModal({ onClose, initialDir, initialDataDir, initialRoots, onScanDone }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <WatchFolder
          initialDir={initialDir}
          initialDataDir={initialDataDir}
          initialRoots={initialRoots}
          onScanDone={onScanDone}
          embedded
        />
      </div>
    </div>
  );
}
