"""Healerbook 样本分析工具库。

Notebook 和脚本可以从这里 import 通用函数，避免在多个 notebook 里重复。
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"


# ---------- 加载 ----------


def load_samples(encounter_id: int | str | None = None, path: str | Path | None = None) -> dict:
    """加载一个 encounter 的原始样本 JSON。

    优先使用 `path`，否则根据 `encounter_id` 在 `analysis/data/` 下找 `samples-{id}.json`。
    """
    if path is None:
        if encounter_id is None:
            raise ValueError("必须提供 encounter_id 或 path")
        path = DATA_DIR / f"samples-{encounter_id}.json"
    return json.loads(Path(path).read_text())


def to_long(record: dict, key_name: str, value_name: str = "value") -> pd.DataFrame:
    """把 `Record<K, number[]>` 展开成 long 格式 DataFrame。"""
    rows = [
        {key_name: k, value_name: v}
        for k, vs in (record or {}).items()
        for v in vs
    ]
    return pd.DataFrame(rows)


def load_frames(encounter_id: int | str | None = None, path: str | Path | None = None) -> dict[str, pd.DataFrame]:
    """一次性加载一个 encounter 的四类数据为 DataFrame 字典。

    返回 keys: 'damage', 'heal', 'shield', 'maxhp'。
    """
    raw = load_samples(encounter_id=encounter_id, path=path)
    return {
        "damage": to_long(raw.get("damageByAbility", {}), "ability_id", "damage"),
        "heal": to_long(raw.get("healByAbility", {}), "ability_id", "heal"),
        "shield": to_long(raw.get("shieldByAbility", {}), "status_id", "shield"),
        "maxhp": to_long(raw.get("maxHPByJob", {}), "job", "max_hp"),
    }


def load_all_encounters() -> pd.DataFrame:
    """加载 `data/` 目录下所有 samples-*.json，合并为一个 long 格式 damage 表。

    添加 `encounter_id` 列用于跨副本对比。
    """
    frames = []
    for f in sorted(DATA_DIR.glob("samples-*.json")):
        enc_id = f.stem.removeprefix("samples-")
        data = load_samples(path=f)
        df = to_long(data.get("damageByAbility", {}), "ability_id", "damage")
        df["encounter_id"] = enc_id
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


# ---------- 统计 ----------


def summary(df: pd.DataFrame, group_col: str, value_col: str) -> pd.DataFrame:
    """按 group_col 聚合出常用统计量。

    返回列：count, min, p50, p90, max, mean, std, cv（变异系数）。
    按 p50 降序。
    """
    if df.empty:
        return pd.DataFrame()
    g = df.groupby(group_col)[value_col]
    return (
        pd.DataFrame(
            {
                "count": g.count(),
                "min": g.min(),
                "p50": g.median(),
                "p90": g.quantile(0.9),
                "max": g.max(),
                "mean": g.mean(),
                "std": g.std(),
                "cv": g.std() / g.mean(),
            }
        )
        .sort_values("p50", ascending=False)
    )


def sample_coverage(df: pd.DataFrame, group_col: str, max_samples: int = 500) -> pd.DataFrame:
    """检查 reservoir sampling 的填充情况。

    返回每个 group 的样本数 + 是否已达 MAX_SAMPLES 上限。
    """
    if df.empty:
        return pd.DataFrame()
    counts = df.groupby(group_col).size().rename("count").to_frame()
    counts["full"] = counts["count"] >= max_samples
    counts["fill_rate"] = counts["count"] / max_samples
    return counts.sort_values("count", ascending=False)
