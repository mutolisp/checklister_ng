# Checklister mobile app — common commands.
#
# Usage: `make <target>` (default is `help`).
#
# Build vs dev distinction:
#   - dev (local Gradle/Xcode): debug build, hot reload, fast iterate
#   - eas / preview / production: cloud build via EAS, real APK/IPA artifacts

EAS := npx eas-cli@latest
EXPO := npx expo

.PHONY: help \
        start \
        build-android-dev build-android-release \
        build-ios build-ios-device build-ios-release list-ios-devices \
        check-ios-team \
        build-android-eas build-ios-eas \
        build-android-prod build-ios-prod \
        submit-ios submit-android \
        prebuild prebuild-clean \
        secrets typecheck \
        icons \
        clean

# 實機部署：跑 `make list-ios-devices` 取得 device 名稱（含 UDID），然後：
#   make build-ios-device                          # 互動式挑選
#   make build-ios-device IOS_DEVICE="My iPhone"   # 直接指定
IOS_DEVICE ?=

# Expected Apple Developer team for device signing: National Taiwan
# University(EDU). `expo prebuild --clean` wipes DEVELOPMENT_TEAM (it is not in
# app.config.ts), which silently reverts signing to the personal team and signs
# with the wrong certificate. `check-ios-team` guards against that.
IOS_TEAM := R6QJPK552H
IOS_PBXPROJ := ios/Checklister.xcodeproj/project.pbxproj

# 專案根目錄與 venv python（icons 產生需要 Pillow）
PROJECT_ROOT := $(abspath $(CURDIR)/../..)
VENV_PY     := $(PROJECT_ROOT)/backend/venv/bin/python

help:
	@echo "Checklister mobile — make targets"
	@echo ""
	@echo "  Local dev (debug, hot reload)"
	@echo "    start                  Metro bundler only"
	@echo "    build-android-dev      Build + install on Android emulator/device (debug, local Gradle)"
	@echo "    build-ios              Build + install on iOS simulator (debug, local Xcode)"
	@echo "    build-ios-device       Build + install on a connected physical iPhone"
	@echo "                           Set IOS_DEVICE=\"My iPhone\" to skip the picker"
	@echo "    list-ios-devices       List connected iOS devices + simulators"
	@echo ""
	@echo "  Local Release build (JS bundle 編入 .app/.apk，可離線跑、無需 Metro)"
	@echo "    build-android-release  Build + install release APK on Android device"
	@echo "    build-ios-release      Build + install release .app on physical iPhone"
	@echo "                           Set IOS_DEVICE=\"My iPhone\" to skip the picker"
	@echo ""
	@echo "  EAS cloud build (preview profile = internal APK/IPA for testing)"
	@echo "    build-android-eas      Submit Android preview build to EAS"
	@echo "    build-ios-eas          Submit iOS preview build to EAS"
	@echo ""
	@echo "  EAS production build (release, AAB for Play Store / IPA for App Store)"
	@echo "    build-android-prod     Submit Android production build"
	@echo "    build-ios-prod         Submit iOS production build"
	@echo ""
	@echo "  Submit production build to App Store Connect / Play Console"
	@echo "    submit-ios             Upload latest production IPA → TestFlight / App Store"
	@echo "    submit-android         Upload latest production AAB → Play Console"
	@echo ""
	@echo "  Utilities"
	@echo "    prebuild               Regenerate android/ + ios/ from app.config.ts"
	@echo "    prebuild-clean         Same, but wipe existing native folders first"
	@echo "    secrets                List configured EAS Secrets"
	@echo "    typecheck              tsc --noEmit"
	@echo "    icons                  Regenerate app icons / splash / favicon from"
	@echo "                           icons/mobile/checklister_mobile-logo.png"
	@echo "    clean                  Remove metro cache + node_modules/.cache"

# ── Local dev ─────────────────────────────────────────────────────────────
start:
	$(EXPO) start --dev-client

build-android-dev:
	$(EXPO) run:android

build-ios:
	$(EXPO) run:ios

check-ios-team:
	@team=$$(grep -m1 'DEVELOPMENT_TEAM' "$(IOS_PBXPROJ)" | sed -E 's/.*= *([A-Z0-9]+);.*/\1/'); \
	if [ "$$team" != "$(IOS_TEAM)" ]; then \
		echo "✗ DEVELOPMENT_TEAM is '$$team', expected '$(IOS_TEAM)' (NTU)."; \
		echo "  Likely a 'prebuild --clean' reverted signing to the personal team."; \
		echo "  Open ios/Checklister.xcworkspace → Signing & Capabilities → set Team"; \
		echo "  to National Taiwan University(EDU), then rebuild."; \
		exit 1; \
	fi; \
	echo "✓ DEVELOPMENT_TEAM = $(IOS_TEAM) (NTU)"

build-ios-device: check-ios-team
	@if [ -z "$(IOS_DEVICE)" ]; then \
		$(EXPO) run:ios --device; \
	else \
		$(EXPO) run:ios --device "$(IOS_DEVICE)"; \
	fi

list-ios-devices:
	@xcrun xctrace list devices 2>&1 | head -40

# ── Local Release builds (offline-capable, no Metro dev server needed) ───
build-android-release:
	$(EXPO) run:android --variant release

build-ios-release: check-ios-team
	@if [ -z "$(IOS_DEVICE)" ]; then \
		$(EXPO) run:ios --device --configuration Release; \
	else \
		$(EXPO) run:ios --device "$(IOS_DEVICE)" --configuration Release; \
	fi

# ── EAS cloud build (preview / production) ───────────────────────────────
build-android-eas:
	$(EAS) build --profile preview --platform android

build-ios-eas:
	$(EAS) build --profile preview --platform ios

build-android-prod:
	$(EAS) build --profile production --platform android

build-ios-prod:
	$(EAS) build --profile production --platform ios

# ── Submit production build to stores ────────────────────────────────────
# iOS: 上傳至 App Store Connect，在後台選擇 TestFlight 或正式 App Store 發佈
# Android: 上傳至 Play Console（internal/closed/open testing 或正式 release）
submit-ios:
	$(EAS) submit --platform ios --profile production

submit-android:
	$(EAS) submit --platform android --profile production

# ── Utilities ─────────────────────────────────────────────────────────────
prebuild:
	$(EXPO) prebuild

prebuild-clean:
	$(EXPO) prebuild --clean

secrets:
	$(EAS) secret:list

typecheck:
	npx tsc --noEmit

icons:
	$(VENV_PY) $(PROJECT_ROOT)/icons/gen_mobile_icons.py

clean:
	rm -rf node_modules/.cache .expo
	watchman watch-del-all 2>/dev/null || true
