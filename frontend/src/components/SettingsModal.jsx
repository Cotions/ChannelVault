import { useState } from "react";
import WatchFolder from "./WatchFolder";
import YtdlpSettings from "./YtdlpSettings";
import AppearanceSettings from "./AppearanceSettings";
import ProfileSettings from "./ProfileSettings";
import Icon from "./Icon";

const TABS = [
  { id: "library",    label: "Library",    icon: "folder" },
  { id: "profiles",   label: "Profiles",   icon: "users" },
  { id: "youtube",    label: "YouTube",    icon: "download" },
  { id: "appearance", label: "Appearance", icon: "palette" },
];

export default function SettingsModal({ onClose, initialDir, initialDataDir, initialRoots, onScanDone, onProfilesChanged, initialTab = "library" }) {
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
                <AppearanceSettings />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
