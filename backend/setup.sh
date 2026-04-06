#!/bin/bash
set -e

echo "creating python virtual environment..."
python3 -m venv venv
source venv/bin/activate

echo "installing required packages..."
pip3 install --upgrade pip
pip3 install -r ../requirements.txt

echo "Done"
