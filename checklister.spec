# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(['run.py'],
             pathex=[],
             binaries=[],
             datas=[('backend/twnamelist.db', 'backend'),
                   ('backend/api/reference.docx', 'backend/api')],
             hiddenimports=[],
             hookspath=[],
             runtime_hooks=[],
             excludes=['PyQt6', 'PySide6'],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher,
             noarchive=False)
pyz = PYZ(a.pure, a.zipped_data,
             cipher=block_cipher)
exe = EXE(pyz,
          a.scripts,
          [],
          exclude_binaries=True,
          name='checklister',
          debug=False,
          bootloader_ignore_signals=False,
          strip=False,
         upx=True,
         console=False)  # disable console window on macOS
coll = COLLECT(exe,
               a.binaries,
               a.zipfiles,
               a.datas,
               strip=False,
               upx=True,
               upx_exclude=[],
               name='checklister')
app = BUNDLE(coll,
             name='checklister-ng.app')  # produce macOS .app bundle
