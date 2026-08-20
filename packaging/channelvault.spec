# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — bundles the Flask backend, the built React UI and the
# userscript into a single self-contained executable.
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [
    (os.path.join(ROOT, "frontend", "dist"), "static"),
    (os.path.join(ROOT, "userscript"), "userscript"),
]

a = Analysis(
    [os.path.join(ROOT, "backend", "tracker.py")],
    pathex=[os.path.join(ROOT, "backend")],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "watchdog.observers.inotify",
        "watchdog.observers.polling",
        "PIL.Image",
        "PIL._imaging",
    ],
    excludes=["tkinter", "matplotlib", "numpy", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="channelvault",
    console=True,
    strip=False,
    upx=True,
    icon=None,
)
