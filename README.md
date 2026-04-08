# checklister-ng

次世代物種名錄產生器 — A next-generation species checklist generator

## 簡介

Checklister-NG 是一套整合臺灣物種名錄資料的名錄產生工具，支援所有生物類群（維管束植物、鳥類、昆蟲、真菌等）。主要功能包括：

- **物種搜尋**：支援俗名、學名、科名搜尋，含台/臺自動互換、模糊比對（Levenshtein distance）、同物異名自動解析
- **進階篩選**：高階分類群（14 個類群 icon）、階層篩選（綱/目/科/屬）、特有性、原生/歸化/入侵/栽培
- **名錄匯出**：Markdown、DOCX（Pandoc 轉換）、YAML（Darwin Core 格式）、CSV
- **多分類群匯出**：自動偵測分類群，各用預設階層排序（植物：類群→科→種；鳥類/昆蟲：目→科→種）
- **物種詳細資訊**：同物異名、外部連結（GBIF、TaiCOL、iNaturalist、Wikispecies、NCBI、IPNI、POWO 等）
- **分類樹瀏覽器**：7 層階層（界→門→綱→目→科→屬→種），可搜尋、自動展開
- **樣區地圖**：Leaflet 地圖編輯器，支援繪製點/線/面，匯入匯出 GPX/KML/WKT/GeoJSON
- **名錄比較**：2-10 份名錄比較，Sørensen/Jaccard 相似度、Shannon-Wiener/Simpson 多樣性指數
- **批次匯入**：貼上俗名/學名列表，自動比對、多筆確認、未收錄處理

本程式不擔保正確性，不承諾可以增加什麼功能，完全看我有沒有時間，全部佛系開發
歡迎 fork 回去加功能和 pull request 回饋，謝謝

## 技術架構

- **Backend**: Python 3.9-3.12 / FastAPI / SQLModel / SQLite
- **Frontend**: SvelteKit / Tailwind CSS / Flowbite / Leaflet

## 快速開始

```bash
# Backend
cd backend && ./setup.sh

# Frontend
cd frontend && npm install && npm run build

# 啟動
python run.py --port 8964

# 或使用 Makefile
make run
```

## 安裝打包

```zsh
make pkg-dmg    # macOS DMG
```

```
#進入python 3.12 virtual environment
py -3.12 -m venv backend\venv
backend\venv\Scripts\activate
# 安裝必要的相依套件
pip install -r requirements.txt
# npm 那些請用 winget install OpenJS.NodeJS.LTS
# 其他一樣cd frontend && npm install && npm run build
# 打包，記得要回到$checklister根目錄
pyinstaller checklister_win32.spec --clean -y
make pkg-win    # Windows EXE（需在 Windows ，建議用 powershell + winget 安裝必要的）
```

## TaiCOL 資料匯入

```bash
# 將 TaiCOL 名錄 CSV 放在 references/ 目錄
make taicol
# 或透過前端 /admin 頁面上傳 CSV
```

## 第三方授權與資料來源

### Pandoc

本程式使用 [Pandoc](https://pandoc.org/) 進行 Markdown 至 DOCX 的文件格式轉換。Pandoc 由 John MacFarlane 開發，以 **GPL-2.0-or-later** 授權釋出。

- Pandoc 官方網站：https://pandoc.org/
- Pandoc 原始碼：https://github.com/jgm/pandoc
- Pandoc 授權條款：https://github.com/jgm/pandoc/blob/main/COPYRIGHT

本程式透過命令列呼叫 Pandoc 作為獨立工具，未修改其原始碼。打包版本中包含 Pandoc binary 以方便使用者，使用者亦可自行安裝 Pandoc。

### TaiCOL 臺灣物種名錄

本程式使用之物種名錄資料來自 [TaiCOL 臺灣物種名錄](https://taicol.tw/)（Taiwan Catalogue of Life），由中央研究院生物多樣性研究中心維護。

- TaiCOL 官方網站：https://taicol.tw/
- TaiCOL API 文件：https://taicol.tw/zh-hant/api
- TaiCOL 資料下載：https://taicol.tw/zh-hant/download

使用者應遵循 TaiCOL 之資料使用規範。本程式提供 TaiCOL CSV 匯入功能，使用者需自行從 TaiCOL 網站下載最新名錄資料。

### 其他開源套件

本程式使用之主要開源套件及其授權：

| 套件 | 授權 | 用途 |
|------|------|------|
| FastAPI | MIT | Web API 框架 |
| SvelteKit | MIT | 前端框架 |
| Leaflet | BSD-2 | 地圖元件 |
| SQLModel | MIT | ORM |
| rapidfuzz | MIT | 模糊比對 |
| Flowbite Svelte | MIT | UI 元件 |

## 開發

本程式和 AI 協作工具共同完成，包括：

- [Claude](https://claude.ai/) (Anthropic)
- [Gemini](https://gemini.google.com/) (Google)
- [ChatGPT](https://chatgpt.com/) (OpenAI)


## 授權

本程式（不含 Pandoc binary 及 TaiCOL 資料）以 GPL 釋出。
