# -*- mode: python ; coding: utf-8 -*-
import subprocess, os, shutil, struct

block_cipher = None

# 找到 pandoc 路徑 (Windows)
# Chocolatey 的 shim 不是真正的 pandoc binary，需要找到實際路徑
def _find_real_pandoc():
    """解析真正的 pandoc.exe 路徑，避免打包 Chocolatey shim"""
    candidates = [
        # Chocolatey 實際安裝位置
        os.path.join(os.environ.get('ChocolateyInstall', r'C:\ProgramData\chocolatey'),
                     'lib', 'pandoc', 'tools', 'pandoc.exe'),
        # 使用者本機安裝
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Pandoc', 'pandoc.exe'),
        # 系統全域安裝
        r'C:\Program Files\Pandoc\pandoc.exe',
    ]
    # 先檢查 shutil.which 找到的是否為真正的 binary（非 shim）
    which_path = shutil.which('pandoc')
    if which_path:
        real = os.path.realpath(which_path)
        # Chocolatey shim 通常小於 100KB，真正的 pandoc 超過 50MB
        if os.path.isfile(real) and os.path.getsize(real) > 1_000_000:
            return real
        # shutil.which 找到的是 shim，嘗試用 shim 的 --version 找真正路徑
        # 改為直接搜尋已知路徑
    for p in candidates:
        if os.path.isfile(p) and os.path.getsize(p) > 1_000_000:
            return p
    # 最後 fallback：即使是 shim 也包進去（讓 build 不會中斷）
    return which_path or r'C:\Program Files\Pandoc\pandoc.exe'

pandoc_path = _find_real_pandoc()
print(f"[checklister_win32.spec] Bundling pandoc from: {pandoc_path} "
      f"(size: {os.path.getsize(pandoc_path) if os.path.isfile(pandoc_path) else 'NOT FOUND'})")

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
