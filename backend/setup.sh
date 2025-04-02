#!/usr/bin/env sh

echo "🔧 creating python virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo "📦 installing required packages..."
pip3 install --upgrade pip
pip3 install fastapi uvicorn sqlmodel pyyaml python-docx

echo "📝 exporting requirements.txt..."
pip freeze > ../requirements.txt

echo "📁 creating the scaffold of backend..."
mkdir -p api models services

echo "✅ Done"

