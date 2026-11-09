import { useState } from "react";
import WatchFolder from "./WatchFolder";
import YtdlpSettings from "./YtdlpSettings";
import AppearanceSettings from "./AppearanceSettings";
import ProfileSettings from "./ProfileSettings";
import Icon from "./Icon";
import { useEscape } from "../lib/useEscape";

const TABS = [
  { id: "library",    label: "Library",    icon: "folder" },
  { id: "profiles",   label: "Profiles",   icon: "users" },
  { id: "youtube",    label: "YouTube",    icon: "download" },
  { id: "appearance", label: "Appearance", icon: "palette" },
];

export default function SettingsModal({ onClose, initialDir, initialDataDir, initialRoots, onScanDone, onProfilesChanged, rating, onRatingSaved, initialTab = "library", onQuit }) {
  useEscape(onClose);
  const [quitAsk, setQuitAsk] = useState(false);
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-settings">
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="settings-layout">
          <nav className="settings-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`settings-tab${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <Icon name={t.icon} size={15} />{t.label}
              </button>
            ))}
            {onQuit && (quitAsk ? (
              <div className="settings-quit-ask">
                <span>Stop ChannelVault?</span>
                <button className="btn-secondary" onClick={() => setQuitAsk(false)}>Cancel</button>
                <button className="btn-danger" autoFocus onClick={onQuit}>Quit</button>
              </div>
            ) : (
              <button className="settings-tab settings-quit" onClick={() => setQuitAsk(true)} title="Stop the backend and close the app">
                <Icon name="power" size={15} />Quit
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {tab === "library" && (
              <WatchFolder
                initialDir={initialDir}
                initialDataDir={initialDataDir}
                initialRoots={initialRoots}
                onScanDone={onScanDone}
                embedded
              />
            )}
            {tab === "profiles" && (
              <div className="watch-folder-body">
                <ProfileSettings onChanged={onProfilesChanged} />
              </div>
            )}
            {tab === "youtube" && (
              <div className="watch-folder-body">
                <YtdlpSettings />
              </div>
            )}
            {tab === "appearance" && (
              <div className="watch-folder-body">
                <AppearanceSettings rating={rating} onRatingSaved={onRatingSaved} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
