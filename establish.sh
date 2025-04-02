cd backend
python3.13 -m venv venv
source venv/bin/activate  # Windows 為 venv\\Scripts\\activate

# 安裝依賴
pip3.13 install fastapi uvicorn sqlmodel pyyaml python-docx
#
# # 儲存依賴
pip3.13 freeze > requirements.txt
#
