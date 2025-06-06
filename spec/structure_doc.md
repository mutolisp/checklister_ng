**Repository Overview**

```
/checklister_ng
├── backend/       → FastAPI backend
│   ├── main.py
│   ├── api/
│   ├── models/
│   ├── db.py
│   ├── utils/
│   └── twnamelist.db  (SQLite database)
└── frontend/      → Svelte-based frontend
    ├── src/
    ├── package.json
    └── ...
```

### Backend

*FastAPI application*
- `backend/main.py` initializes the API and registers three routers: search, name resolution, and export
- Models (`backend/models/schema.py`) map to SQLite tables like `dao_plant_type` and `dao_pnamelist_pg`
- Search endpoint `/api/search` performs SQL queries to match names, families, etc.
- Name resolution endpoint (`/api/resolve_name`) can handle batches and tries to find the best match for a given Chinese name.
- The export router provides a detailed API for generating checklists in YAML/CSV/Markdown/DOCX formats. Its description explains the allowed formats and return values, while the function builds grouped output and optionally converts to DOCX using Pandoc
- `backend/utils/mapper.py` maps internal field names to Darwin Core terms for export

*Database*
- A prepopulated SQLite database (`twnamelist.db`) contains tables with plant names. Example structure: `dao_pnamelist_pg` holds `id`, `family`, `name`, etc.
- Access functions in `db.py` create SQLModel sessions using that database.

### Frontend

*SvelteKit application*
- `frontend/package.json` and typical Svelte config files set up a Svelte + Vite project (see `frontend/README.md` for base instructions).
- Components in `frontend/src/lib` include:
  - `SearchBox.svelte` – debounced search that calls `/api/search` and lets a user pick species
  - `SpeciesTable.svelte` – sortable/paginated table for currently selected species
  - `LoadYAMLButton.svelte` and `importer.ts` – read YAML/Plain text, parse, resolve names via `/api/resolve_name`, merge results, and update the store
  - `MapEditor.svelte` – optional geometry tool using Leaflet for drawing shapes.
- Stores under `frontend/src/stores` manage selected species data and persist to `localStorage`

*Pages*
- `src/routes/+page.svelte` is the main interface: uses the components above to build and export a checklist. It also has a dropdown to download results via the backend export endpoint.
- `src/routes/documentation/+page.svelte` embeds the FastAPI `/docs` page in an iframe.

### Typical Development Flow

1. **Backend**  
   Activate the Python environment (see `establish.sh` for setup instructions) and run:
   ```bash
   uvicorn backend.main:app --reload
   ```
2. **Frontend**  
   Inside `frontend`, install dependencies then start the dev server:
   ```bash
    npm install
    npm run dev
    ```
    The UI connects to the backend endpoints described above.

### Packaging

`run.py` boots the backend using Uvicorn and accepts optional `--host` and `--port` arguments.

```bash
python run.py --port 8964
```

Build a standalone executable with PyInstaller using the provided spec file. The spec already defines the build mode:

```bash
pyinstaller checklister.spec
```

This creates `dist/checklister-ng.app` (on macOS) alongside the command‐line
binary in `dist/checklister`. Run the binary with the same options to change the
listening port:

```bash
./dist/checklister --port 8964
```

### Learning Pointers

- **FastAPI** – Understand router registration and dependency injection (`Depends(get_session)` in resolve_name.py).
- **SQLModel** – For interacting with the SQLite database; note how models map to existing tables.
- **SvelteKit** – The frontend uses Svelte’s store pattern and Flowbite components. See how the main page composes SearchBox, SpeciesTable, etc.
- **Data flow** – SearchBox → add to store → display table → export via backend. Importer.ts shows how YAML (Darwin Core format) can be read and converted.
- **Export formats** – Study `backend/api/export.py` to learn how Markdown, DOCX, YAML, and CSV outputs are constructed and zipped.

This repository demonstrates a full-stack approach to building plant species checklists: a FastAPI backend serving a search and export API backed by SQLite, and a Svelte frontend for interacting with that data. Potential next steps include exploring the Leaflet map integration, customizing export styling via Pandoc, or extending the API/database schema for more features.
