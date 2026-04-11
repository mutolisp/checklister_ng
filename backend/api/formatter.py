import re

# 動物界的 kingdom 名稱
_ANIMAL_KINGDOMS = {"Animalia"}

# 判斷是否為動物界
def _is_animal(kingdom: str) -> bool:
    return (kingdom or "") in _ANIMAL_KINGDOMS


def format_scientific_name_markdown(fullname: str, kingdom: str = "") -> str:
    """Format scientific name for Markdown.
    植物/真菌: *Genus species* var. *epithet* Author
    動物: *Genus species epithet* (Author, Year)
    """
    remaining = fullname.strip()
    if not remaining:
        return fullname

    if _is_animal(kingdom):
        return _format_animal_markdown(remaining)
    return _format_botanical_markdown(remaining)


def _format_botanical_markdown(fullname: str) -> str:
    """植物/真菌/預設格式：種下階層用 var./subsp./f. 正體"""
    remaining = fullname.strip()
    formatted = ""

    # 主學名 (Genus species)
    main_match = re.match(r"^([A-Z][a-z]+ [a-z\-]+)", remaining)
    if not main_match:
        return fullname

    main = main_match.group(1)
    formatted += f"*{main}*"
    remaining = remaining[len(main):].strip()

    # 遞迴處理 subsp./var./f./fo.
    rank_pattern = re.compile(r"^(.*?)\s?(subsp\.|var\.|f\.|fo\.)\s([a-z\-]+)\s?")
    while True:
        match = rank_pattern.match(remaining)
        if not match:
            break
        before_rank = match.group(1).strip()
        rank = match.group(2)
        epithet = match.group(3)

        if before_rank:
            formatted += f" {before_rank}"
        formatted += f" {rank} *{epithet}*"
        remaining = remaining[len(match.group(0)):].strip()

    if remaining:
        formatted += f" {remaining}"

    return formatted


def _format_animal_markdown(fullname: str) -> str:
    """動物格式：種下階層不用縮寫，三名法直接斜體
    Panthera tigris altaica (Temminck, 1845)
    → *Panthera tigris altaica* (Temminck, 1845)
    """
    remaining = fullname.strip()

    # 嘗試匹配 Genus species [subspecies] Author
    # 動物的種下階層沒有 var./subsp. 縮寫，直接是第三個小寫名
    m = re.match(r"^([A-Z][a-z]+(?:\s+[a-z\-]+)+)\s*(.*)", remaining)
    if not m:
        return fullname

    name_part = m.group(1)  # 所有斜體部分（二名或三名）
    author_part = m.group(2).strip()  # 命名者

    formatted = f"*{name_part}*"
    if author_part:
        formatted += f" {author_part}"

    return formatted
