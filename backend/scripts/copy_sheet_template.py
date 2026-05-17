"""copy_sheet_template.py

兩個用途，依 mode 選擇：

(1) verify (預設)：驗證 service account 對你手動複製的新 sheet 已有 Editor 權限，
    並列印 worksheet 結構，讓你確認 schema 對得上 key_sheet_import.py 預期。
    Consumer Gmail (gmail.com) 必須走這條路，因為 service account 無 Drive
    storage quota，不能 own 任何檔案，無法用 API 複製 file。

(2) copy：用 service account 複製 template + share Editor 給你。對 consumer
    Gmail 會 throw `storageQuotaExceeded` (Drive API 限制)。只在你之後 migrate
    到 Google Workspace + 用 Shared Drive 時可行；保留供未來使用。

Usage
-----
    export GLORIA_GOOGLE_CREDENTIALS=/path/to/sa.json

    # 主要流程（你 web UI「製作副本」、加 SA Editor、然後跑這個驗證）
    python -m backend.scripts.copy_sheet_template <new_sheet_id>

    # 預覽完整 worksheet 內容（不只 schema）
    python -m backend.scripts.copy_sheet_template <new_sheet_id> --show-rows 5

    # 將來 Workspace 場景：複製 template
    python -m backend.scripts.copy_sheet_template <template_id> --copy \\
        --title "..." --owner you@yourdomain.com --transfer-ownership
"""

from __future__ import annotations

import argparse
import os
import sys

import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


SCOPES = ["https://www.googleapis.com/auth/drive"]
# Pulled from env so the owner email stays out of source. Set
# GOOGLE_SHEET_OWNER in your shell, or pass --owner on the CLI.
DEFAULT_OWNER = os.environ.get("GOOGLE_SHEET_OWNER", "")
CONSUMER_DOMAINS = {"gmail.com", "googlemail.com"}


def _build_credentials():
    cred_path = os.environ.get("GLORIA_GOOGLE_CREDENTIALS")
    if not cred_path:
        sys.exit("ERROR: GLORIA_GOOGLE_CREDENTIALS env var not set")
    if not os.path.isfile(cred_path):
        sys.exit(f"ERROR: service account JSON not found: {cred_path}")
    return Credentials.from_service_account_file(cred_path, scopes=SCOPES)


def _drive_client(creds):
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _gspread_client(creds):
    return gspread.authorize(creds)


def _service_account_email(creds) -> str:
    return creds.service_account_email


# ── verify mode ────────────────────────────────────────────────────────

def verify_sheet(file_id: str, show_rows: int = 0) -> None:
    """SA 對指定 sheet 有 access 嗎？列出 worksheet 結構，提示下一步。"""
    creds = _build_credentials()
    sa_email = _service_account_email(creds)
    drive = _drive_client(creds)
    gs = _gspread_client(creds)

    print(f"Service account: {sa_email}")
    print(f"Target file ID:  {file_id}")
    print()

    # 1. drive metadata + permissions（SA 自己看不到 owner 的 email 除非有 read perm）
    print("Reading file metadata ...")
    try:
        meta = drive.files().get(
            fileId=file_id,
            fields="id,name,mimeType,owners(emailAddress,displayName),webViewLink",
        ).execute()
    except HttpError as e:
        print(f"  ERROR: {e}")
        print()
        print("可能原因:")
        print(f"  1. Sheet ID 拼錯")
        print(f"  2. 此 sheet 還沒把 {sa_email} 加為 Editor")
        sys.exit(1)
    print(f"  Name:  {meta['name']}")
    print(f"  Owner: {meta['owners'][0]['emailAddress']}")
    print(f"  URL:   {meta['webViewLink']}")
    print()

    # 2. SA 自己的 permission entry（writer / reader / owner）
    print("Checking service account's role ...")
    perms = drive.permissions().list(
        fileId=file_id,
        fields="permissions(id,type,role,emailAddress)",
    ).execute()
    sa_role = None
    for p in perms.get("permissions", []):
        if p.get("emailAddress", "").lower() == sa_email.lower():
            sa_role = p["role"]
            break
    if sa_role:
        print(f"  Role: {sa_role}")
        if sa_role not in ("writer", "owner", "fileOrganizer"):
            print(f"  WARN: role '{sa_role}' 不能寫入。請改成 Editor (writer)。")
    else:
        print(f"  WARN: {sa_email} 未在 permission list；可能透過「知道連結的人」公開存取。")
    print()

    # 3. worksheet 結構
    print("Worksheet structure:")
    sh = gs.open_by_key(file_id)
    for ws in sh.worksheets():
        rows = ws.get_all_values() if show_rows else None
        print(f"  - {ws.title:20s} ({ws.row_count}r x {ws.col_count}c)")
        if rows:
            for i, r in enumerate(rows[:show_rows]):
                print(f"      row {i}: {r}")
            if len(rows) > show_rows:
                print(f"      ... +{len(rows) - show_rows} more")

    print()
    print("=" * 60)
    if sa_role in ("writer", "owner", "fileOrganizer"):
        print("OK: SA 有寫入權限，可開始用 key_sheet_import.py 匯入內容。")
    else:
        print(f"請把 {sa_email} 加為 Editor 後重跑此命令確認。")


# ── copy mode (Workspace only, kept for future use) ───────────────────

def copy_template(
    template_id: str,
    title: str | None = None,
    share_with: str = DEFAULT_OWNER,
    try_transfer_ownership: bool = False,
) -> dict:
    """Copy a Drive file and share with a user.

    對 consumer Gmail (gmail.com) 會 throw `storageQuotaExceeded` 因為
    service account 無 Drive storage 不能 own 任何 file。只在 Workspace
    + Shared Drive 場景可用。
    """
    creds = _build_credentials()
    drive = _drive_client(creds)

    body: dict = {}
    if title:
        body["name"] = title
    print(f"Copying template {template_id} ...")
    new_file = drive.files().copy(
        fileId=template_id,
        body=body,
        fields="id,name,owners,webViewLink,mimeType",
    ).execute()
    file_id = new_file["id"]
    print(f"  Created: {new_file['name']}")
    print(f"  ID:      {file_id}")
    print(f"  URL:     {new_file['webViewLink']}")
    print(f"  Owner:   {new_file['owners'][0]['emailAddress']}")

    domain = share_with.rsplit("@", 1)[-1].lower()
    is_consumer = domain in CONSUMER_DOMAINS
    final_role = None
    if try_transfer_ownership and not is_consumer:
        print(f"\nTransferring ownership to {share_with} ...")
        try:
            drive.permissions().create(
                fileId=file_id,
                body={"type": "user", "role": "owner", "emailAddress": share_with},
                transferOwnership=True,
                fields="id,emailAddress,role",
            ).execute()
            print(f"  Success: ownership transferred to {share_with}")
            final_role = "owner"
        except HttpError as e:
            print(f"  Failed: {e}")
            print("  Falling back to Editor share ...")
            final_role = _share_editor(drive, file_id, share_with)
    else:
        if try_transfer_ownership and is_consumer:
            print(
                f"\nSkipping ownership transfer: '{domain}' 是 consumer Gmail，"
                "Drive API 不支援跨 domain ownership transfer。"
            )
        print(f"\nSharing as Editor with {share_with} ...")
        final_role = _share_editor(drive, file_id, share_with)

    return {
        "id": file_id,
        "name": new_file["name"],
        "url": new_file["webViewLink"],
        "final_role": final_role,
    }


def _share_editor(drive, file_id: str, email: str) -> str:
    drive.permissions().create(
        fileId=file_id,
        body={"type": "user", "role": "writer", "emailAddress": email},
        sendNotificationEmail=False,
        fields="id,emailAddress,role",
    ).execute()
    print(f"  Success: {email} added as Editor")
    return "writer"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("file_id", help="Sheet ID. verify mode: 你已建好的新 sheet ID; copy mode: template ID")
    parser.add_argument("--copy", action="store_true", help="複製 template (Workspace 場景)")
    parser.add_argument("--title", default=None, help="(copy mode) 新檔名")
    parser.add_argument(
        "--owner",
        default=DEFAULT_OWNER,
        required=not DEFAULT_OWNER,
        help="(copy mode) share 給誰；若未指定，會讀環境變數 GOOGLE_SHEET_OWNER",
    )
    parser.add_argument("--transfer-ownership", action="store_true", help="(copy mode) 嘗試 transfer owner，cross-domain 會 fail")
    parser.add_argument("--show-rows", type=int, default=0, help="(verify mode) 預覽每個 worksheet 前 N 列")
    args = parser.parse_args()

    if args.copy:
        result = copy_template(
            template_id=args.file_id,
            title=args.title,
            share_with=args.owner,
            try_transfer_ownership=args.transfer_ownership,
        )
        print()
        print("=" * 60)
        print(f"Open: {result['url']}")
    else:
        verify_sheet(args.file_id, show_rows=args.show_rows)


if __name__ == "__main__":
    main()
