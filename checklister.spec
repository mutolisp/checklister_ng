# -*- mode: python ; coding: utf-8 -*-
import subprocess, os

block_cipher = None

# 自動找到 pandoc 路徑
pandoc_path = subprocess.check_output(['which', 'pandoc']).decode().strip()
pandoc_real = os.path.realpath(pandoc_path)

a = Analysis(['run.py'],
             pathex=[],
             binaries=[(pandoc_real, '.')],
             datas=[('backend/twnamelist.db', 'backend'),
                   ('backend/api/reference.docx', 'backend/api'),
                   ('frontend/build', 'frontend/build'),
                   ('references/key_to_sp', 'references/key_to_sp'),
                   ('icons/checklister-ng_trayicon.png', 'icons'),
                   ('icons/tray_22.png', 'icons'),
                   ('icons/tray_44.png', 'icons')],
             hiddenimports=['slowapi', 'slowapi.errors', 'slowapi.util',
                           'limits', 'limits.strategies', 'limits.storage',
                           'pystray', 'pystray._darwin', 'PIL'],
             hookspath=[],
             runtime_hooks=[],
             excludes=['PyQt6', 'PySide6', 'numpy', 'IPython',
                       'jedi', 'parso', 'pygments', 'zmq', 'nbformat',
                       'jsonschema', 'cryptography', 'bcrypt'],
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
          console=False)
coll = COLLECT(exe,
               a.binaries,
               a.zipfiles,
               a.datas,
               strip=False,
               upx=True,
               upx_exclude=[],
               name='checklister')
app = BUNDLE(coll,
             name='checklister-ng.app',
             icon='icons/checklister-ng.icns',
             bundle_identifier='org.checklister.ng')
