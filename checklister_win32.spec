# -*- mode: python ; coding: utf-8 -*-
import subprocess, os, shutil

block_cipher = None

# 找到 pandoc 路徑 (Windows)
pandoc_path = shutil.which('pandoc') or r'C:\Program Files\Pandoc\pandoc.exe'

a = Analysis(['run.py'],
             pathex=[],
             binaries=[(pandoc_path, '.')],
             datas=[('backend/twnamelist.db', 'backend'),
                   ('backend/api/reference.docx', 'backend/api'),
                   ('frontend/build', 'frontend/build')],
             hiddenimports=['slowapi', 'slowapi.errors', 'slowapi.util',
                           'limits', 'limits.strategies', 'limits.storage'],
             hookspath=[],
             runtime_hooks=[],
             excludes=['PyQt6', 'PySide6', 'PIL', 'numpy', 'IPython',
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
          a.binaries,
          a.zipfiles,
          a.datas,
          name='checklister-ng',
          debug=False,
          strip=False,
          upx=True,
          console=False)
