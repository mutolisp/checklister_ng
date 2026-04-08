VERSION     := 1.0.0
APP_NAME    := checklister-ng
DIST_DIR    := dist
FRONTEND    := frontend
PYTHON       := python3.11
BACKEND_VENV := backend/venv

# Platform detection
UNAME_S := $(shell uname -s)

# ─── Default ──────────────────────────────────────────────
.PHONY: all frontend backend pkg pkg-dmg pkg-win taicol clean help

all: backend frontend

help:
	@echo "Usage:"
	@echo "  make              Build backend venv + frontend"
	@echo "  make frontend     Build frontend only"
	@echo "  make backend      Setup backend venv + install deps"
	@echo "  make run          Start dev server (port 8964)"
	@echo "  make dev          Start backend + frontend dev servers"
	@echo "  make pkg          Build platform package (dmg on macOS)"
	@echo "  make pkg-dmg      Build macOS .app + .dmg"
	@echo "  make pkg-win      Build Windows .exe (run on Windows)"
	@echo "  make taicol        Import TaiCOL CSV (auto-find latest or CSV=path)"
	@echo "  make clean        Remove build artifacts"

# ─── Backend ──────────────────────────────────────────────
backend: $(BACKEND_VENV)/bin/activate

$(BACKEND_VENV)/bin/activate: requirements.txt
	$(PYTHON) -m venv $(BACKEND_VENV)
	$(BACKEND_VENV)/bin/pip install --upgrade pip
	$(BACKEND_VENV)/bin/pip install -r requirements.txt
	touch $@

# ─── Frontend ─────────────────────────────────────────────
frontend: $(FRONTEND)/build/index.html

$(FRONTEND)/build/index.html: $(FRONTEND)/package.json $(shell find $(FRONTEND)/src -type f 2>/dev/null)
	cd $(FRONTEND) && npm install && npm run build

# ─── Run ──────────────────────────────────────────────────
run: all
	$(BACKEND_VENV)/bin/python run.py --port 8964

dev:
	@echo "Starting backend (port 8964)..."
	$(BACKEND_VENV)/bin/uvicorn backend.main:app --reload --port 8964 &
	@echo "Starting frontend dev server..."
	cd $(FRONTEND) && npm run dev

# ─── Package (auto-detect platform) ──────────────────────
pkg:
ifeq ($(UNAME_S),Darwin)
	$(MAKE) pkg-dmg
else
	$(MAKE) pkg-win
endif

# ─── macOS DMG ────────────────────────────────────────────
pkg-dmg: frontend backend
	$(BACKEND_VENV)/bin/pip install -q pyinstaller
	$(BACKEND_VENV)/bin/pyinstaller checklister.spec --clean -y
	@echo "==> Creating DMG..."
	rm -rf $(DIST_DIR)/dmg-staging
	mkdir -p $(DIST_DIR)/dmg-staging
	cp -R $(DIST_DIR)/$(APP_NAME).app $(DIST_DIR)/dmg-staging/
	ln -s /Applications $(DIST_DIR)/dmg-staging/Applications
	rm -f $(DIST_DIR)/$(APP_NAME).dmg
	hdiutil create \
		-volname "$(APP_NAME)" \
		-srcfolder $(DIST_DIR)/dmg-staging \
		-ov -format UDZO \
		$(DIST_DIR)/$(APP_NAME).dmg
	rm -rf $(DIST_DIR)/dmg-staging
	@echo "==> Done: $(DIST_DIR)/$(APP_NAME).dmg"
	@du -sh $(DIST_DIR)/$(APP_NAME).dmg

# ─── Windows EXE ──────────────────────────────────────────
pkg-win: frontend
	pyinstaller checklister_win32.spec --clean -y
	@echo "==> Done: $(DIST_DIR)/$(APP_NAME).exe"

# ─── TaiCOL Import ────────────────────────────────────────
CSV ?= $(shell ls -t references/TaiCOL_name_*.csv 2>/dev/null | head -1)

taicol: backend
	@if [ -z "$(CSV)" ]; then echo "Error: No TaiCOL CSV found in references/"; exit 1; fi
	@echo "==> Importing TaiCOL from: $(CSV)"
	$(BACKEND_VENV)/bin/python -m backend.services.taicol_import "$(CSV)"

# ─── Clean ────────────────────────────────────────────────
clean:
	rm -rf build $(DIST_DIR) $(FRONTEND)/build
	rm -rf *.egg-info __pycache__
