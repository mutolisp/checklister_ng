# Windows 安裝說明

## 使用打包好的 exe

1. 下載 `checklister-ng.exe`
2. 雙擊執行，瀏覽器會自動開啟 `http://127.0.0.1:8964`

### 常見問題

**「Windows 已保護您的電腦」（SmartScreen）**

因為 exe 未經 Microsoft 簽章，Windows 會阻擋：
1. 點「更多資訊」
2. 點「仍要執行」

**防毒軟體誤報**

部分防毒軟體可能標記 PyInstaller 打包的 exe，可將 `checklister-ng.exe` 加入排除清單。

---

## 從原始碼編譯

### 1. 安裝必要軟體

開啟 **PowerShell**（建議以**系統管理員**身分執行）：

```powershell
# Python 3.12（3.11 亦可）
winget install Python.Python.3.12

# Node.js LTS
winget install OpenJS.NodeJS.LTS

# Pandoc（DOCX 匯出用）
winget install JohnMacFarlane.Pandoc
```

安裝完成後**重開 PowerShell**，確認：

```powershell
python --version    # 應顯示 3.12.x
node --version      # 應顯示 v18+ 或 v20+
pandoc --version
```

### 2. PowerShell 執行原則

如果遇到 `無法載入檔案...因為這個系統上已停用指令碼執行` 錯誤：

```powershell
# 以系統管理員身分開啟 PowerShell，執行：
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

輸入 `Y` 確認。

### 3. 建立 Python 虛擬環境

```powershell
cd C:\path\to\checklister-ng

# 建立虛擬環境
py -3.12 -m venv backend\venv

# 啟用虛擬環境
backend\venv\Scripts\activate

# 如果上一步無法執行，則改用：
backend\venv\Scripts\activate.bat

# 安裝依賴
python.exe install --upgrade pip
pip.exe install -r requirements.txt
```

#### 如果遇到 Rust/Cargo 錯誤

`rapidfuzz` 或 `pydantic-core` 可能需要編譯。確認用的是 **Python 3.12**（不是 3.13/3.14），這些套件有預編譯的 wheel：

```powershell
python.exe --version
# 如果不是 3.12，重新建 venv：
python.exe -3.12 -m venv backend\venv
```

### 4. 編譯前端

```powershell
cd frontend
npm install
npm run build
cd ..
```

### 5. 啟動開發模式

```powershell
# 確認在虛擬環境中（提示符有 (venv)）
python.exe run.py --port 8964
```

瀏覽器會自動開啟 `http://127.0.0.1:8964`。

### 6. 打包 exe

```powershell
# 安裝 PyInstaller
pip.exe install pyinstaller

# 打包
pyinstaller.exe checklister_win32.spec --clean -y

# 產出位置
# dist\checklister-ng.exe
```

### 7. 讓其他裝置連線（手機/同網段電腦）

```powershell
python.exe run.py --host 0.0.0.0 --port 8964
```

需要開放防火牆：

```powershell
# 以系統管理員身分執行
netsh advfirewall firewall add rule name="checklister-ng" dir=in action=allow protocol=TCP localport=8964
```

手機在同一個 Wi-Fi 下，開啟 `http://你的電腦IP:8964`。

查看電腦 IP：

```powershell
ipconfig | findstr "IPv4"
```

---

## 移除防火牆規則

```powershell
netsh advfirewall firewall delete rule name="checklister-ng"
```

## 移除 ExecutionPolicy 設定

```powershell
Set-ExecutionPolicy -ExecutionPolicy Restricted -Scope CurrentUser
```
