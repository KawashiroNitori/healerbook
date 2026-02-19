#!/usr/bin/env python3
"""
从 CafeMaker API 获取 FF14 职业与减伤技能数据，生成 ClassJob.json 和 mitigationActions.json。
"""

import json
from pathlib import Path
from urllib.parse import urljoin

import requests

BASE_URL = "https://cafemaker.wakingsands.com"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
MITIGATION_KEYWORD = "軽減"


def fetch_json(path: str) -> dict:
    """发送 GET 请求并返回 JSON。path 为相对路径，会自动拼接 base_url。"""
    url = urljoin(BASE_URL, path)
    print(f"[fetch_json] GET {url}")
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    print("正在获取职业列表...")
    classjob_list = fetch_json("/ClassJob")

    # 筛选 ID >= 19 的职业
    all_jobs = [r for r in classjob_list["Results"] if r["ID"] >= 19]
    print(f"找到 {len(all_jobs)} 个职业 (ID >= 19)")

    # 步骤 2-3: 对每个职业获取详情，合并为 ClassJob.json
    classjobs = []
    for job in all_jobs:
        detail = fetch_json(job["Url"])
        classjobs.append(detail)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    classjob_path = OUTPUT_DIR / "ClassJob.json"
    with open(classjob_path, "w", encoding="utf-8") as f:
        json.dump(classjobs, f, ensure_ascii=False, indent=2)
    print(f"已写入 {classjob_path}")

    # 步骤 4-7: 获取每个职业的 Action，筛选含 軽減 的技能，转换并去重
    seen = set()  # (id, job) 去重
    mitigation_actions = []

    for classjob in classjobs:
        links = classjob.get("GameContentLinks") or {}
        action_links = links.get("Action") or {}
        action_ids = action_links.get("ClassJob") or []
        job_abbr = classjob.get("Abbreviation", "")

        for action_id in action_ids:
            key = (action_id, job_abbr)
            if key in seen:
                continue

            try:
                action = fetch_json(f"/Action/{action_id}")
            except Exception as e:
                print(f"  跳过 Action {action_id}: {e}")
                continue

            desc_ja = action.get("Description_ja") or ""
            if not action.get('ClassJob') and not action.get('ClassJobCategory'):
                continue
            if MITIGATION_KEYWORD not in desc_ja and 'バリア' not in desc_ja:
                continue
            if bool(action.get('IsPvP')):
                continue

            seen.add(key)
            recast = action.get("Recast100ms") or 0
            mitigation_actions.append({
                "id": action["ID"],
                "name": action.get("Name", ""),
                "description": action.get("Description", ""),
                "icon": action.get("Icon", ""),
                "iconHD": action.get("IconHD", ""),
                "job": job_abbr,
                "type": "",
                "physicReduce": 0,
                "magicReduce": 0,
                "barrier": 0,
                "duration": 0,
                "cooldown": recast / 10,
            })

    from datetime import date

    output = {
        "version": "7.1",
        "lastUpdated": date.today().isoformat(),
        "source": "CafeMaker API",
        "actions": mitigation_actions,
    }

    mitigation_path = OUTPUT_DIR / "mitigationActions.json"
    with open(mitigation_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"已写入 {mitigation_path}，共 {len(mitigation_actions)} 个减伤技能")


if __name__ == "__main__":
    main()
