#!/bin/bash
#
# Xcode Cloud post-clone hook.
#
# The native iOS project (Checklister.xcworkspace / .xcodeproj) is committed,
# but Pods/ is gitignored (see mobile/app/ios/.gitignore), so CocoaPods must be
# regenerated on the CI machine before the build's "Resolve package
# dependencies" step. Xcode Cloud requires this script to live next to the
# workspace at ios/ci_scripts/ci_post_clone.sh and runs it right after cloning.
#
set -e
echo "▸ ci_post_clone.sh: installing toolchain + CocoaPods"

# This script lives at mobile/app/ios/ci_scripts/. Hop up to the JS project
# root (mobile/app) where package.json lives, regardless of the CWD Xcode
# Cloud invokes us from.
cd "$(dirname "$0")/../.."

# Xcode Cloud images don't ship a usable Node by default; install it + pods.
brew install node cocoapods

# JS deps are required for Expo's CocoaPods autolinking. Lockfile is committed,
# so use `npm ci` for a reproducible install (swap to `npm install` if the
# lockfile ever drifts from package.json).
npm ci

# Regenerate Pods from the committed Podfile.lock.
# CI="true" guards against Expo's "GetEnv.NoBoolean: TRUE is not a boolean"
# crash: Xcode Cloud sets CI=TRUE (uppercase), which Expo's config reader
# rejects when expo-modules-autolinking evaluates app config during pod install.
cd ios
CI="true" pod install
